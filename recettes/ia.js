/* Recette par l'IA — depuis un NOM de plat, ou depuis une PHOTO.

   Source de dernier recours, et c'est assumé : `confiance: 'estimee'`. Le
   back-office affiche « estimée — relis » plutôt que « publiée par le site », et
   personne n'enregistre à notre place. Une recette inventée qui se présente comme
   une vérité est pire qu'une absence de recette.

   Choix techniques (voir CLAUDE.md § 2 quinquies) :
   - Modèle `claude-opus-5` par défaut, surchargeable par IA_MODELE dans .env.
     À ce volume — quelques appels par semaine — la facture reste de quelques
     centimes par mois quel que soit le modèle : le choix appartient à Rémi.
   - SORTIES STRUCTURÉES (`output_config.format`) : le modèle est contraint au
     schéma, il n'y a plus de texte libre à parser. `additionalProperties:false`
     et un `required` complet sont obligatoires.
   - La pensée adaptative est ACTIVE PAR DÉFAUT sur Opus 5 et compte dans
     `max_tokens` : on garde une marge large, une réponse tronquée donnant un JSON
     invalide plutôt qu'une recette courte.
   - `stop_reason: 'refusal'` est testé AVANT de lire le contenu — sinon on plante
     sur un tableau vide.
   - Repli serveur (`fallbacks`) demandé, avec retour automatique à l'appel simple
     si la bêta n'est pas ouverte sur la clé : une fiche de recette ne doit pas
     dépendre d'un drapeau bêta. */
const Anthropic = require('@anthropic-ai/sdk');
const { nettoyerListe, nettoyerTexte, decouperEtapes } = require('./commun');

/* Le modèle se règle désormais depuis /admin/ → Réglages (clé `ia_modele`), le
   `.env` ne servant plus que de valeur d'amorçage. À ce volume — quelques appels
   par semaine — la facture reste de quelques centimes par mois quel que soit le
   choix : c'est donc à Rémi de trancher, pas au code. */
let modele = process.env.IA_MODELE || 'claude-opus-5';
const definirModele = (nom) => { if (nom && String(nom).trim()) modele = String(nom).trim(); };

const MAX_TOKENS = 16000;

const disponible = () => !!process.env.ANTHROPIC_API_KEY;

let client = null;
function clientIA() {
  if (!disponible()) {
    throw new Error("Pas de clé ANTHROPIC_API_KEY dans le .env : la recherche par nom "
      + 'et la lecture de photo sont désactivées. La source « lien » fonctionne toujours.');
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const SCHEMA = {
  type: 'object',
  properties: {
    nom: { type: 'string', description: 'Nom du plat, en français' },
    ingredients: { type: 'array', items: { type: 'string' },
      description: 'Une ligne par ingrédient, avec la quantité en tête : « 200 g de farine »' },
    etapes: { type: 'array', items: { type: 'string' },
      description: 'Une phrase d\'action par étape, dans l\'ordre, sans numérotation' },
    portions: { type: 'string', description: 'Par exemple « 4 personnes »' },
    duree: { type: 'string', description: 'Par exemple « 45 min » ou « 1 h 30 »' },
    appareils: { type: 'array', items: { type: 'string' },
      description: 'Uniquement les appareils du foyer réellement utiles à CETTE recette' },
  },
  required: ['nom', 'ingredients', 'etapes', 'portions', 'duree', 'appareils'],
  additionalProperties: false,
};

/* La consigne dit explicitement de NE PAS FORCER l'usage des appareils : une
   salade n'a pas besoin du robot, et une recette qui en invente l'usage perd la
   confiance qu'on lui accorde. */
function systeme(equipements) {
  const base = [
    'Tu écris des fiches de cuisine familiale, en français, pour un écran tactile de cuisine.',
    'Sois concret et bref : des quantités chiffrées, des étapes courtes à l\'infinitif ou à l\'impératif.',
    'Les quantités sont données pour le nombre de portions que tu indiques.',
    'N\'invente pas de marque ni de produit introuvable en supermarché français.',
  ];
  if (equipements && String(equipements).trim()) {
    base.push(`Le foyer possède : ${String(equipements).trim()}.`,
      'Utilise ces appareils UNIQUEMENT quand ils apportent vraiment quelque chose à cette recette,',
      'et liste dans « appareils » ceux que tes étapes emploient réellement. Ne les force jamais :',
      'si la recette se fait mieux à la casserole, dis la casserole et laisse « appareils » vide.');
  } else {
    base.push('Laisse « appareils » vide.');
  }
  return base.join('\n');
}

const estBetaRefusee = (e) =>
  (e && (e.status === 400 || e.status === 403)
    && /beta|fallback|unsupported|not\s+enabled|unknown\s+field/i.test(String(e.message || '')));

/* ⚠️ Tous les modèles n'acceptent pas `effort` : Haiku 4.5 le refuse avec un 400
   sec (« This model does not support the effort parameter »). Découvert en
   mesurant la latence de l'assistant vocal — le modèle qu'on s'apprêtait à
   recommander pour la voix aurait planté, et les recettes avec lui si le réglage
   avait été changé.
   Deux protections plutôt qu'une liste à tenir à jour : on saute le paramètre
   pour les familles connues pour le refuser, ET on rejoue sans lui si l'API s'en
   plaint quand même. */
const SANS_EFFORT = /^claude-(haiku|sonnet-4-5)/i;
const supporteEffort = (m) => !SANS_EFFORT.test(String(m || ''));
const estRefusEffort = (e) => e && e.status === 400 && /effort/i.test(String(e.message || ''));

/* Appel structuré, partagé par les recettes ET l'assistant vocal : même schéma
   d'options, mêmes replis. Renvoie la réponse brute — chaque appelant garde son
   propre traitement des cas de refus. */
async function appelStructure({ modele: m, systeme: sys, messages, schema, effort = 'low', maxTokens = MAX_TOKENS }) {
  const c = clientIA();
  const format = { type: 'json_schema', schema };
  const modeleUtilise = m || modele;

  const construire = (avecEffort) => ({
    model: modeleUtilise,
    max_tokens: maxTokens,
    system: sys,
    messages,
    output_config: avecEffort ? { effort, format } : { format },
  });

  const envoyer = async (avecEffort) => {
    const params = construire(avecEffort);
    try {
      /* Repli serveur demandé, avec retour à l'appel simple si la bêta n'est pas
         ouverte sur la clé : une fiche ne doit pas dépendre d'un drapeau bêta. */
      return await c.beta.messages.create({
        ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      });
    } catch (e) {
      if (!estBetaRefusee(e)) throw e;
      return c.messages.create(params);
    }
  };

  try {
    return await envoyer(supporteEffort(modeleUtilise));
  } catch (e) {
    if (estRefusEffort(e)) return envoyer(false).catch((e2) => { throw enrichir(e2); });
    throw enrichir(e);
  }
}

const appeler = (messages, equipements) =>
  appelStructure({ systeme: systeme(equipements), messages, schema: SCHEMA }).then(lireReponse);

function enrichir(e) {
  if (e && e.status === 401) return new Error('Clé ANTHROPIC_API_KEY refusée — à régénérer sur console.anthropic.com.');
  if (e && e.status === 429) return new Error('Trop de demandes d\'affilée : réessaie dans un instant.');
  if (e && e.status >= 500) return new Error('Le service est momentanément indisponible. Réessaie.');
  return e instanceof Error ? e : new Error(String(e));
}

function lireReponse(rep) {
  /* Testé AVANT le contenu : sur un refus, `content` peut être vide et on
     planterait sur un accès à `[0]`. */
  if (rep.stop_reason === 'refusal') {
    throw new Error('Le modèle a décliné cette demande. Saisis la recette à la main, '
      + 'ou pars d\'un lien de recette.');
  }
  if (rep.stop_reason === 'max_tokens') {
    throw new Error('Réponse trop longue, elle a été coupée. Réessaie avec un plat plus simple.');
  }
  const bloc = (rep.content || []).find((b) => b.type === 'text');
  if (!bloc || !bloc.text) throw new Error('Réponse vide du modèle.');

  let brut;
  try { brut = JSON.parse(bloc.text); }
  catch (_) { throw new Error('Réponse illisible du modèle. Réessaie.'); }

  const etapes = nettoyerListe(
    [].concat(brut.etapes || []).flatMap((x) => decouperEtapes(x)), 40);

  return {
    nom: nettoyerTexte(brut.nom || ''),
    ingredients: nettoyerListe([].concat(brut.ingredients || []).map(nettoyerTexte)),
    etapes,
    portions: nettoyerTexte(brut.portions || ''),
    duree: nettoyerTexte(brut.duree || ''),
    appareils: nettoyerListe([].concat(brut.appareils || []).map(nettoyerTexte), 8),
    photoUrl: '',
    url: '',
    confiance: 'estimee',
  };
}

const depuisNom = (nom, options = {}) => {
  const v = String(nom || '').trim();
  if (!v) throw new Error('Il faut un nom de plat.');
  return appeler([{ role: 'user', content:
    `Écris la fiche de recette du plat : « ${v} ». Recette familiale française classique.` }],
    options.equipements);
};

const TYPES_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const depuisPhoto = (base64, type, options = {}) => {
  if (!base64) throw new Error('Aucune image reçue.');
  const media = TYPES_IMAGE.includes(String(type || '').toLowerCase()) ? type.toLowerCase() : 'image/jpeg';
  return appeler([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: media, data: String(base64) } },
      { type: 'text', text:
        'Cette photo montre une recette (page de livre, fiche, capture d\'écran) ou un plat cuisiné. '
        + 'Si elle contient un texte de recette, RECOPIE-le fidèlement sans rien inventer. '
        + 'Si elle ne montre que le plat terminé, propose la recette la plus probable.' },
    ],
  }], options.equipements);
};

/* ------------------------------------------------------------------ idées de plats
   L'autre besoin, celui que la rotation ne couvre pas : sortir de ses habitudes.
   `menu.js` compose à partir de ce qu'on a déjà ; ici on cherche ce qu'on n'a
   PAS. C'est le seul endroit où la créativité du modèle est le sujet.

   Rien n'est ajouté à la bibliothèque : on propose, l'humain choisit. */
const SCHEMA_IDEES = {
  type: 'object',
  properties: {
    idees: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nom: { type: 'string', description: 'Nom court du plat, en français' },
          pourquoi: { type: 'string', description: 'Une phrase : pourquoi il irait bien à cette famille, cette saison' },
          categorie: { type: 'string', description: 'Plat, Entrée, Dessert, Soupe…' },
          emoji: { type: 'string', description: 'Un seul emoji illustrant le plat' },
        },
        required: ['nom', 'pourquoi', 'categorie', 'emoji'],
        additionalProperties: false,
      },
    },
  },
  required: ['idees'],
  additionalProperties: false,
};

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

async function idees(existants = [], options = {}) {
  const combien = Math.min(8, Math.max(3, Number(options.combien) || 5));
  const mois = MOIS_FR[new Date().getMonth()];
  const deja = existants.filter(Boolean).join(', ');

  const consigne = [
    'Tu proposes des idées de plats à une famille française de quatre à six personnes,',
    'qui cuisine en semaine et veut sortir de ses habitudes sans se compliquer la vie.',
    `Nous sommes en ${mois} : privilégie ce qui est de saison.`,
    'Des plats FAISABLES un soir de semaine, avec des ingrédients de supermarché français.',
    'Rien de gastronomique, rien d’introuvable.',
    options.equipements ? `Le foyer possède : ${options.equipements}. Tu peux en tirer parti, sans forcer.` : '',
    deja ? `\nLa famille connaît DÉJÀ ces plats — n'en propose AUCUN, ni de simple variante :\n${deja}` : '',
  ].filter(Boolean).join('\n');

  const rep = await appelStructure({
    modele: options.modele,
    systeme: consigne,
    messages: [{ role: 'user', content: `Propose ${combien} plats différents que cette famille n'a pas encore.` }],
    schema: SCHEMA_IDEES,
    effort: 'low',
    maxTokens: 8000,
  });

  if (rep.stop_reason === 'refusal') throw new Error('Le modèle a décliné cette demande.');
  const bloc = (rep.content || []).find((b) => b.type === 'text');
  if (!bloc || !bloc.text) throw new Error('Réponse vide du modèle.');

  let brut;
  try { brut = JSON.parse(bloc.text); }
  catch (_) { throw new Error('Réponse illisible du modèle.'); }

  /* Dernier filet : le modèle peut proposer malgré tout un plat déjà connu.
     La consigne ne suffit pas, la vérification si. */
  const connus = new Set(existants.map((x) => String(x).normalize('NFD')
    .replace(/\p{Diacritic}/gu, '').toLowerCase().trim()));
  return (brut.idees || [])
    .map((i) => ({
      nom: nettoyerTexte(i.nom), pourquoi: nettoyerTexte(i.pourquoi),
      categorie: nettoyerTexte(i.categorie), emoji: String(i.emoji || '').trim().slice(0, 4),
    }))
    .filter((i) => i.nom && !connus.has(i.nom.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()));
}

module.exports = {
  depuisNom, depuisPhoto, disponible, definirModele, idees,
  get MODELE() { return modele; },        // toujours la valeur courante, pas celle du démarrage
  appelStructure, supporteEffort,
  SCHEMA, systeme, lireReponse, clientIA, enrichir, MAX_TOKENS,
};

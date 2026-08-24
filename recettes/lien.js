/* Recette depuis un LIEN — sans scraping, sans IA.

   La découverte qui change la solution : les sites de cuisine publient déjà leur
   recette en `schema.org/Recipe` (JSON-LD), parce que Google l'exige pour les
   résultats enrichis. On lit donc les ingrédients, les étapes, les portions, la
   durée et la photo PROPREMENT, gratuitement, sans clé — et sans rien inventer.

   Conséquence : aucun sélecteur CSS à maintenir, aucune API non officielle qui
   casse à la prochaine refonte du site. C'est la source la plus fiable des trois,
   d'où `confiance: 'sure'`.

   ✅ Vérifié en vrai : 750g et CuisineAZ répondent bien.
   ⚠️ Marmiton publie le JSON-LD, mais son hébergeur d'images refuse le
      téléchargement (503) même avec un Referer.
   ⚠️ Toutes les pages d'un même site ne l'ont pas : plusieurs vieilles recettes
      750g n'ont pas de JSON-LD. Le message d'erreur le dit et renvoie vers l'IA
      ou la saisie manuelle, plutôt que de laisser croire à une panne. */
const { nettoyerTexte, decouperEtapes, nettoyerListe, dureeLisible, estPlaceholder } = require('./commun');

/* Un navigateur crédible : plusieurs sites renvoient une page vide, voire un 403,
   à un client qui s'annonce comme un script. */
const ENTETES = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

async function telechargerPage(url, msMax = 15000) {
  const stop = AbortSignal.timeout(msMax);
  const r = await fetch(url, { headers: ENTETES, redirect: 'follow', signal: stop });
  if (!r.ok) throw new Error(`Le site a répondu ${r.status}. Vérifie le lien.`);
  return r.text();
}

/* Parcours en profondeur : le Recipe peut être à la racine, dans un tableau, ou
   niché dans un `@graph` (cas le plus courant sur les gros sites). */
function trouverRecette(noeud, vus = new Set()) {
  if (!noeud || typeof noeud !== 'object' || vus.has(noeud)) return null;
  vus.add(noeud);
  if (Array.isArray(noeud)) {
    for (const x of noeud) { const t = trouverRecette(x, vus); if (t) return t; }
    return null;
  }
  const type = noeud['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => String(t || '').toLowerCase() === 'recipe')) return noeud;
  for (const v of Object.values(noeud)) {
    const t = trouverRecette(v, vus);
    if (t) return t;
  }
  return null;
}

function blocsJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const brut = m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
    try { out.push(JSON.parse(brut)); }
    catch (_) { /* un bloc mal formé ne doit pas condamner les autres */ }
  }
  return out;
}

/* `recipeInstructions` prend cinq formes selon les sites : chaîne unique, tableau
   de chaînes, tableau de HowToStep, HowToSection contenant des HowToStep, ou un
   mélange. Toutes existent réellement dans la nature. */
function etapesDe(instructions) {
  if (!instructions) return [];
  if (typeof instructions === 'string') return decouperEtapes(instructions);
  const plat = [];
  const visiter = (x) => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(visiter);
    if (typeof x === 'string') return plat.push(x);
    if (x.itemListElement) return visiter(x.itemListElement);
    if (x.text) return plat.push(x.text);
    if (x.name) return plat.push(x.name);
  };
  visiter(instructions);
  /* Un tableau d'un seul élément est presque toujours un pavé déguisé. */
  const propres = plat.map((x) => nettoyerTexte(x)).filter(Boolean);
  if (propres.length === 1) return decouperEtapes(propres[0]);
  return nettoyerListe(propres.flatMap((x) => (x.length > 400 ? decouperEtapes(x) : [x])), 40);
}

function imageDe(image) {
  const prendre = (x) => {
    if (!x) return '';
    if (typeof x === 'string') return x;
    if (Array.isArray(x)) { for (const y of x) { const u = prendre(y); if (u) return u; } return ''; }
    return x.url || x.contentUrl || '';
  };
  const u = prendre(image);
  return estPlaceholder(u) ? '' : u;
}

/* Repli `og:image`. L'ORDRE DES ATTRIBUTS varie d'un site à l'autre :
   `property` avant `content` chez les uns, l'inverse chez les autres. Une regex
   qui n'accepte qu'un seul ordre rate la photo une fois sur deux — et ça ne se
   voit qu'au moment où la vignette manque sur l'écran. */
function imageOpenGraph(html) {
  const balises = html.match(/<meta[^>]+>/gi) || [];
  for (const b of balises) {
    if (!/(?:property|name)\s*=\s*["'](?:og:image(?::url)?|twitter:image)["']/i.test(b)) continue;
    const c = /content\s*=\s*["']([^"']+)["']/i.exec(b);
    if (c && c[1] && !estPlaceholder(c[1])) return c[1];
  }
  return '';
}

const portionsDe = (y) => {
  const v = Array.isArray(y) ? y[0] : y;
  if (v === undefined || v === null || v === '') return '';
  const t = nettoyerTexte(String(v));
  return /^\d+$/.test(t) ? `${t} personnes` : t;
};

async function depuisLien(url) {
  const propre = String(url || '').trim();
  if (!/^https?:\/\//i.test(propre)) throw new Error('Colle un lien commençant par http(s)://');

  const html = await telechargerPage(propre);
  let brute = null;
  for (const bloc of blocsJsonLd(html)) {
    brute = trouverRecette(bloc);
    if (brute) break;
  }
  if (!brute) {
    throw new Error("Cette page ne publie pas sa recette en format lisible (schema.org). "
      + "Essaie un autre lien, « Demander à l'IA », ou saisis-la à la main.");
  }

  const ingredients = nettoyerListe(
    [].concat(brute.recipeIngredient || brute.ingredients || []).map((x) => nettoyerTexte(x)));
  const etapes = etapesDe(brute.recipeInstructions);

  /* Une photo distante n'est PAS conservée telle quelle : `images.js` la
     télécharge et la range en local. L'écran mural doit garder ses vignettes
     quand Internet tombe. */
  let photoUrl = imageDe(brute.image);
  if (!photoUrl) photoUrl = imageOpenGraph(html);

  return {
    nom: nettoyerTexte(brute.name || ''),
    ingredients,
    etapes,
    portions: portionsDe(brute.recipeYield),
    duree: dureeLisible(brute.totalTime) || dureeLisible(brute.cookTime) || dureeLisible(brute.prepTime),
    photoUrl: photoUrl ? new URL(photoUrl, propre).href : '',
    url: propre,
    appareils: [],
    confiance: 'sure',
  };
}

/* Juste la photo d'illustration d'une page, sans exiger la recette.

   Nécessaire parce que toutes les pages n'ont pas de JSON-LD (plusieurs vieilles
   recettes 750g n'en ont pas), alors que presque toutes ont une `og:image` — les
   réseaux sociaux l'imposent depuis longtemps. Exiger la recette complète pour
   récupérer une vignette, c'est refuser le peu qu'on peut avoir à cause de ce
   qu'on ne peut pas avoir. */
async function photoDeLaPage(url) {
  const html = await telechargerPage(url);
  const brute = blocsJsonLd(html).map(trouverRecette).find(Boolean);
  const parLaRecette = brute ? imageDe(brute.image) : '';
  const trouvee = parLaRecette || imageOpenGraph(html);
  return trouvee ? new URL(trouvee, url).href : '';
}

module.exports = { depuisLien, photoDeLaPage, telechargerPage, blocsJsonLd, trouverRecette, etapesDe, imageOpenGraph };

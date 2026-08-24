/* Recettes — nettoyage du texte.

   C'est ce fichier qui fait la QUALITÉ du résultat. Une recette publiée arrive
   souvent d'un seul bloc, avec des entités HTML, des espaces insécables et des
   points collés au mot suivant. Affichée telle quelle sur un mur de cuisine, elle
   est illisible : on ne retrouve pas où on en était entre deux gestes. */

const ENTITES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç',
  ocirc: 'ô', ugrave: 'ù', ucirc: 'û', icirc: 'î', iuml: 'ï', euml: 'ë',
  deg: '°', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', frac12: '½', frac14: '¼', frac34: '¾', middot: '·', times: '×',
};

function decoderEntites(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => (ENTITES[n] !== undefined ? ENTITES[n] : ENTITES[n.toLowerCase()] ?? m));
}

/* Espaces insécables et fines comprises : elles se voient à l'affichage, pas au débogage. */
const nettoyerTexte = (s) =>
  decoderEntites(String(s || '').replace(/<[^>]+>/g, ' '))
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();

/* Abréviations à ne PAS confondre avec une fin de phrase. Sans cette liste, on
   coupe « 1 c. à soupe » en deux étapes, et « Th. 6 » perd son thermostat. */
const ABREVIATIONS = new Set([
  'c.', 'cc.', 'cs.', 'th.', 'min.', 'mn.', 'sec.', 'env.', 'ex.', 'cf.', 'etc.',
  'm.', 'mme.', 'mlle.', 'max.', 'approx.', 'no.', 'n°.', 'kg.', 'gr.', 'ml.', 'cl.',
]);

const estAbreviation = (mot) => {
  const m = mot.toLowerCase();
  if (ABREVIATIONS.has(m)) return true;
  return /^[a-zà-ÿ]\.$/.test(m);        // une seule lettre + point : « c. », « l. »
};

const MAJUSCULE = /^[A-ZÀ-ÝŒÆ0-9]/;

/* Découpe un pavé en étapes.
   1. Les retours à la ligne font foi quand il y en a — c'est l'intention de l'auteur.
   2. Sinon on coupe sur « point + majuscule », en protégeant les abréviations.
   ⚠️ L'espace manquant après le point (« Cuire 10 mn.Ajouter ») est très fréquent et
   empêchait aussi le découpage : on le rétablit d'abord. */
function decouperEtapes(brut) {
  const texte = nettoyerTexte(String(brut || '')
    /* « Cuire 10 mn.Ajouter » — point sans espace. Très fréquent, et ça empêchait
       aussi le découpage. */
    .replace(/\.(?=[A-ZÀ-ÝŒÆ])/g, '. ')
    /* « la laitAjouter le fromage » (vu tel quel sur 750g) — là il manque le point
       ENTIER, pas seulement l'espace. On ne recolle que derrière une vraie fin de
       mot (3 lettres minimum) : ça écarte les « McIntosh » et les sigles, tout en
       rattrapant « pommes de terreÉplucher ». Réservé aux ÉTAPES : on ne touche
       jamais à une ligne d'ingrédient. */
    .replace(/([a-zà-öø-ÿ]{3,})([A-ZÀ-ÖØ-Þ])/g, '$1. $2'));
  if (!texte) return [];

  const parLignes = texte.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (parLignes.length > 1) return parLignes.map(sansNumero).filter(Boolean);

  const mots = texte.split(/\s+/);
  const etapes = [];
  let courant = [];
  for (let i = 0; i < mots.length; i++) {
    const mot = mots[i];
    courant.push(mot);
    const suivant = mots[i + 1];
    if (mot.endsWith('.') && suivant && MAJUSCULE.test(suivant) && !estAbreviation(mot)) {
      etapes.push(courant.join(' '));
      courant = [];
    }
  }
  if (courant.length) etapes.push(courant.join(' '));
  return etapes.map(sansNumero).filter(Boolean);
}

/* « 1. Préchauffer » / « Étape 2 : mélanger » → on retire la numérotation :
   l'affichage la remet lui-même, et deux numéros valent pire qu'aucun. */
const sansNumero = (s) =>
  String(s || '').replace(/^\s*(?:étape\s*)?\d+\s*[.)\-:–]\s*/i, '').trim();

/* Liste nettoyée et dédoublonnée, en gardant l'ordre d'origine. */
function nettoyerListe(entrees, max = 60) {
  const vus = new Set();
  const out = [];
  for (const brut of entrees || []) {
    const v = nettoyerTexte(brut).replace(/^[-•*]\s*/, '').trim();
    if (!v || v.length > 200) continue;
    const k = v.toLowerCase();
    if (vus.has(k)) continue;
    vus.add(k);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/* Durée ISO 8601 (« PT1H30M ») → « 1 h 30 ». Les sites publient ce format ;
   l'afficher brut sur un écran de cuisine n'aurait aucun sens. */
function dureeLisible(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(String(iso || '').trim().toUpperCase());
  if (!m) return '';
  const j = Number(m[1] || 0), h = Number(m[2] || 0) + j * 24, min = Number(m[3] || 0);
  if (!h && !min) return '';
  if (!h) return `${min} min`;
  return min ? `${h} h ${String(min).padStart(2, '0')}` : `${h} h`;
}

/* ⚠️ Une page introuvable renvoie quand même une image : l'illustration générique
   du site. Les stocker donnerait des vignettes identiques et FAUSSES sur tout le
   menu — le genre de défaut qu'on ne remarque qu'une fois les 7 jours remplis. */
const MOTS_GENERIQUES = /(?:^|[\/_-])(?:default|placeholder|no[-_]?image|noimage|generic|fallback|blank|logo|sprite|avatar)(?:[\/_.-]|$)/i;
const estPlaceholder = (url) => !url || MOTS_GENERIQUES.test(String(url));

module.exports = {
  decoderEntites, nettoyerTexte, decouperEtapes, sansNumero,
  nettoyerListe, dureeLisible, estPlaceholder,
};

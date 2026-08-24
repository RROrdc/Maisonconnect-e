/* Trouver la page d'une recette à partir du NOM du plat.

   Le manque que ça comble : l'IA écrit une recette de mémoire, elle ne navigue
   pas. Elle ne peut donc JAMAIS ramener de photo. Les 13 plats saisis à la main
   par Rémi se retrouvaient avec une belle fiche et une vignette vide, alors que
   « du visuel sur les repas » est une demande explicite du projet (§ 5 bis).

   La méthode : on interroge la RECHERCHE du site, on prend les candidats
   réellement publiés, et on lit leur JSON-LD comme d'habitude. Aucune URL n'est
   fabriquée — c'est le site qui nous donne ses liens.

   ⚠️ LE GARDE-FOU EST LE CŒUR DU FICHIER. « Trouver quelque chose » est facile ;
   trouver LE bon plat ne l'est pas. Une recherche sur « pates carbo » peut très
   bien remonter des pâtes au pesto — c'est exactement l'erreur déjà commise à la
   main sur ce projet, qui a collé une fausse photo à un plat. On compare donc le
   titre trouvé au nom du plat, et on REFUSE quand ça ne colle pas. Ne rien
   ramener est un bon résultat ; ramener la mauvaise photo n'en est pas un. */
const { nettoyerTexte } = require('./commun');

const ENTETES = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'fr-FR,fr;q=0.9',
};

/* Un seul site pour l'instant, et c'est assez : 750g publie son JSON-LD de façon
   fiable et sa recherche renvoie des liens propres. En ajouter d'autres se fait
   en allongeant cette liste — pas en touchant au reste. */
const SITES = [
  {
    nom: '750g',
    url: (q) => `https://www.750g.com/recherche/?q=${encodeURIComponent(q)}`,
    liens: (html) => [...html.matchAll(/href="(https:\/\/www\.750g\.com\/[^"]*-r\d+\.htm)"/gi)].map((m) => m[1]),
    /* Le titre lisible est dans le slug : « hachis-parmentier-r59106.htm ». Ça
       permet de trier les candidats AVANT de télécharger quoi que ce soit. */
    titre: (url) => decodeURIComponent(url.split('/').pop().replace(/-r\d+\.htm.*$/, '').replace(/-/g, ' ')),
  },
];

const sansAccent = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/* Mots qui ne distinguent rien : les garder ferait passer « tarte aux pommes »
   pour « tarte aux poireaux ». */
const VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'au', 'aux', 'a', 'et', 'en', 'un', 'une',
  'sur', 'avec', 'sans', 'maison', 'facile', 'rapide', 'recette', 'pour']);

const motsUtiles = (s) => sansAccent(s)
  .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
  .filter((m) => m.length >= 4 && !VIDES.has(m));

/* Score de correspondance entre le nom du plat et un titre trouvé.

   DEUX moitiés, et la seconde est celle qui a manqué au premier jet :

   1. COUVERTURE — combien des mots du plat se retrouvent dans le titre.
      Sous-chaîne et non égalité : « sarazin » mal orthographié ne doit pas faire
      rejeter « sarrasin », et « carbo » doit reconnaître « carbonara ».

   2. PRÉCISION — combien de mots du titre n'ont RIEN à voir avec le plat.
      Sans elle, « barbecue » atteignait 100 % face à « sauce barbecue maison »
      (un seul mot attendu, forcément couvert), et « salade de quinoa à
      l'orientale » retenait « salade d'orange à l'orientale » — deux mots sur
      trois, l'orange en prime. Les égalités se tranchaient alors dans l'ordre
      d'arrivée des résultats, c'est-à-dire au hasard.

   Le produit des deux favorise le titre le plus SOBRE parmi ceux qui couvrent :
   « gratin de courgettes » l'emporte sur « gratin de courgettes au chèvre », et
   « dahl de lentilles corail » sur une variante à rallonge. */
function detail(nomPlat, titre) {
  const attendus = motsUtiles(nomPlat);
  if (!attendus.length) return { score: 0, couverture: 0, extras: 0 };

  const motsTitre = motsUtiles(titre);
  const cible = sansAccent(titre).replace(/[^a-z0-9]+/g, ' ');

  let trouves = 0;
  for (const m of attendus) {
    if (cible.includes(m)) { trouves++; continue; }
    /* Tolérance à une faute de frappe : « sarazin » vs « sarrasin ». */
    const racine = m.slice(0, Math.max(4, m.length - 2));
    if (cible.includes(racine)) trouves += 0.75;
  }
  const couverture = trouves / attendus.length;

  /* Un mot du titre est « en trop » si aucun mot attendu ne s'y rapporte.
     Le test va dans les deux sens : « burger » se retrouve dans
     « cheeseburger », qui n'est donc pas un mot parasite. */
  const extras = motsTitre.filter((t) =>
    !attendus.some((a) => t.includes(a) || a.includes(t)
      || t.includes(a.slice(0, Math.max(4, a.length - 2))))).length;

  const precision = attendus.length / (attendus.length + extras);
  return { score: couverture * precision, couverture, extras };
}

const correspondance = (nomPlat, titre) => detail(nomPlat, titre).score;

/* Seuil calibré sur la VRAIE liste de plats du foyer (23 plats sans photo).
   Repères mesurés :
     100 %  « hachis parmentier » → « hachis parmentier »
      58 %  « Omelette / Tortillas » → « omelette épaisse ou tortilla »   ← à garder
      50 %  « galette sarazin jambon fromage » → « roulé de galette … spiruline »  ← à jeter
      33 %  les pièges (« pates carbo » → « pâtes au pesto »)             ← à jeter
   0,55 sépare exactement ce qu'il faut garder de ce qu'il faut jeter, en
   laissant une marge confortable au-dessus des faux amis. */
const SEUIL = 0.55;

async function page(url, msMax = 15000) {
  const r = await fetch(url, { headers: ENTETES, redirect: 'follow', signal: AbortSignal.timeout(msMax) });
  if (!r.ok) throw new Error(`Le site a répondu ${r.status}.`);
  return r.text();
}

/* Renvoie les candidats CLASSÉS, avec leur score. Ne télécharge aucune recette :
   c'est l'appelant qui décidera d'aller lire la meilleure. */
async function chercher(nomPlat, { max = 6 } = {}) {
  const nom = nettoyerTexte(nomPlat);
  if (!nom) return [];
  const out = [];

  for (const site of SITES) {
    let html;
    try { html = await page(site.url(nom)); }
    catch (e) { console.error(`Recherche ${site.nom} :`, e.message); continue; }

    const vus = new Set();
    for (const url of site.liens(html)) {
      if (vus.has(url)) continue;
      vus.add(url);
      const titre = site.titre(url);
      out.push({ url, titre, site: site.nom, ...detail(nom, titre) });
      if (vus.size >= max * 2) break;
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/* Le meilleur candidat, mais SEULEMENT s'il dépasse le seuil.
   `null` est une réponse légitime et fréquente : « je n'ai pas trouvé de page
   qui corresponde vraiment ». */
async function meilleur(nomPlat, { seuil = SEUIL } = {}) {
  const candidats = await chercher(nomPlat);
  const premier = candidats[0];
  if (!premier || premier.score < seuil) return null;
  return premier;
}

module.exports = { chercher, meilleur, correspondance, detail, motsUtiles, SEUIL };

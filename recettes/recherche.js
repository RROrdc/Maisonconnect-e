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
const gen = require('./generiques');

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

/* ⚠️ Les LIGATURES ne sont pas des accents : `normalize('NFD')` décompose « é »
   en e + accent, mais laisse « œ » intact. Le filtre [^a-z] le remplaçait donc
   par une espace, et « bœuf » devenait « b uf » — deux fragments trop courts,
   jetés. Le mot disparaissait purement et simplement du nom du plat.
   Conséquence vue en vrai : « Fajitas de bœuf aux poivrons » ne cherchait plus
   que [fajitas, poivrons], et acceptait des fajitas AU POULET. */
const sansAccent = (s) => String(s || '')
  .replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/* Mots qui ne distinguent rien : les garder ferait passer « tarte aux pommes »
   pour « tarte aux poireaux ».

   ⚠️ La seconde moitié de cette liste — les QUALIFICATIFS — a été ajoutée après
   mesure sur les vrais plats du foyer. Les noms venus des « idées de plats » de
   l'IA sont descriptifs (« Bo bun EXPRESS au poulet GRILLÉ », « Riz cantonais
   MAISON aux crevettes ») ; ces adjectifs ne figurent dans aucun titre de
   recette, et comptés comme attendus ils faisaient chuter la couverture sur la
   page qui était pourtant la bonne. Ils décrivent la préparation, pas le plat. */
const VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'au', 'aux', 'a', 'et', 'en', 'un', 'une',
  'sur', 'avec', 'sans', 'ou', 'mon', 'ma', 'mes', 'son', 'sa', 'ses', 'par', 'dans',
  'maison', 'facile', 'rapide', 'recette', 'pour',
  'express', 'minute', 'simple', 'leger', 'legere', 'gourmand', 'gourmande', 'delicieux',
  'traditionnel', 'traditionnelle', 'grille', 'grilles', 'grillee', 'grillees',
  'marine', 'marines', 'marinee', 'marinees', 'fait', 'faite', 'bon', 'bonne', 'super',
  'meilleur', 'meilleure', 'parfait', 'parfaite', 'veritable', 'vraie', 'vrai']);

/* Appareils et modes de cuisson. Ils décrivent COMMENT on fait, jamais QUOI.

   ⚠️ Ce cas est de notre fait : le projet demande explicitement à l'IA de tenir
   compte des appareils du foyer (§ 2 quinquies), elle nomme donc les plats
   « Taboulé libanais au MAGIMIX », « … pommes de terre grenaille au FOUR
   EXTÉRIEUR ». Ces mots ne figurent dans aucun titre de recette, et comptés
   comme attendus ils condamnaient la recherche à échouer.

   ⚠️ Mais « rôti », « poêlée » ou « gratin » peuvent NOMMER le plat (« poêlée de
   légumes », « rôti de porc »). On ne les retire donc que s'ils ne sont pas en
   tête — voir `motsUtiles`. */
const PREPARATION = new Set([
  'magimix', 'thermomix', 'ninja', 'woodfire', 'slushi', 'cookeo', 'companion',
  'airfryer', 'actifry', 'robot', 'cuiseur', 'autocuiseur', 'cocotte', 'friteuse',
  'four', 'exterieur', 'exterieure', 'poele', 'poeles', 'poelee', 'poelees',
  'vapeur', 'mijote', 'mijotee', 'roti', 'rotie', 'rotis', 'gratine', 'gratinee',
  'saute', 'sautee', 'sautes', 'sautees', 'braise', 'braisee', 'confit', 'confite',
  'croustillant', 'croustillante', 'fondant', 'fondante', 'crousti', 'plancha',
]);

/* ⚠️ Seuil à 3 lettres, pas 4. Avec 4, « bo » et « bun » disparaissaient : « Bo
   bun express au poulet grillé » cherchait [express, poulet] — c'est-à-dire tout
   sauf le nom du plat. Même chose pour « riz », « pho », « wok », « thé ». Les
   mots de 3 lettres sans intérêt sont couverts par la liste ci-dessus. */
const motsUtiles = (s) => sansAccent(s)
  .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
  .filter((m) => m.length >= 3 && !VIDES.has(m))
  /* Le premier mot survit toujours : c'est lui qui nomme le plat, même si c'est
     « poêlée » ou « rôti ». Les suivants, non — là ils décrivent la cuisson. */
  .filter((m, i) => i === 0 || !PREPARATION.has(m));

/* Distance de Levenshtein, deux lignes seulement. */
function distance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prec = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cour = [i];
    for (let j = 1; j <= b.length; j++) {
      cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prec = cour;
  }
  return prec[b.length];
}

/* Ressemblance entre deux mots, de 0 à 1.

   ⚠️ Ceci remplace une tolérance qui tronquait la FIN du mot (`m.slice(0, len-2)`).
   Elle ne rattrapait donc que les fautes de terminaison — or les vraies fautes
   sont au MILIEU : « ba(g)gels », « sara(z)in », « bru(s)chetta », « rigaton(n)i ».
   Résultat mesuré : 750g renvoyait bien « bruschetta tomates mozzarella » en
   premier résultat pour « bruchetta », et notre comparateur le notait 0 %.

   Seuil 0,75, calibré pour accepter les quatre fautes réelles du foyer tout en
   refusant les vrais faux amis :
     bruchetta / bruschetta  0,90 ✓      poulet / poulpe  0,67 ✗
     baggels   / bagels      0,86 ✓      creme  / crepe   0,60 ✗
     sarazin   / sarrasin    0,75 ✓      jambon / jambe   0,67 ✗
   En dessous de 5 lettres on n'essaie pas : à cette longueur, deux mots
   différents sont trop souvent à une lettre l'un de l'autre. */
const RESSEMBLANCE = 0.75;

/* Le pluriel n'est pas une faute : « galette » et « galettes », « tomate » et
   « tomates » sont le même mot. Le retirer d'abord évite de dépenser la
   tolérance aux fautes sur une simple marque de nombre — c'est ce qui faisait
   échouer « baggels » face à « bagel » (deux différences au lieu d'une). */
const singulier = (m) => (m.length > 4 ? m.replace(/[sx]$/, '') : m);

function proches(a, b) {
  if (a === b) return 1;
  const x = singulier(a), y = singulier(b);
  if (x === y) return 1;
  /* ⚠️ Au moins un des deux mots doit faire 6 lettres. En dessous, une seule
     lettre d'écart suffit à confondre deux mots bien distincts — « crème » et
     « crêpe » sont à 0,80 de ressemblance et n'ont rien à voir. */
  if (Math.max(x.length, y.length) < 6) return 0;
  if (Math.abs(x.length - y.length) > 3) return 0;
  const d = distance(x, y);
  if (d > 2) return 0;
  const s = 1 - d / Math.max(x.length, y.length);
  return s >= RESSEMBLANCE ? s : 0;
}

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
function detail(nomPlat, titre, { photo = false } = {}) {
  const attendus = motsUtiles(nomPlat);
  if (!attendus.length) return { score: 0, couverture: 0, extras: 0, teteOk: false };

  const motsTitre = motsUtiles(titre);
  const cible = sansAccent(titre).replace(/[^a-z0-9]+/g, ' ');

  /* Un mot attendu est-il présent dans le titre — exactement, en sous-chaîne,
     ou à une faute près ? Renvoie le crédit obtenu (0 à 1). */
  const credit = (m) => {
    if (cible.includes(m)) return 1;
    let meilleure = 0;
    for (const t of motsTitre) {
      if (t.includes(m) || m.includes(t)) return 1;
      meilleure = Math.max(meilleure, proches(m, t));
    }
    return meilleure;
  };

  let trouves = 0;
  const credits = attendus.map((m) => { const c = credit(m); trouves += c; return c; });
  const couverture = trouves / attendus.length;

  /* ⚠️ « Tous les mots sont présents » et « la couverture vaut 1 » ne sont PAS
     la même chose, et les confondre m'a coûté un tour : un mot rattrapé malgré
     une faute rapporte sa ressemblance (0,90 pour bruchetta/bruschetta), jamais
     1. La couverture d'un plat mal orthographié ne peut donc jamais atteindre
     100 %, et la règle « tout couvert » ne se déclenchait plus jamais dès qu'il
     y avait une faute — c'est-à-dire dans le seul cas qu'elle devait servir.
     La couverture PONDÈRE (elle classe), ce booléen CONSTATE (il décide). */
  const tousCouverts = credits.every((c) => c > 0);

  /* LA TÊTE, des DEUX côtés. En français, le premier mot significatif nomme la
     chose : « RIGATONI chorizo burrata », « BAGELS saumon ». Le contrôle est
     SYMÉTRIQUE — la tête du plat et celle du titre doivent être la même.

     ⚠️ Le contrôle à sens unique ne suffisait pas, et c'est le test qui l'a
     montré : « barbecue » se retrouve bien dans « papillote de fruits d'été au
     barbecue », donc la tête du plat était couverte… par un mot posé en fin de
     titre, sur une recette de dessert. Exiger que les deux commencent pareil
     règle le cas sans liste de mots interdits à tenir à jour. */
  const teteTitre = motsTitre[0] || '';
  const teteOk = credits[0] > 0 && !!teteTitre
    && (proches(attendus[0], teteTitre) > 0
      || teteTitre.includes(attendus[0]) || attendus[0].includes(teteTitre));

  /* Un mot du titre est « en trop » si aucun mot attendu ne s'y rapporte. */
  const extras = motsTitre.filter((t) =>
    !attendus.some((a) => t.includes(a) || a.includes(t) || proches(a, t))).length;

  /* ⚠️ Les mots en trop ne pèsent PAS le même poids selon ce qu'on cherche.
     Pour une RECETTE, ils comptent plein pot : « gratin de courgettes au
     chèvre » n'est pas « gratin de courgettes », les ingrédients diffèrent.
     Pour une PHOTO, un titre plus précis reste une image parfaitement juste —
     « bruschetta tomates mozzarella » illustre très bien « bruschetta ». Les
     pénaliser pareil, c'était refuser 100 % des titres un peu détaillés, alors
     que ce sont précisément ceux qui portent les belles photos. */
  const poids = photo ? 0.35 : 1;
  const precision = attendus.length / (attendus.length + extras * poids);
  return { score: couverture * precision, couverture, extras, teteOk, tousCouverts };
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
async function chercher(nomPlat, { max = 6, photo = false } = {}) {
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
      out.push({ url, titre, site: site.nom, ...detail(nom, titre, { photo }) });
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

/* Accepter une page POUR SA PHOTO — deux règles explicites, pas un seuil.

   Un seuil chiffré ne se discute pas et ne s'explique pas. À la première
   tentative j'en avais posé un bas (0,42) en comptant sur lui pour trier : le
   test a immédiatement laissé entrer « pâtes carbo → pâtes au pesto », c'est-à-
   dire l'erreur exacte que ce fichier existe pour empêcher. Deux règles
   structurelles font mieux, et se disent en une phrase :

   1. MÊME TÊTE — le plat et le titre doivent commencer par le même mot.
      Élimine risotto/rigatoni, club sandwich/bagels, papillote/barbecue.

   2. TOUT COUVERT, ou RIEN EN TROP.
      • tous les mots retrouvés → le titre contient tout le nom du plat ; s'il en
        dit plus, c'est une version plus PRÉCISE du même plat, et sa photo
        convient. « bruschetta tomates mozzarella » illustre « bruschetta ».
      • aucun mot en trop → le titre est une version plus SOBRE du plat.
        « riz cantonais » illustre « riz cantonais aux crevettes ».
      Ce qu'on refuse, c'est le cas MIXTE : un mot attendu manque ET un mot
      étranger le remplace. C'est la signature d'un autre plat — « pâtes AU
      PESTO » quand on cherchait « carbo », « tarte aux POIREAUX » quand on
      cherchait des pommes.

   Le score ne sert plus qu'à CLASSER les candidats entre eux ; le plancher
   n'écarte que l'absurde. */
const SEUIL_PHOTO = 0.30;

const convientPourPhoto = (d) => !!d.teteOk
  && (d.tousCouverts || d.extras === 0)
  && d.score >= SEUIL_PHOTO;

/* Requêtes à essayer, de la plus fidèle à la plus courte.

   Les noms venus des « idées de plats » décrivent une ASSIETTE entière —
   « Poulet mariné au citron et origan, pommes de terre grenaille au four
   extérieur » — là où un site de cuisine indexe des RECETTES. Aucune page ne
   portera jamais le plat principal ET son accompagnement : cherché tel quel, ce
   nom ne peut pas aboutir.

   🔑 La règle qui rend la réduction sûre : on ne garde que des mots du plat
   LUI-MÊME, jamais un mot inventé, et la tête est toujours conservée. Le
   candidat est ensuite jugé CONTRE LA REQUÊTE employée — ce qui reste honnête,
   puisqu'elle ne dit rien que le plat ne dise déjà.

   ⚠️ Et on ne réduit qu'à partir de 4 mots significatifs, jamais en dessous de
   3. Sans ce plancher, « tarte aux pommes » se réduirait à « tarte » et
   accepterait une tarte aux poireaux — exactement ce qu'on interdit. */
function variantes(nomPlat, { generiques = '' } = {}) {
  const mots = motsUtiles(nomPlat);
  const out = [{ q: nettoyerTexte(nomPlat), generique: false }];
  if (mots.length >= 4) out.push({ q: mots.slice(0, 3).join(' '), generique: false });
  /* DERNIER recours : le nom ne désigne pas un plat mais un GENRE (« barbecue »,
     « Soupe & tartines »). On cherche alors un terme concret qui le représente.
     Placé en dernier exprès : un plat qui existe vraiment est trouvé avant, et
     ne récupère donc jamais une image de catégorie à la place de la sienne. */
  const g = gen.pour(mots, generiques);
  if (g) out.push({ q: g, generique: true });
  return out;
}

async function meilleurPourPhoto(nomPlat, { generiques = '' } = {}) {
  for (const v of variantes(nomPlat, { generiques })) {
    const candidats = await chercher(v.q, { photo: true });
    const bon = candidats.find(convientPourPhoto);
    /* On DIT quand la photo illustre le GENRE et non le plat : sur un mur, une
       image générique passe très bien — à condition de ne pas la faire passer
       pour la photo du plat. */
    if (bon) return { ...bon, requete: v.q, generique: v.generique };
  }
  return null;
}

module.exports = { chercher, meilleur, meilleurPourPhoto, convientPourPhoto, variantes,
  correspondance, detail, motsUtiles, distance, proches, SEUIL, SEUIL_PHOTO };

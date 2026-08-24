/* Les calculs purs : jours fériés, rayons, mise à l'échelle des quantités.

   Aucun serveur nécessaire — ce sont des fonctions. C'est aussi pour ça qu'elles
   sont les plus faciles à vérifier sérieusement, et qu'on ne s'en prive pas. */
const path = require('path');
const A = require('./aide');

const feries = require(path.join(__dirname, '..', '..', 'feries'));
const rayons = require(path.join(__dirname, '..', '..', 'recettes', 'rayons'));
const quantites = require(path.join(__dirname, '..', '..', 'recettes', 'quantites'));
const recherche = require(path.join(__dirname, '..', '..', 'recettes', 'recherche'));
const generiques = require(path.join(__dirname, '..', '..', 'recettes', 'generiques'));

/* Dates de Pâques connues : le seul moyen sérieux de valider l'algorithme est de
   le confronter à des valeurs établies ailleurs. */
const PAQUES = {
  2000: '2000-04-23', 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05',
  2027: '2027-03-28', 2028: '2028-04-16', 2030: '2030-04-21', 2038: '2038-04-25',
};

const RAYONS = ['Fruits & légumes', 'Frais', 'Surgelés', 'Épicerie', 'Boissons', 'Maison / hygiène', 'Autre'];
const CAS_RAYONS = [
  ['200 g de lardons', 'Frais'], ['poulet', 'Frais'], ['4 oeufs', 'Frais'],
  ['pommes de terre', 'Fruits & légumes'], ['2 pommes', 'Fruits & légumes'],
  ['1 gousse d’ail', 'Fruits & légumes'], ['3 tomates', 'Fruits & légumes'],
  ['tomates pelées', 'Épicerie'], ['jus d’orange', 'Boissons'],
  ['papier toilette', 'Maison / hygiène'], ['lessive', 'Maison / hygiène'], ['déo', 'Maison / hygiène'],
  /* Les pièges : un fragment ne doit JAMAIS déclencher. */
  ['bouillon de volaille', 'Épicerie'],   // pas « ail » dans « volaille »
  ['thermomix', ''],                      // pas « thé »
  ['citronnelle', ''],                    // pas « citron »
  ['raie', ''],                           // pas « raisin »
  ['un truc bizarre', ''], ['', ''],
];

/* Fautes réellement présentes dans la bibliothèque du foyer, et faux amis qui
   les entourent de près. La tolérance doit passer les unes sans passer les
   autres — d'où les deux colonnes. */
const CAS_MOTS = [
  ['bruchetta', 'bruschetta', true],   // faute au MILIEU du mot
  ['baggels', 'bagels', true],         // consonne doublée + pluriel
  ['sarazin', 'sarrasin', true],
  ['rigatonni', 'rigatoni', true],
  ['tomates', 'tomate', true],         // simple pluriel
  ['galettes', 'galette', true],
  ['poulet', 'poulpe', false],
  ['creme', 'crepe', false],           // 5 lettres, 1 écart : trop court pour risquer
  ['jambon', 'jambe', false],
  ['risotto', 'rigatoni', false],
  ['riz', 'ris', false],
];

/* Ce qu'il ne faut JAMAIS accepter comme photo. */
const CAS_PHOTO_NON = [
  ['pates carbo', 'pates au pesto', 'le faux ami historique du projet'],
  ['tarte aux pommes', 'tarte aux poireaux', 'sucré ≠ salé'],
  ['salade de quinoa a l orientale', 'salade d orange a l orientale', 'quinoa ≠ orange'],
  ['rigatonni chorizo burrata', 'risotto au chorizo', 'le riz n’est pas des pâtes'],
  ['baggels poulet', 'club sandwich au poulet', 'pain différent'],
  ['barbecue', 'papillote de fruits dete au barbecue', 'un dessert, pas un barbecue'],
  ['butter chicken', 'poulet tikka massala', 'plat indien voisin mais différent'],
];

/* Ce qu'il FAUT accepter : une photo n’a pas à être une preuve de recette. */
const CAS_PHOTO_OUI = [
  ['bruchetta', 'bruschetta tomates mozzarella', 'faute au milieu + titre plus précis'],
  ['baggels Saumon', 'bagel de saumon fume et oeufs brouilles', 'faute + titre détaillé'],
  ['Riz cantonais maison aux crevettes', 'riz cantonais', 'titre plus sobre, rien en trop'],
  ['Bo bun express au poulet grillé', 'bo bun de poulet', 'qualificatifs ignorés'],
  ['Fajitas de bœuf aux poivrons grillés', 'fajitas a la viande de boeuf et poivrons', 'ligature bœuf'],
];

/* Repères d’origine du mode « recette », calibrés le 19/08 : ils ne doivent pas
   bouger quand on assouplit le mode « photo ». */
const CAS_RECETTE = [
  ['hachis parmentier', 'hachis parmentier', true],
  ['Omelette / Tortillas', 'omelette epaisse ou tortilla', true],
  ['pates carbo', 'pates au pesto', false],
  ['galette sarazin jambon fromage', 'roule de galette de sarrasin a la spiruline', false],
];

module.exports = async function (muet) {
  const t = A.compteur(); t.muet = muet;

  t.titre('Jours fériés — dimanche de Pâques');
  for (const [an, attendu] of Object.entries(PAQUES)) {
    const obtenu = feries.ymd(feries.paques(Number(an)));
    t.dire(obtenu === attendu, `Pâques ${an}`, obtenu);
  }
  const f = feries.pour(2026);
  t.dire(f.length === 11, '11 jours fériés par an (métropole)', String(f.length));
  const table = feries.parDate(new Date('2026-06-15'));
  t.dire(table['2026-05-14'] === 'Ascension', 'Ascension 2026 = jeudi 14 mai');
  t.dire(table['2026-05-25'] === 'Lundi de Pentecôte', 'Pentecôte 2026 = 25 mai');
  t.dire(feries.estFerie('2026-12-25') === 'Noël', 'estFerie sur une chaîne');
  t.dire(feries.estFerie(new Date(2026, 6, 14)) === 'Fête nationale', 'estFerie sur une Date');
  const fen = feries.fenetre(new Date('2026-08-19'));
  t.dire(fen.length === 33, 'fenêtre = 3 années', String(fen.length));
  t.dire(!fen.map((x) => x.date).filter((d, i, a) => a.indexOf(d) !== i).length, 'aucune date en double');

  t.titre('Rayon deviné');
  for (const [article, attendu] of CAS_RAYONS) {
    const obtenu = rayons.deviner(article, RAYONS);
    t.dire(obtenu === attendu, `« ${article || '(vide)'} »`,
      obtenu === attendu ? (obtenu || 'non rangé') : `${JSON.stringify(obtenu)} au lieu de ${JSON.stringify(attendu)}`);
  }
  t.dire(rayons.deviner('lessive', ['Frais', 'Épicerie']) === '',
    'rayon absent de la liste du foyer → on ne range pas');

  t.titre('Mise à l’échelle des quantités');
  const r = quantites.verifier();
  t.dire(!r.echecs.length, `${r.total - r.echecs.length}/${r.total} cas passent`);
  for (const e of r.echecs)
    t.dire(false, `« ${e.entree} » ×${e.facteur}`, `attendu « ${e.attendu} », obtenu « ${e.obtenu} »`);
  t.dire(quantites.additionner('200 g', '150 g de lardons') === '350 g de lardons',
    'addition de deux lignes de même unité');
  t.dire(quantites.additionner('2 oeufs', '200 g de farine') === '2 oeufs',
    'unités différentes → on garde la première (incomplet vaut mieux que faux)');

  /* ------------------------------------------------- photos de plats -------
     Aucun appel réseau ici : on juge des COUPLES (nom du plat, titre trouvé)
     relevés sur de vraies recherches. C'est ce qui rend le contrôle rejouable —
     et la moitié « faux amis » compte plus que l'autre. Une vignette absente se
     remarque à peine ; une vignette FAUSSE sur un mur fait douter de tout le
     reste de l'écran. */
  t.titre('Photos de plats — mots à une faute près');
  for (const [a, b, attendu] of CAS_MOTS) {
    const obtenu = recherche.proches(a, b) > 0;
    t.dire(obtenu === attendu, `${a} ~ ${b}`, attendu ? 'doit correspondre' : 'ne doit PAS correspondre');
  }
  t.dire(recherche.motsUtiles('Fajitas de bœuf aux poivrons grillés').includes('boeuf'),
    '🔑 la ligature « bœuf » survit (sinon on accepte des fajitas au poulet)');
  /* « bo » fait deux lettres et reste écarté — sans conséquence, puisque le
     titre trouvé perd le sien de la même façon : on compare « bun poulet » à
     « bun poulet ». Ce qui comptait, c'est que « bun » (3 lettres) survive et
     que les qualificatifs partent ; avec l'ancien seuil à 4 lettres, ce plat
     cherchait littéralement [express, poulet]. */
  t.dire(recherche.motsUtiles('Bo bun express au poulet grillé').join(' ') === 'bun poulet',
    'les mots de 3 lettres restent, les qualificatifs partent',
    recherche.motsUtiles('Bo bun express au poulet grillé').join(' '));

  t.titre('Photos de plats — requêtes de repli');
  /* 🔑 Le plancher est le garde-fou : sans lui, « tarte aux pommes » se
     réduirait à « tarte » et accepterait une tarte aux poireaux. */
  const requetes = (s) => recherche.variantes(s, { generiques: '' }).map((v) => v.q);
  for (const court of ['tarte aux pommes', 'pates carbo', 'salade de quinoa a l orientale'])
    t.dire(requetes(court).length === 1,
      `« ${court} » n’est PAS réduit (moins de 4 mots)`, requetes(court).join(' | '));
  const vLong = requetes('Poulet mariné au citron et origan, pommes de terre grenaille au four extérieur');
  t.dire(vLong.length === 2 && vLong[1] === 'poulet citron origan',
    'un nom d’assiette entière est réduit à son noyau', vLong.join(' | '));
  t.dire(recherche.motsUtiles('Taboulé libanais persil-menthe au Magimix').join(' ') === 'taboule libanais persil menthe',
    '🔑 l’appareil (« au Magimix ») ne compte pas comme un mot du plat',
    recherche.motsUtiles('Taboulé libanais persil-menthe au Magimix').join(' '));
  t.dire(recherche.motsUtiles('Poêlée de légumes du soleil')[0] === 'poelee',
    'mais « poêlée » en TÊTE nomme bien le plat, on la garde');

  t.titre('Photos de plats — noms qui désignent un GENRE');
  const mots = (s) => recherche.motsUtiles(s);
  t.dire(generiques.pour(mots('barbecue'), '') === 'brochettes au barbecue',
    '« barbecue » cherche une image du genre', generiques.pour(mots('barbecue'), ''));
  t.dire(generiques.pour(mots('Soupe & tartines'), '') === 'soupe de legumes',
    '« Soupe & tartines » aussi', generiques.pour(mots('Soupe & tartines'), ''));
  /* 🔑 Les garde-fous du générique : il ne doit JAMAIS déborder sur un vrai plat. */
  t.dire(generiques.pour(mots('soupe de potimarron au lait de coco'), '') === '',
    '🔑 un nom précis ne devient PAS générique (plus de 3 mots)');
  t.dire(generiques.pour(mots('rigatonni chorizo burrata'), '') === '',
    'un vrai plat n’a pas de substitution');
  t.dire(generiques.pour(mots('Restaurant'), '') === '' && generiques.pour(mots('Restes du frigo'), '') === '',
    '🔑 « Pas de cuisine » ne reçoit jamais de photo');
  t.dire(generiques.pour(mots('barbecue'), 'barbecue = travers de porc') === 'travers de porc',
    'le réglage /admin/ l’emporte sur la table par défaut');
  /* Le générique arrive en DERNIER : un plat qui existe est trouvé avant. */
  const vGen = recherche.variantes('barbecue', { generiques: '' });
  t.dire(vGen.length === 2 && vGen[0].generique === false && vGen[1].generique === true,
    'le vrai nom est essayé d’abord, le genre en dernier recours');
  /* 🔑 Le trou trouvé par ce test avant les vraies données : « pâtes » EST un
     genre, donc « pâtes carbo » se serait rabattu dessus et aurait accepté
     « pâtes au pesto » — le faux ami historique, rentré par la porte de
     derrière. Il faut que TOUS les mots soient des mots de genre. */
  t.dire(recherche.variantes('pates carbo', { generiques: '' }).length === 1,
    '🔑 un seul mot de genre ne suffit pas : « pâtes carbo » reste un plat précis');
  t.dire(generiques.pour(mots('salade ebly'), '') === '',
    '« salade ebly » non plus — « ebly » apporte une précision');

  t.titre('Photos de plats — faux amis refusés');
  for (const [plat, titre, pourquoi] of CAS_PHOTO_NON)
    t.dire(!recherche.convientPourPhoto(recherche.detail(plat, titre, { photo: true })),
      `« ${plat} » ≠ « ${titre} »`, pourquoi);

  t.titre('Photos de plats — bons candidats acceptés');
  for (const [plat, titre, pourquoi] of CAS_PHOTO_OUI)
    t.dire(recherche.convientPourPhoto(recherche.detail(plat, titre, { photo: true })),
      `« ${plat} » → « ${titre} »`, pourquoi);

  t.titre('Photos de plats — le mode recette n’a pas bougé');
  for (const [plat, titre, garde] of CAS_RECETTE) {
    const s = recherche.detail(plat, titre).score;
    t.dire((s >= recherche.SEUIL) === garde, `« ${plat} » → « ${titre} »`,
      `${Math.round(s * 100)} % — ${garde ? 'à garder' : 'à jeter'}`);
  }

  return t;
};

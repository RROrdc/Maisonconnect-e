/* Les noms de repas qui ne désignent pas UN plat.

   Remarque de Rémi, et elle est juste : « pour des noms comme soupe ou barbecue
   je comprends que ce soit compliqué pour une recette, mais c'est tellement
   commun qu'il y a des photos ».

   La distinction est exactement là. Pour « rigatoni chorizo burrata », une photo
   approximative serait FAUSSE — c'est un plat précis, et une autre assiette se
   remarque. Pour « barbecue », il n'existe aucune recette « barbecue » : le mot
   nomme un GENRE. N'importe quelle image du genre est alors juste, parce qu'il
   n'y a rien de plus précis à trahir.

   La parade est donc de chercher autre chose, explicitement : un terme concret
   qui représente le genre. On ne relâche AUCUN garde-fou — le résultat est jugé
   normalement, simplement contre le terme substitué.

   ⚠️ Ce n'est tenté qu'en DERNIER RECOURS, après l'échec du nom réel. Un plat
   qui porte un mot générique mais qui existe vraiment (« soupe à l'oignon ») est
   donc trouvé par la voie normale, et ne passe jamais par ici. */

/* Table par défaut. Surchargeable par le réglage `photos_generiques`
   (une ligne « generique = terme cherché ») — aucun foyer n'est codé en dur. */
const DEFAUT = {
  barbecue: 'brochettes au barbecue',
  grillades: 'grillades au barbecue',
  plancha: 'brochettes a la plancha',
  soupe: 'soupe de legumes',
  soupes: 'soupe de legumes',
  veloute: 'veloute de legumes',
  apero: 'aperitif dinatoire',
  aperitif: 'aperitif dinatoire',
  tapas: 'tapas',
  buffet: 'buffet froid',
  brunch: 'brunch',
  salade: 'salade composee',
  sandwich: 'sandwich',
  sandwichs: 'sandwich',
  tartines: 'tartines',
  crepes: 'crepes',
  gaufres: 'gaufres',
  raclette: 'raclette',
  fondue: 'fondue savoyarde',
  pizza: 'pizza maison',
  pates: 'pates',
  gratin: 'gratin',
  quiche: 'quiche lorraine',
  omelette: 'omelette',
  poisson: 'poisson grille',
  legumes: 'legumes rotis',
};

/* Ce qui n'est PAS un repas cuisiné : jamais de photo, jamais de recherche.
   Ce sont les options « Pas de cuisine » du menu (§ 2, série 2 du 13/08). Leur
   coller une image de restaurant serait absurde sur un écran de cuisine. */
const JAMAIS = new Set(['restaurant', 'resto', 'sortie', 'livraison', 'commande',
  'traiteur', 'restes', 'frigo', 'chacun', 'dehors', 'invitation', 'jeune']);

const sansAccent = (s) => String(s || '')
  .replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/* Lit le réglage : une substitution par ligne, « clé = terme ». */
function table(reglage) {
  const t = { ...DEFAUT };
  for (const ligne of String(reglage || '').split('\n')) {
    const m = /^\s*([^=#]+?)\s*=\s*(.+?)\s*$/.exec(ligne);
    if (m) t[sansAccent(m[1])] = m[2].trim();
  }
  return t;
}

/* Le terme à chercher pour un nom générique — ou '' si le nom désigne un vrai
   plat (le cas courant), ou s'il ne désigne pas un repas du tout.

   🔑 EXIGENCE : *tous* les mots significatifs doivent être des mots de genre.
   Il ne suffit pas qu'un le soit.

   Le test a trouvé le trou avant les vraies données : « pâtes carbo » contient
   « pâtes », qui est bien un genre — la substitution se serait déclenchée, aurait
   cherché « pâtes », et aurait accepté « pâtes au pesto », dont la tête
   correspond et dont le seul mot attendu est couvert. Autrement dit LE faux ami
   historique du projet serait rentré par la porte de derrière.

   La règle juste est donc : dès qu'un mot APPORTE une précision (« carbo »,
   « ebly », « potimarron »), le plat est précis, et une image de catégorie
   serait fausse. Le genre ne vaut que pour un nom qui ne dit rien de plus que
   le genre. */
const MAX_MOTS = 3;

function pour(mots, reglage) {
  if (!mots.length || mots.length > MAX_MOTS) return '';
  if (mots.some((m) => JAMAIS.has(m))) return '';
  const t = table(reglage);
  if (!mots.every((m) => t[m])) return '';
  /* La tête nomme le genre : c'est son terme qu'on cherche. */
  return t[mots[0]];
}

module.exports = { pour, table, DEFAUT, JAMAIS };

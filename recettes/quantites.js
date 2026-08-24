/* Mise à l'échelle des quantités.

   Objectif : « samedi soir on sera six » doit recalculer la recette ET les courses.

   Deux règles gouvernent tout ce fichier :
   1. NE JAMAIS ABÎMER une ligne qu'on n'a pas comprise. « Sel », « Poivre du
      moulin », « Huile d'olive » ressortent identiques. Une ligne fausse est pire
      qu'une ligne non recalculée.
   2. ARRONDIR COMME UN CUISINIER : des œufs et des tranches à l'entier, les
      grammes au pas de 5, les cuillères au demi. Et un plancher, pour ne jamais
      tomber à 0 — « 0 g de beurre » ne veut rien dire.

   ⚠️ Piège d'alternance de regex, payé une fois : avec le nombre simple en tête,
   « 1/2 citron » matchait « 1 » et laissait « /2 » dans le nom (« 4 /2 citron »).
   Les formes COMPOSÉES — mixte, puis fraction — doivent passer en premier. */

const UNICODE = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const FRAC = '½¼¾⅓⅔⅛⅜⅝⅞';

const dec = (s) => Number(String(s).replace(',', '.'));

/* L'ordre EST la logique : du plus composé au plus simple. */
const FORMES = [
  { re: new RegExp(`^(\\d+)\\s+(\\d+)\\s*/\\s*(\\d+)`), lire: (m) => Number(m[1]) + Number(m[2]) / Number(m[3]) },
  { re: new RegExp(`^(\\d+)\\s*([${FRAC}])`), lire: (m) => Number(m[1]) + UNICODE[m[2]] },
  { re: new RegExp(`^(\\d+)\\s*/\\s*(\\d+)`), lire: (m) => Number(m[1]) / Number(m[2]) },
  { re: new RegExp(`^([${FRAC}])`), lire: (m) => UNICODE[m[1]] },
  { re: /^(\d+(?:[.,]\d+)?)\s*(?:à|a|-|–|~)\s*(\d+(?:[.,]\d+)?)/, lire: (m) => dec(m[1]), lire2: (m) => dec(m[2]) },
  { re: /^(\d+(?:[.,]\d+)?)/, lire: (m) => dec(m[1]) },
];

/* Une unité doit être suivie d'un blanc ou d'une ponctuation : sans ça, « l' » de
   « l'ail » passerait pour des litres, et « g » mangerait le début de « gousse ». */
const FIN = `(?=[\\s,.;:)]|$)`;
const UNITES = [
  { re: new RegExp(`^(kg|kilogrammes?|kilos?)${FIN}`, 'i'), regle: 'poids_lourd' },
  { re: new RegExp(`^(mg)${FIN}`, 'i'), regle: 'menu_pas' },
  { re: new RegExp(`^(g|gr|grammes?)${FIN}`, 'i'), regle: 'pas_de_5' },
  { re: new RegExp(`^(l|litres?)${FIN}`, 'i'), regle: 'poids_lourd' },
  { re: new RegExp(`^(dl|d[ée]cilitres?)${FIN}`, 'i'), regle: 'demi' },
  { re: new RegExp(`^(cl|centilitres?)${FIN}`, 'i'), regle: 'pas_de_5' },
  { re: new RegExp(`^(ml|millilitres?)${FIN}`, 'i'), regle: 'pas_de_5' },
  /* « c. à s. », « c. à soupe », « cuillères à soupe » — les trois s'écrivent dans
     les vraies fiches. La forme longue doit être dans l'alternative, pas seulement
     l'abréviation, sinon l'unité n'est pas reconnue et la ligne part en arrondi
     entier sans qu'on s'en aperçoive (1,5 c. à café devenait 2). */
  { re: new RegExp(`^(c\\.?\\s*[àa]\\s*s(?:\\.|oupe)|cuill?[èe]res?\\s*[àa]\\s*soupe|cuil\\.?\\s*[àa]\\s*soupe|c[àa]s)${FIN}`, 'i'), regle: 'demi' },
  { re: new RegExp(`^(c\\.?\\s*[àa]\\s*c(?:\\.|af[ée])|cuill?[èe]res?\\s*[àa]\\s*caf[ée]|cuil\\.?\\s*[àa]\\s*caf[ée]|c[àa]c)${FIN}`, 'i'), regle: 'demi' },
  { re: new RegExp(`^(pinc[ée]es?|poign[ée]es?)${FIN}`, 'i'), regle: 'entier' },
  { re: new RegExp(`^(gousses?|tranches?|sachets?|bo[îi]tes?|feuilles?|brins?|branches?|bottes?|verres?|tasses?|filets?|bouquets?|tiges?|barquettes?|pots?|briques?)${FIN}`, 'i'), regle: 'entier' },
];

/* Analyse une ligne d'ingrédient.
   Retourne `null` quand aucun nombre n'est trouvé — le signal « je n'ai pas compris,
   ne touche à rien ». */
function analyser(ligne) {
  const brut = String(ligne || '');
  const texte = brut.trim();
  if (!texte) return null;

  let forme = null, m = null;
  for (const f of FORMES) {
    const essai = f.re.exec(texte);
    if (essai) { forme = f; m = essai; break; }
  }
  if (!forme) return null;

  const qte = forme.lire(m);
  const qte2 = forme.lire2 ? forme.lire2(m) : null;
  if (!Number.isFinite(qte)) return null;

  const apres = texte.slice(m[0].length).replace(/^\s+/, '');

  /* L'unité est renvoyée TELLE QU'ÉCRITE. On ne s'en sert que pour choisir la règle
     d'arrondi : normaliser « litre » en « l » réécrirait la recette de l'auteur. */
  let unite = '', regle = 'entier';
  for (const u of UNITES) {
    const e = u.re.exec(apres);
    if (e) { unite = e[1]; regle = u.regle; break; }
  }
  const reste = apres.slice(unite.length).replace(/^\s+/, '');

  return { brut, qte, qte2, unite, regle, reste, intervalle: qte2 !== null };
}

const ARRONDIS = {
  entier: (v) => Math.max(1, Math.round(v)),
  demi: (v) => Math.max(0.5, Math.round(v * 2) / 2),
  pas_de_5: (v) => (v >= 10 ? Math.max(5, Math.round(v / 5) * 5) : Math.max(1, Math.round(v))),
  poids_lourd: (v) => Math.max(0.05, Math.round(v * 20) / 20),
  menu_pas: (v) => Math.max(1, Math.round(v)),
};

/* Écriture française, sans décimale inutile : « 3 » et non « 3,0 ». */
const ecrire = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

/* Recompose la ligne en ne changeant QUE le nombre. */
const recomposer = (a, q, q2) =>
  [a.intervalle ? `${ecrire(q)} à ${ecrire(q2)}` : ecrire(q), a.unite, a.reste]
    .filter(Boolean).join(' ');

function mettreAEchelle(ligne, facteur) {
  const f = Number(facteur);
  if (!Number.isFinite(f) || f === 1 || f <= 0) return String(ligne || '');
  const a = analyser(ligne);
  if (!a) return String(ligne || '');                       // règle 1
  const arrondir = ARRONDIS[a.regle] || ARRONDIS.entier;
  return recomposer(a, arrondir(a.qte * f), a.intervalle ? arrondir(a.qte2 * f) : null);
}

/* Additionne deux lignes qui parlent du même ingrédient (« 200 g » + « 150 g de
   lardons » = « 350 g de lardons »). L'addition n'a lieu QUE si les deux lignes
   portent une quantité de même unité — sinon on garde la première.
   Mieux vaut une course incomplète qu'une course fausse. */
function additionner(a, b) {
  const x = analyser(a), y = analyser(b);
  if (!x || !y) return a;
  if (x.unite.toLowerCase() !== y.unite.toLowerCase()) return a;
  if (x.intervalle || y.intervalle) return a;
  const arrondir = ARRONDIS[x.regle] || ARRONDIS.entier;
  /* On garde le libellé le plus informatif des deux : « 200 g » seul ne dit pas
     de quoi il s'agit. */
  const base = x.reste.length >= y.reste.length ? x : y;
  return recomposer({ ...base, intervalle: false }, arrondir(x.qte + y.qte), null);
}

/* ------------------------------------------------------------------ auto-test
   Les cas viennent des vraies fiches du foyer. Lancer :
     node outils/tester-recette.js --quantites                                   */
const CAS = [
  ['Sel', 2, 'Sel'],
  ['Poivre du moulin', 3, 'Poivre du moulin'],
  ['Huile d’olive', 2, 'Huile d’olive'],
  ['4 oeufs', 2, '8 oeufs'],
  ['4 œufs', 0.5, '2 œufs'],
  ['200 g de farine', 1.5, '300 g de farine'],
  ['100 g de beurre', 0.5, '50 g de beurre'],
  ['3 g de levure', 0.5, '2 g de levure'],
  ['1,5 kg de pommes de terre', 2, '3 kg de pommes de terre'],
  ['1/2 citron', 4, '2 citron'],
  ['½ oignon', 2, '1 oignon'],
  ['1 ½ litre de lait', 2, '3 litre de lait'],
  ['1 1/2 verre de riz', 2, '3 verre de riz'],
  ['2 à 3 tomates', 2, '4 à 6 tomates'],
  ['1 c. à soupe d’huile', 3, '3 c. à soupe d’huile'],
  ['1 c. à café de sel', 1.5, '1,5 c. à café de sel'],
  ['330 ml de bière', 2, '660 ml de bière'],
  ['4 tranches de jambon', 0.5, '2 tranches de jambon'],
  ['1 oeuf', 0.25, '1 oeuf'],
  ['1 gousse d’ail', 3, '3 gousse d’ail'],
  ['500 g de lardons', 1, '500 g de lardons'],
  ['20 cl de crème', 1.5, '30 cl de crème'],
  ['1 pincée de muscade', 4, '4 pincée de muscade'],
  ['2 cuillères à soupe de crème', 1.5, '3 cuillères à soupe de crème'],
  ['1 c. à s. de moutarde', 3, '3 c. à s. de moutarde'],
  ['3 c. à café de sucre', 0.5, '1,5 c. à café de sucre'],
];

function verifier() {
  const echecs = [];
  for (const [entree, facteur, attendu] of CAS) {
    const obtenu = mettreAEchelle(entree, facteur);
    if (obtenu !== attendu) echecs.push({ entree, facteur, attendu, obtenu });
  }
  return { total: CAS.length, echecs };
}

module.exports = { analyser, mettreAEchelle, additionner, verifier, CAS };

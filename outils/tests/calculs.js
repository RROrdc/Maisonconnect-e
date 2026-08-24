/* Les calculs purs : jours fériés, rayons, mise à l'échelle des quantités.

   Aucun serveur nécessaire — ce sont des fonctions. C'est aussi pour ça qu'elles
   sont les plus faciles à vérifier sérieusement, et qu'on ne s'en prive pas. */
const path = require('path');
const A = require('./aide');

const feries = require(path.join(__dirname, '..', '..', 'feries'));
const rayons = require(path.join(__dirname, '..', '..', 'recettes', 'rayons'));
const quantites = require(path.join(__dirname, '..', '..', 'recettes', 'quantites'));

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

  return t;
};

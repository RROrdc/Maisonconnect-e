/* Deviner le rayon d'un article de courses.

   À quoi ça sert : les ingrédients venus d'une recette arrivent SANS rayon, et
   une liste non rangée se parcourt mal en magasin — on fait deux fois le tour.

   Deux règles, et la seconde compte autant que la première :

   1. On ne devine que ce qu'on reconnaît **franchement**. Un mot entier, pas un
      fragment : sans ça, « raisin » attrape « raie », et « citronnelle » part au
      rayon fruits. Le doute se règle en ne rangeant pas — un article « sans
      rayon » reste visible (le groupe existe pour ça depuis la correction du
      19/08), alors qu'un article mal rangé se cherche au mauvais endroit.

   2. Le rayon deviné doit exister dans la liste RÉELLE du foyer, qui est
      configurable. On propose donc un rayon « canonique » que l'appelant fait
      correspondre à sa propre liste — pas l'inverse. */

const sansAccent = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/* Rayons canoniques → mots qui les désignent sans ambiguïté.
   Volontairement courts : cette table doit rester relisible et corrigible par
   Rémi, pas devenir un dictionnaire. */
const TABLE = [
  ['Fruits & légumes', [
    'pomme', 'pommes', 'poire', 'banane', 'orange', 'citron', 'citrons', 'fraise', 'fraises',
    'raisin', 'peche', 'peches', 'abricot', 'melon', 'pasteque', 'kiwi', 'ananas', 'mangue',
    'tomate', 'tomates', 'salade', 'laitue', 'roquette', 'concombre', 'courgette', 'courgettes',
    'aubergine', 'poivron', 'poivrons', 'carotte', 'carottes', 'oignon', 'oignons', 'echalote',
    'ail', 'poireau', 'poireaux', 'brocoli', 'chou', 'choux', 'haricots', 'petits pois',
    'champignon', 'champignons', 'pomme de terre', 'pommes de terre', 'patate', 'patates',
    'courge', 'potiron', 'navet', 'radis', 'celeri', 'fenouil', 'epinards', 'avocat',
    'persil', 'basilic', 'coriandre', 'ciboulette', 'menthe', 'herbes',
  ]],
  ['Frais', [
    'lait', 'beurre', 'creme', 'yaourt', 'yaourts', 'fromage', 'gruyere', 'emmental', 'comte',
    'mozzarella', 'parmesan', 'chevre', 'reblochon', 'raclette', 'feta', 'ricotta', 'mascarpone',
    'oeuf', 'oeufs', 'jambon', 'lardons', 'bacon', 'saucisse', 'saucisses', 'chorizo', 'merguez',
    'poulet', 'dinde', 'boeuf', 'veau', 'porc', 'agneau', 'steak', 'viande', 'escalope',
    'saumon', 'cabillaud', 'colin', 'truite', 'poisson', 'crevette', 'crevettes', 'moules',
    'pate brisee', 'pate feuilletee', 'pate a pizza', 'tofu', 'charcuterie',
  ]],
  ['Surgelés', ['surgele', 'surgeles', 'glace', 'glacons', 'petits pois surgeles', 'frites surgelees']],
  ['Épicerie', [
    'farine', 'sucre', 'sel', 'poivre', 'huile', 'vinaigre', 'moutarde', 'mayonnaise', 'ketchup',
    'riz', 'pates', 'spaghetti', 'tagliatelles', 'penne', 'macaroni', 'semoule', 'couscous',
    'lentilles', 'pois chiches', 'quinoa', 'boulgour', 'ebly', 'conserve', 'bocal',
    'tomates pelees', 'concentre', 'bouillon', 'levure', 'chocolat', 'miel', 'confiture',
    'cafe', 'the', 'tisane', 'cereales', 'biscuits', 'chapelure', 'maizena', 'curry', 'paprika',
    'cumin', 'curcuma', 'cannelle', 'muscade', 'herbes de provence', 'olives', 'cornichons',
    'thon', 'sardines', 'lait de coco', 'pain', 'baguette', 'tortillas', 'wraps', 'bagels',
  ]],
  ['Boissons', [
    'eau', 'jus', 'soda', 'coca', 'limonade', 'sirop', 'biere', 'vin', 'cidre', 'champagne',
    'perrier', 'orangina', 'schweppes',
  ]],
  ['Maison / hygiène', [
    'lessive', 'adoucissant', 'liquide vaisselle', 'eponge', 'eponges', 'papier toilette',
    'essuie tout', 'sopalin', 'savon', 'shampoing', 'gel douche', 'dentifrice', 'deodorant',
    'deo', 'mouchoirs', 'sacs poubelle', 'poubelle', 'nettoyant', 'javel', 'coton', 'rasoir',
    'papier aluminium', 'film alimentaire', 'piles', 'ampoule',
  ]],
];

const MOTS = [];
for (const [rayon, mots] of TABLE)
  for (const m of mots) MOTS.push({ mot: sansAccent(m), rayon, taille: m.split(' ').length });

/* Correspondance sur MOT ENTIER : « ail » ne doit pas se déclencher sur
   « volaille », ni « thé » sur « thermomix ». Renvoie la POSITION du mot, ou -1. */
function positionMot(texte, mot) {
  const re = new RegExp(`(^|[^a-z0-9])(${mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})($|[^a-z0-9])`);
  const m = re.exec(texte);
  return m ? m.index + m[1].length : -1;
}

/* `rayonsConnus` = la liste réellement configurée. Si le rayon canonique n'y est
   pas, on n'invente pas : on ne range pas. Mieux vaut « sans rayon », qui reste
   visible, qu'un rayon fantôme qui ferait disparaître l'article — la panne
   exacte corrigée le 19/08. */
function deviner(article, rayonsConnus) {
  const texte = sansAccent(article);
  if (!texte) return '';

  /* Le mot le plus À GAUCHE l'emporte, puis le plus précis.
     En français, c'est le premier nom qui dit de quoi il s'agit : « jus
     d'orange » est une boisson, pas un fruit. Trier d'abord par longueur — mon
     premier réflexe — rangeait ce jus au rayon fruits. À position égale, c'est
     l'expression la plus longue qui gagne : « pommes de terre » plutôt que
     « pommes », « tomates pelées » (conserve) plutôt que « tomates » (frais). */
  let meilleur = null;
  for (const { mot, rayon, taille } of MOTS) {
    const pos = positionMot(texte, mot);
    if (pos < 0) continue;
    if (!meilleur || pos < meilleur.pos
      || (pos === meilleur.pos && (taille > meilleur.taille
        || (taille === meilleur.taille && mot.length > meilleur.mot.length)))) {
      meilleur = { pos, rayon, taille, mot };
    }
  }
  if (!meilleur) return '';

  if (!rayonsConnus || !rayonsConnus.length) return meilleur.rayon;
  /* Le rayon canonique doit exister dans la liste réellement configurée : on ne
     range pas dans un rayon fantôme, qui ferait disparaître l'article. */
  return rayonsConnus.find((r) => sansAccent(r) === sansAccent(meilleur.rayon)) || '';
}

module.exports = { deviner, TABLE };

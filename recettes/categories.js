/* À quelle catégorie appartient un plat.

   Demandé par Rémi le 20/09 : « fais une repasse sur tous les plats et place
   dans des catégories simples ». Le besoin venait du champ entrée/dessert, qui
   ne peut proposer la bonne liste que si la bibliothèque est rangée : 52 plats
   sur 125 n'avaient aucune catégorie.

   TROIS catégories, et c'est le sens de « simples » : **Entrée · Plat ·
   Dessert**. « Soupe » existait en base et disparaît — une catégorie dont on ne
   sait pas quoi faire ne sert à personne, et chaque soupe est en réalité l'une
   ou l'autre : un gaspacho ouvre un repas, une soupe au potimarron et lardons
   EST le repas.

   🔑 Ce fichier ne décide QUE ce dont il est sûr. Le reste renvoie `null`, et
   l'appelant va demander à l'IA — c'est exactement le partage des rôles déjà
   retenu pour les rayons de courses (§ 2 nonies) : on ne devine qu'à coup sûr,
   parce qu'un plat mal rangé se cherche au mauvais endroit.

   ⚠️ Le piège à ne pas refaire est celui des pictogrammes et des rayons : la
   comparaison porte sur des MOTS ENTIERS. Sans ça « gratin dauphinois » attrape
   « tartin » dans « tatin », et « semoule » attrape « moule ». */

const CATEGORIES = ['Entrée', 'Plat', 'Dessert'];

/* Sans casse ni accents : la base porte « Dessert » et « dessert », et les noms
   saisis à la main portent des fautes. */
const clef = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  /* `normalize` décompose « é » mais PAS « œ » : sans cette ligne, « bœuf »
     devient « b uf » et se perd. Défaut déjà payé le 24/08 sur les photos. */
  .replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')
  .toLowerCase();

/* Un mot entier, jamais un fragment. */
const a = (texte, mot) => new RegExp('(^|[^a-z0-9])' + mot + '([^a-z0-9]|$)').test(texte);
const aUn = (texte, mots) => mots.some((m) => a(texte, m));

/* Ce qui est sucré sans la moindre ambiguïté. */
const DESSERTS = ['crumble', 'mousse au chocolat', 'sorbet', 'granite', 'glace', 'panna cotta',
  'riz au lait', 'clafoutis', 'far breton', 'cheesecake', 'cookies', 'cookie', 'tiramisu',
  'tatin', 'gateau', 'gateaux', 'compote', 'brownie', 'muffin', 'pain perdu', 'beignets sucres',
  'salade de fruits', 'ile flottante', 'creme brulee', 'profiteroles', 'eclair', 'macarons',
  'fondant au chocolat', 'moelleux au chocolat', 'chouquettes', 'flan', 'yaourt'];

/* Les fruits qui, associés à une tarte ou une poêlée, la rendent sucrée. */
const FRUITS = ['pomme', 'pommes', 'poire', 'poires', 'figue', 'figues', 'quetsche', 'quetsches',
  'mirabelle', 'mirabelles', 'prune', 'prunes', 'pruneaux', 'mure', 'mures', 'fraise', 'fraises',
  'framboise', 'framboises', 'abricot', 'abricots', 'peche', 'peches', 'raisin', 'raisins',
  'myrtille', 'myrtilles', 'cerise', 'cerises', 'banane', 'rhubarbe', 'citron meringue'];

/* Ce qui ouvre un repas.
   ⚠️ « salade verte » a été RETIRÉE après le premier essai : elle apparaît
   surtout en ACCOMPAGNEMENT en fin de nom, et classait « Cake salé
   thon-poivron-olives et salade verte » en entrée. Un mot qui décrit la garniture
   ne dit rien du plat — c'est la même erreur que « jus d'orange » rangé au rayon
   fruits (§ 2 nonies). Les vraies salades-repas partent à l'IA. */
const ENTREES = ['taboule', 'bruschetta', 'bruchetta', 'carpaccio', 'terrine',
  'houmous', 'guacamole', 'tapenade', 'gaspacho', 'veloute', 'melon', 'tomates mozza',
  'tomate mozza', 'mozzarella', 'oeufs mimosa', 'rillettes', 'toasts', 'tartare de'];

/* Ce qui reste un plat malgré un mot sucré dans le nom (« tarte à l'oignon »,
   « poulet aux pommes »). Ces mots-là tranchent contre le sucré. */
const SALES = ['poulet', 'boeuf', 'porc', 'agneau', 'dinde', 'veau', 'canard', 'lardons',
  'jambon', 'saumon', 'thon', 'cabillaud', 'morue', 'dorade', 'truite', 'maquereau',
  'maquereaux', 'crevettes', 'moules', 'chorizo', 'comte', 'oignon', 'poireaux', 'courgette',
  'courgettes', 'fromage', 'chevre', 'feta', 'riz', 'pates', 'semoule', 'boulgour', 'quinoa',
  'lentilles', 'pois chiches', 'saucisse', 'saucisses', 'steak', 'cidre', 'curry', 'poisson'];

/* @returns 'Entrée' | 'Plat' | 'Dessert' | null (null = on ne sait pas, demander) */
function deviner(nom) {
  const t = clef(nom);
  if (!t.trim()) return null;

  const sale = aUn(t, SALES);

  /* Dessert d'abord, mais jamais contre un ingrédient salé explicite : « tarte
     tatin » est un dessert, « gratin dauphinois » n'en est pas un, et « poulet
     aux pommes » reste un plat. */
  if (aUn(t, DESSERTS) && !sale) return 'Dessert';
  /* Une tarte, une poêlée ou un crumble AUX FRUITS, sans rien de salé. */
  if (aUn(t, ['tarte', 'tartelette', 'poelee', 'crumble', 'chausson', 'clafoutis', 'roti', 'roties'])
      && aUn(t, FRUITS) && !sale) return 'Dessert';

  if (aUn(t, ENTREES) && !aUn(t, ['soupe'])) return 'Entrée';

  return null;                        // on ne tranche pas : l'IA le fera mieux
}

module.exports = { deviner, CATEGORIES, clef };

/* Un pictogramme déduit du NOM du plat, quand il n'y a ni photo ni emoji choisi.

   Ce n'est pas nouveau : la table vivait dans `bento.html` depuis le 18/08. Elle
   remonte ici pour trois raisons.
   1. L'app famille n'en avait AUCUNE — sans photo, elle n'affichait rien du
      tout, là où l'écran mural montrait au moins un pictogramme.
   2. Le projet a déjà payé la duplication : les rayons de courses étaient codés
      en dur des deux côtés avec des listes DIFFÉRENTES, et un article rangé
      depuis le téléphone devenait invisible sur le mur (§ 2 octies).
   3. Depuis le serveur, on peut en plus ENREGISTRER l'emoji dans la fiche du
      plat — donc le corriger à la main dans /admin/, ce qu'une déduction faite
      dans le navigateur ne permettra jamais.

   ⚠️ Les motifs sont repris à l'identique de `bento.html` : l'écran mural est
   validé, son rendu ne doit pas bouger.
   ⚠️ 🍽️ est évité : il se rend comme un carré sous Windows. */
const MOTIFS = [
  ['p[âa]tes|spaghetti|lasagne|tagliatelle|ravioli|gnocchi|rigaton|penne|macaroni', '🍝'],
  ['pizza', '🍕'],
  ['poulet|volaille|dinde|chicken', '🍗'],
  ['b[œoe]uf|steak|bourguignon|rosbif', '🥩'],
  ['poisson|saumon|cabillaud|colin|truite|merlu', '🐟'],
  ['moule|hu[îi]tre', '🦪'],
  ['crevette|gambas', '🦐'],
  ['salade|crudit|taboul[ée]', '🥗'],
  ['soupe|potage|velout|gaspacho', '🍲'],
  ['riz|risotto|paella|semoule|boulgour|quinoa', '🍚'],
  ['burger|hamburger|cheeseburger', '🍔'],
  ['cr[êe]pe|galette|pancake', '🥞'],
  ['[œoe]ufs?\\b|omelette|brouill', '🍳'],
  ['sandwich|croque|wrap|panini|ba?gg?el|bru[sc]?chetta|tartine', '🥪'],
  ['tarte|quiche|tourte', '🥧'],
  ['gratin|raclette|fondue|tartiflette|croziflette|fromage|burrata|mozza', '🧀'],
  ['frite', '🍟'],
  ['curry|couscous|tajine|chili|colombo|dahl|korma|massala|tikka', '🍛'],
  ['sushi|maki', '🍣'],
  ['kebab|tacos|burrito|fajita', '🌯'],
  ['l[ée]gume|ratatouille|courgette|haricot|brocoli|tian', '🥦'],
  ['jambon|r[ôo]ti|porc|c[ôo]telette|agneau|chorizo|lardon', '🍖'],
  ['saucisse|merguez|hot ?dog', '🌭'],
  ['pur[ée]e|patate|pomme de terre|hachis', '🥔'],
  ['barbecue|brochette|grillade|plancha', '🍢'],
  ['bo bun|nouille|ramen|wok|pho', '🍜'],
  ['restaurant', '🍴'], ['sortie', '🚗'], ['livraison', '🛵'], ['reste', '🥡'], ['chacun', '🤷'],
  ['p[âa]t[ée]|charcuterie|ap[ée]ro', '🥖'],
];

/* 🔑 DÉBUT DE MOT OBLIGATOIRE.

   La table venait de `bento.html`, où elle cherchait de simples sous-chaînes.
   C'est le piège que le projet a déjà payé sur les rayons de courses (§ 2
   nonies : « citronnelle » ne doit pas attraper « citron »), et il était bien là :
     cho·RIZ·o        → 🍚 riz
     se·MOULE·        → 🦪 moule (huîtres)
   Vérifié sur les vrais plats, pas supposé.

   On exige donc qu'aucune LETTRE ne précède le motif. À droite en revanche on
   laisse libre, pour que « crevettes » et « galettes » restent reconnus : le
   pluriel n'est pas un autre mot. */
const PICTOS = MOTIFS.map(([m, e]) => [new RegExp(`(?<![a-zà-ÿœ])(?:${m})`, 'i'), e]);

/* ⚠️ Le PREMIER motif de la table qui correspond gagne — c'est l'ordre du
   tableau qui tranche, pas la position du mot dans le nom. « Poulet Korma »
   sort donc 🍗 (la ligne « poulet » précède la ligne « curry »). C'est le
   comportement d'origine du bento, conservé tel quel : réordonner la table
   changerait silencieusement des pictogrammes déjà affichés. */
function deviner(nom) {
  const n = String(nom || '').toLowerCase();
  if (!n.trim()) return '';
  for (const [re, e] of PICTOS) if (re.test(n)) return e;
  return '🍲';
}

module.exports = { deviner, PICTOS };

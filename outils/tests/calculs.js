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
const pictos = require(path.join(__dirname, '..', '..', 'recettes', 'pictos'));

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
  /* Le piège du premier nom : « sauce tomate » tombait au rayon frais.
     Signalé par Rémi le 11/09 sur sa vraie liste de courses. */
  ['sauce tomate', 'Épicerie'], ['coulis de tomate', 'Épicerie'],
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

/* Emoji déduit du nom. Les deux premiers sont les PIÈGES DE SOUS-CHAÎNE trouvés
   sur les vrais plats du foyer — la même faute que sur les rayons devinés
   (§ 2 nonies), héritée de la table client du bento. Les suivants vérifient
   qu'on n'a pas surcorrigé : un pluriel n'est pas un autre mot. */
const CAS_PICTOS = [
  ['rigatonni chorizo burrata', '🍝', '🔑 « choRIZo » ne doit pas donner du riz'],
  ['semoule orientale', '🍚', '🔑 « seMOULE » ne doit pas donner des huîtres'],
  ['crevettes sautées', '🦐', 'le pluriel reste reconnu'],
  ['galettes bretonnes', '🥞', 'le pluriel reste reconnu'],
  ['cheeseburger', '🍔', 'un mot composé reste reconnu'],
  ['citronnelle', '🍲', 'aucun motif ne doit se déclencher'],
  ['butter chicken', '🍗', 'le nom anglais est prévu'],
  ['Poulet Korma', '🍗', 'le premier motif de la TABLE gagne (poulet avant curry)'],
  ['barbecue', '🍢', ''],
  ['Soupe & tartines', '🍲', ''],
  ['', '', 'pas de nom, pas d’emoji'],
];

/* ── Detection de l'arrivee ─────────────────────────────────────────────────
   🔴 Le 16/09, Remi rentre et l'ecran ne dit rien. Mesure sur le vrai reseau :
   sur QUATRE telephones enregistres, un seul figurait dans la table ARP du Mac
   — celui d'Amandine, la seule qui ait jamais ete saluee.
   Deux causes distinctes, et il fallait les separer :
   1. le detecteur ne reveillait que les adresses DEJA vues, donc il ne pouvait
      pas voir revenir ce qu'il ne voyait plus ;
   2. les adresses Wi-Fi privees d'iOS avaient tourne, rendant trois lignes
      caduques — ce que seule la carte « Telephones du reseau » permet de voir.
   Ici on eprouve ce qui est eprouvable sans reseau : le verrou commun aux deux
   chemins de detection (balayage et Raccourci iOS). */
function testArrivee(t) {
  const R = require('../../maison/arrivee');
  t.titre("On ne salue pas deux fois, ni la nuit");

  const jour = { absenceMin: 30, silenceDe: 22, silenceA: 7 };
  const qui = 'ZZ-essai Personne ' + Date.now();

  /* L'heure compte : on ne peut pas decider du silence sans savoir quand on
     joue le test. On construit donc une fenetre de silence qui couvre l'heure
     courante, puis une qui ne la couvre pas. */
  const h = new Date().getHours();
  const silenceMaintenant = { absenceMin: 30, silenceDe: h, silenceA: (h + 1) % 24 };

  t.dire(R.peutSaluer(qui, jour), 'un inconnu se salue', 'premiere arrivee');
  t.dire(!R.peutSaluer(qui, silenceMaintenant), 'mais jamais pendant la fenetre de silence');

  R.noterSalut(qui);
  t.dire(!R.peutSaluer(qui, jour), '🔑 salue une fois, on se tait ensuite',
    'le Raccourci iOS et le balayage reseau partagent ce verrou — sinon on salue deux fois');
  t.dire(R.peutSaluer(qui, { ...jour, absenceMin: 0 }), 'et on repart quand le delai est passe');

  /* Le balayage doit viser un vrai sous-reseau, pas s'inventer des adresses. */
  t.titre('Le balayage vise le reseau local');
  const p = R.sousReseaux();
  t.dire(Array.isArray(p), 'une liste de prefixes', p.join(', ') || '(aucune carte /24)');
  t.dire(p.every((x) => /^\d+\.\d+\.\d+$/.test(x)), 'chacun est bien un prefixe /24',
    'on n’envoie rien ailleurs que sur le reseau de la maison');
}

/* ── Accueil a l'arrivee ────────────────────────────────────────────────────
   Module PUR : rien a monter, donc on peut eprouver les cas tordus. */
function testAccueil(t) {
  const A = require('../../maison/accueil');
  t.titre("Ce que l'ecran dit quand on rentre");

  A.oublier();
  const remi = A.phrase({ qui: ['Remi'], appellation: 'Monsieur', role: 'parent', heure: 19, graine: 0 });
  t.dire(/^Bonjour Monsieur/.test(remi), 'Remi recoit son appellation', remi);

  A.oublier();
  const enfant = A.phrase({ qui: ['Martial'], role: 'enfant', heure: 17, graine: 0 });
  t.dire(!/vous/i.test(enfant), 'un enfant est TUTOYE', enfant);

  /* ── Appellations multiples et registre ───────────────────────────────
     Rémi, 16/09 : « amandine madame, enora mademoisel, martial jeun homme
     monsieur, moi monsieur monseigneur grand maitre incostesté ».
     🔑 Le registre SUIT la forme d'adresse : c'est ce decalage qui fait rire.
     Melanger les deux dans la meme phrase sonnerait simplement faux. */
  /* ⚠️ Les marqueurs se cherchent entoures d'espace ou de ponctuation, JAMAIS
     avec « \b ». En JavaScript, une lettre accentuee n'est pas un caractere
     de mot : « \bte\b » attrape donc le « te » de « prete. » — mon premier
     test criait au melange des registres sur une phrase parfaitement correcte.
     C'est la meme famille que les rayons de courses et les pictogrammes : on
     compare des MOTS, pas des fragments. */
  const TUTOIE = /(^|[ ,])(te|tu|ton|tes)([ ,.?!]|$)/i;
  const VOUVOIE = /(^|[ ,])(vous|votre|vos)([ ,.?!]|$)/i;

  A.oublier();
  let melange = 0, avecTitre = 0, avecPrenom = 0;
  for (let i = 0; i < 20; i++) {
    const t = A.phrase({ qui: ['Enora'], role: 'enfant', heure: 18, graine: i,
      appellations: ['Mademoiselle'] });
    if (/Mademoiselle/.test(t)) { avecTitre++; if (TUTOIE.test(t)) melange++; }
    else { avecPrenom++; if (VOUVOIE.test(t)) melange++; }
  }
  t.dire(avecTitre > 0 && avecPrenom > 0, 'l’appellation ALTERNE avec le prenom',
    `${avecTitre} fois « Mademoiselle », ${avecPrenom} fois « Enora »`);
  t.dire(melange === 0,
    '🔑 jamais « Mademoiselle » et « tu » dans la meme phrase',
    'le registre suit la forme d’adresse, sinon la plaisanterie tombe');

  /* Sans graine : c'est le tirage de la maison. Avec une graine on parcourt la
     liste au lieu de la tirer, et l'un des titres peut ne jamais sortir — ce
     qui ne dit rien du comportement reel. */
  A.oublier();
  const troisTitres = new Set();
  for (let i = 0; i < 200; i++) {
    const t = A.phrase({ qui: ['Rémi'], role: 'parent', heure: 18,
      appellations: ['Monsieur', 'Monseigneur', 'Grand maître incontesté'] });
    for (const x of ['Monsieur', 'Monseigneur', 'Grand maître', 'Rémi'])
      if (t.includes(x)) troisTitres.add(x);
  }
  t.dire(troisTitres.size === 4, 'les trois titres ET le prenom tournent',
    [...troisTitres].join(' · '));

  /* ── Phrases ecrites a la main ────────────────────────────────────────
     Elles sont ecrites au vouvoiement : les poser derriere un prenom tutoye
     donnerait « Bonjour Enora, vous etes en beaute ». */
  A.oublier();
  const ECRITE = 'vous êtes en beauté aujourd’hui';
  let fautes = 0, sorties = 0;
  for (let i = 0; i < 40; i++) {
    const t = A.phrase({ qui: ['Enora'], role: 'enfant', heure: 18, graine: i,
      appellations: ['Mademoiselle'], phrases: [ECRITE] });
    if (t.includes(ECRITE)) { sorties++; if (!/Mademoiselle/.test(t)) fautes++; }
  }
  t.dire(sorties > 0, 'une phrase ecrite sort bien', `${sorties} fois sur 40`);
  t.dire(fautes === 0,
    '🔑 une phrase au vouvoiement n’arrive JAMAIS derriere le prenom tutoye',
    'sinon « Bonjour Enora, vous etes en beaute »');

  /* Elles sont prises TELLES QUELLES : personne n'a envie qu'un automate
     retouche un compliment ecrit a la main dans /admin/. */
  A.oublier();
  let brute = '';
  for (let i = 0; i < 40 && !brute; i++) {
    const t = A.phrase({ qui: ['Amandine'], role: 'parent', heure: 18, graine: i,
      phrases: ['vous gérez tout d’une main de maître'] });
    if (t.includes('main de maître')) brute = t;
  }
  t.dire(/vous gérez tout d’une main de maître/.test(brute),
    'le texte ecrit a la main n’est pas reformule', brute);

  /* Un enfant SANS appellation n'entend aucune phrase ecrite : le mecanisme
     ne doit pas s'activer tout seul chez quelqu'un qui n'a rien demande. */
  A.oublier();
  let fuite = false;
  for (let i = 0; i < 30; i++) {
    const t = A.phrase({ qui: ['Clovis'], role: 'enfant', heure: 18, graine: i,
      phrases: [ECRITE] });
    if (t.includes(ECRITE)) fuite = true;
  }
  t.dire(!fuite, 'sans appellation, un enfant ne recoit aucune phrase ecrite',
    'le tutoiement seul ne peut pas porter du vouvoiement');

  /* L'elision : « cours de Espagnol » trahit une phrase fabriquee des la
     premiere ecoute. */
  A.oublier();
  let vu = '';
  for (let i = 0; i < 12 && !/cours/.test(vu); i++) {
    vu = A.phrase({ qui: ['Martial'], role: 'enfant', heure: 17, dernierCours: 'Espagnol', graine: i });
  }
  t.dire(!/cours de Espagnol/.test(vu), "elision devant une voyelle", vu);

  /* Une matiere qui n'apprend rien ne merite pas d'etre citee. */
  A.oublier();
  let etude = false;
  for (let i = 0; i < 12; i++) {
    if (/cours/.test(A.phrase({ qui: ['Enora'], role: 'enfant', heure: 17, dernierCours: 'Étude', graine: i }))) etude = true;
  }
  t.dire(!etude, "« Etude » n'est jamais citee comme un cours");

  /* LE defaut du premier jet : un contexte disponible supprimait toute
     variation, et Martial entendait la meme phrase chaque soir. */
  A.oublier();
  const vues = new Set();
  for (let i = 0; i < 14; i++) {
    vues.add(A.phrase({ qui: ['Martial'], role: 'enfant', heure: 17, dernierCours: 'Physique', devoirs: 2, graine: i }));
  }
  t.dire(vues.size >= 4, 'la formule varie malgre un contexte disponible', vues.size + ' formulations');

  /* A plusieurs, aucune touche personnelle : elle tomberait a cote pour l'un
     des deux. */
  A.oublier();
  const duo = A.phrase({ qui: ['Martial', 'Enora'], heure: 17, dernierCours: 'Maths', devoirs: 3 });
  t.dire(/Martial et Enora/.test(duo) && !/cours|devoir/.test(duo), 'a plusieurs, on nomme et on s arrete la', duo);

  /* 🔴 ON ACCUEILLE, ON NE CHARGE PAS (Remi, 12/09). On passe EXPRES les champs
     retires : un appelant qui les envoie encore ne doit pas les faire ressortir.
     Sans ce controle, il suffirait de remettre trois lignes dans touches() pour
     que la corvee revienne sans que personne ne s'en apercoive. */
  A.oublier();
  let charge = '';
  for (let i = 0; i < 40 && !charge; i++) {
    const c = A.phrase({ qui: ['Amandine'], role: 'parent', heure: 18, courses: 13, graine: i });
    if (/article|liste de courses|n.oublie/i.test(c)) charge = c;
  }
  t.dire(!charge, "aucune corvee n'est annoncee a l'arrivee", charge || 'aucune sur 40 phrases');

  /* Les devoirs, EUX, peuvent revenir — « des fois » (Remi, 12/09). Deux
     conditions : jamais de decompte chiffre, et une mention rare. Un test qui
     se contenterait de « ca apparait » laisserait revenir la convocation. */
  A.oublier();
  let vus2 = 0, chiffre = '';
  for (let i = 0; i < 40; i++) {
    const p = A.phrase({ qui: ['Martial'], role: 'enfant', heure: 17, devoirs: 3,
      dernierCours: 'Physique', graine: i });
    if (/travail/.test(p)) vus2++;
    if (/\d+ devoir|3 devoir/.test(p)) chiffre = p;
  }
  t.dire(vus2 > 0 && vus2 <= 14, 'le travail est evoque parfois, pas a chaque retour', vus2 + '/40');
  t.dire(!chiffre, 'jamais de decompte de devoirs a la porte', chiffre || 'aucun chiffre');

  /* Ce qui remplace : une bonne nouvelle, pas une banalite de plus. */
  A.oublier();
  let anniv = '';
  for (let i = 0; i < 14 && !anniv; i++) {
    const p = A.phrase({ qui: ['Amandine'], role: 'parent', heure: 18, anniversaire: 'de Clovis', graine: i });
    if (/anniversaire/.test(p)) anniv = p;
  }
  t.dire(/bientot l.anniversaire de Clovis|bient.t l.anniversaire de Clovis/.test(anniv),
    "un anniversaire proche est annonce, et dans un francais correct", anniv);

  /* Compliments : ils sortent pour qui en a, et l'appellation ALTERNE avec le
     prenom — « des fois bonjour Madame » (Remi, 12/09). Une appellation dite a
     chaque fois sonne comme un automate. */
  A.oublier();
  const flat = ['vous etes superbe', 'vous gerez tout d une main de maitre'];
  const dits = new Set(), noms = new Set();
  for (let i = 0; i < 16; i++) {
    const p = A.phrase({ qui: ['Amandine'], role: 'parent', appellation: 'Madame',
      heure: 18, compliments: flat, graine: i });
    if (flat.some((f) => p.includes(f))) dits.add(p);
    noms.add(/Madame/.test(p) ? 'titre' : 'prenom');
  }
  t.dire(dits.size > 0, 'un compliment est prononce pour qui en a', [...dits][0] || '(aucun)');
  t.dire(noms.size === 2, "l'appellation alterne avec le prenom", [...noms].join(' + '));

  t.dire(A.phrase({ qui: [] }) === '', 'personne a saluer : rien a dire');
  /* Une majuscule au milieu de la phrase trahit l'assemblage. */
  A.oublier();
  let tard = '';
  for (let i = 0; i < 12 && !/fini tard/.test(tard); i++) {
    tard = A.phrase({ qui: ['Enora'], role: 'enfant', heure: 21, graine: i });
  }
  t.dire(!/, [A-ZÀ-Ý]/.test(tard.replace(/, (Martial|Enora|Remi)/, '')), 'pas de majuscule au milieu', tard);
}

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

  t.titre('Emoji déduit du nom — le repli quand il n’y a pas de photo');
  for (const [nom, attendu, pourquoi] of CAS_PICTOS) {
    const obtenu = pictos.deviner(nom);
    t.dire(obtenu === attendu, `« ${nom || '(vide)'} »`,
      obtenu === attendu ? `${obtenu || 'rien'} — ${pourquoi}` : `${obtenu} au lieu de ${attendu}`);
  }

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

  /* ── Ranger la bibliothèque (20/09) ───────────────────────────────────────
     Rémi : « fais une repasse sur tous les plats et place dans des catégories
     simples ». Ces règles ne tranchent QUE le mécanique — le reste part à l'IA,
     et ce partage ne vaut que si les règles ne se trompent jamais : un plat mal
     rangé se cherche au mauvais endroit (§ 2 nonies). */
  t.titre('Catégories de plats — ce que les règles tranchent seules');
  const cats = require('../../recettes/categories');
  const CAS_CAT = [
    ['Crumble pommes-mûres', 'Dessert'],
    ['Sorbet minute pêche-basilic au Slushi', 'Dessert'],
    ['Tarte fine aux figues et miel', 'Dessert'],
    ['cookies', 'Dessert'],
    ['Taboulé libanais persil-menthe au Magimix', 'Entrée'],
    ['bruchetta', 'Entrée'],                       // la faute de frappe ne gêne pas
    ['tomates mozza', 'Entrée'],
    /* 🔑 Les pièges, et ils sont tous réels.
       « tarte à l'oignon » est salée : un mot sucré dans le nom ne suffit pas.
       « poulet aux pommes » non plus. Et « salade verte » en fin de nom décrit
       l'accompagnement — elle a classé un cake au thon en entrée au 1er essai. */
    ['Tarte à l’oignon et au comté', null],
    ['Filet mignon de porc aux pommes et cidre', null],
    ['Cake salé thon-poivron-olives et salade verte', null],
    /* Mots entiers : « gratin dauphinois » ne doit pas attraper « tatin », ni
       « semoule » attraper « moule » — le piège des pictos et des rayons. */
    ['gratin dauphinois', null],
    ['semoule orientale proteiné', null],
    /* Ce qui demande une connaissance culinaire part à l'IA, et c'est voulu. */
    ['butter chicken', null],
    ['Mafé de bœuf à la cacahuète', null],         // et la ligature œ ne casse rien
  ];
  for (const [nom, attendu] of CAS_CAT) {
    const r = cats.deviner(nom);
    t.dire(r === attendu, `« ${nom} »`, r || '(laissé à l’IA)');
  }

  /* 🔑 Et le bénéfice de tout ce rangement : plus aucun dessert proposé comme
     repas du soir. Rien ne l'interdisait avant — le défaut était masqué par les
     52 plats sans catégorie, pas absent. */
  t.titre('Proposer les soirs vides ne propose pas de dessert');
  const { creerMenu } = require('../../menu');
  /* Une fausse couche données : le module n'en lit que trois choses, et un faux
     objet vaut mieux qu'un serveur pour un calcul pur. */
  const faux = {
    lireMenu: () => ['Lun', 'Mar', 'Mer'].map((j, i) => ({
      id: 'l' + i, jour: j, date: `2026-10-0${i + 1}`, soir: '', midi: '' })),
    listePlatsAdmin: () => [
      { id: 'd1', nom: 'Panna cotta', categorie: 'Dessert', etapes: 'x' },
      { id: 'd2', nom: 'Crumble', categorie: 'dessert', etapes: 'x' },  // casse indifférente
      { id: 'p1', nom: 'Lasagne', categorie: 'Plat', etapes: 'x' },
      { id: 'e1', nom: 'Salade ebly', categorie: 'Entrée', etapes: 'x' },
    ],
    lignesMenuBrutes: () => [],
  };
  const prop = creerMenu({ donnees: faux }).proposer({ moment: 'soir' });
  const noms = (prop.proposition || []).map((x) => x.plat || '');
  t.dire(noms.length > 0, 'une proposition est bien produite', noms.join(', ') || '(aucune)');
  t.dire(!noms.some((n) => /panna cotta|crumble/i.test(n)),
    '🔑 aucun dessert proposé au menu du soir', noms.join(', '));
  t.dire(noms.some((n) => /salade ebly/i.test(n)),
    'mais une ENTRÉE reste candidate — « salade ebly » est un vrai repas du soir ici');

  testAccueil(t);
  testArrivee(t);

  return t;
};

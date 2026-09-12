'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Ce que l'écran dit quand quelqu'un rentre.

   Demande de Rémi : « il faut alterner — content de te voir, ou belle journée ?
   ça a été ton cours de… ». Autrement dit : que ça ne sonne pas comme un
   répondeur. Une salutation identique dix fois de suite cesse d'être une
   attention et devient un bruit qu'on n'entend plus.

   QUATRE RÈGLES, dans cet ordre :
   1. LE NOM D'ABORD, toujours. C'est la seule partie qui compte vraiment, et
      c'est elle qui doit survivre si la phrase est coupée par une porte qui
      claque.
   2. 🔴 ON ACCUEILLE, ON NE CHARGE PAS. Aucune tâche, aucun décompte de ce qui
      reste à faire. « Il reste 13 articles sur la liste de courses » à quelqu'un
      qui rentre du travail n'est pas un accueil : c'est une corvée tendue sur le
      pas de la porte, et ça s'entend comme un reproche.
      Signalé par Rémi le 12/09 — « pas hyper positif, et ça met de la charge
      mentale ». Il a raison, et le même défaut visait les enfants en pire :
      « tu as trois devoirs pour bientôt » à un collégien qui rentre.
      ⚠️ Ce n'est pas une perte d'information : les courses sont sur le mur, les
      devoirs ont leur panneau et leur rappel du soir. Le répéter à l'arrivée,
      c'est le dire deux fois — et gâcher le seul moment qui n'appartenait
      qu'à la personne qui rentre.
   3. UNE SEULE touche en plus. Deux, et l'écran devient bavard — c'est le
      « le fait d'abord, l'esprit après, jamais à la place » du § 2 quaterdecies.
   4. LE CONTEXTE AVANT LE HASARD. « Ton cours de maths s'est bien passé ? » vaut
      mieux que « belle journée » parce qu'on sait que c'est vrai. Le générique
      ne sert que lorsqu'on n'a rien de précis à dire.

   ⚠️ Ce module est PUR : il ne lit ni la base, ni l'heure système, ni le réseau.
   Tout lui est donné. C'est ce qui permet de le tester sans rien monter, et
   d'éprouver les cas tordus (rentrée à minuit, prénom inconnu, planning vide).
   ═══════════════════════════════════════════════════════════════════════════ */

/* Mémoire des dernières formules, par personne — pour ne pas répéter la même
   deux fois d'affilée. En RAM, jamais en base : c'est un confort d'élocution,
   pas un historique de présence (§ 2 vicies, garde-fou n° 1). */
const derniere = new Map();

const ACCUEIL = ['Bonjour', 'Bonjour', 'Te voilà', 'Ah, te voilà'];
const ACCUEIL_VOUS = ['Bonjour', 'Bonjour', 'Vous voilà'];

/* Génériques — employés seulement quand rien de précis n'est disponible. */
const GENERIQUES = [
  'content de {te} revoir',
  'belle journée',
  'ravi de {te} revoir',
  '{tu_as} passé une bonne journée ?',
  'la maison {est} prête',
  'bonne fin de journée',
  'tout est en ordre ici',
  'bienvenue à la maison',
  'quel plaisir de {te} revoir',
];

const MATIERES_COURTES = /^(étude|permanence|vie de classe|cantine|repas|pause)$/i;

function conjuguer(modele, tutoie) {
  return modele
    .replace('{te}', tutoie ? 'te' : 'vous')
    .replace('{tu_as}', tutoie ? 'Tu as' : 'Vous avez')
    .replace('{ton}', tutoie ? 'ton' : 'votre')
    .replace('{est}', 'est');
}

/* Choisit dans une liste en évitant ce qui vient d'être dit à cette personne.
   `graine` rend le choix reproductible pour les tests — sans elle on ne pourrait
   affirmer aucun comportement. */
function choisir(liste, cle, graine) {
  const libres = liste.filter((x) => x !== derniere.get(cle));
  const pool = libres.length ? libres : liste;
  const i = (graine === undefined ? Math.floor(Math.random() * pool.length) : graine % pool.length);
  const choix = pool[Math.abs(i) % pool.length];
  derniere.set(cle, choix);
  return choix;
}

/* Les touches de contexte, de la plus parlante à la plus banale. On rend la
   PREMIÈRE qui s'applique : celle qui prouve qu'on sait de quoi on parle. */
/* ⚠️ `devoirs` et `courses` ne figurent plus ici — délibérément. Un appelant qui
   les passe encore ne casse rien : ils sont simplement ignorés, et c'est cette
   garantie que le test vérifie. */
function touches({ role, heure, dernierCours, prochainCours, meteo, repasSoir,
                   agendaDemain, anniversaire, anniversaireAujourdhui }, tutoie) {
  const out = [];
  const enfant = role === 'enfant';

  /* Un enfant qui rentre de cours : on nomme le cours. C'est ce qui fait la
     différence entre un écran qui salue et un écran qui suit la maison. */
  if (enfant && dernierCours && !MATIERES_COURTES.test(dernierCours)) {
    /* « cours de Espagnol » : l'élision manquait, et ça s'entend tout de suite à
       l'oral — c'est la première chose qui trahit une phrase fabriquée. */
    const de = /^[aeiouyàâéèêëîïôöûü]/i.test(dernierCours) ? "d’" : 'de ';
    out.push(conjuguer(`{ton} cours ${de}${dernierCours} s'est bien passé ?`, tutoie));
  }
  /* Une activité qui approche est utile — mais on l'ANNONCE, on ne la commande
     pas. « N'oublie pas la danse » est un ordre déguisé ; « il y a danse tout à
     l'heure » dit la même chose sans peser (règle n° 2). */
  if (prochainCours) out.push(`il y a ${prochainCours} tout à l'heure`);
  if (repasSoir) out.push(`ce soir, ${repasSoir}`);

  /* ── Ce qui parle aux ADULTES ──────────────────────────────────────────
     Demande de Rémi : « nous aussi, alterner les phrases ». Ils n'avaient que
     des génériques, donc toujours la même impression de répondeur.
     On reste sur du FACTUEL et de l'utile — le majordome annonce, il ne fait
     pas la conversation. */
  if (!enfant) {
    /* Un anniversaire qui approche est la seule chose qu'on regrette vraiment
       d'avoir oubliée — et c'est une bonne nouvelle, pas une corvée. Elle passe
       donc avant le reste. */
    if (anniversaire) {
      out.unshift(anniversaireAujourdhui
        ? `c'est l'anniversaire ${anniversaire} aujourd'hui`
        : `c'est bientôt l'anniversaire ${anniversaire}`);
    }
    if (agendaDemain) out.push(`demain, ${agendaDemain}`);
    /* 🔴 Les COURSES ont été retirées d'ici le 12/09, pour la raison écrite en
       tête du fichier. La liste est sur le mur, à deux mètres. */
  }
  /* La météo seulement si elle mérite d'être signalée : « il fait 14 degrés »
     n'apprend rien à quelqu'un qui vient de traverser la rue. */
  if (typeof meteo === 'number') {
    if (meteo >= 26) out.push(conjuguer('il fait bien chaud dehors', tutoie));
    else if (meteo <= 3) out.push(conjuguer('il ne fait pas chaud dehors', tutoie));
  }
  if (heure >= 20) out.push(conjuguer('{tu_as} fini tard', tutoie));
  return out;
}

/* Touches LÉGÈRES — mentionnées de temps en temps, jamais mises en avant.
   Rémi, 12/09 : « pour les enfants, des fois tu peux leur parler de leur
   devoir ». Ce qui pesait n'était donc pas le sujet, c'était le DÉCOMPTE SEC
   répété à chaque retour : « tu as 3 devoirs pour bientôt » est une convocation.
   Deux différences avec les touches ordinaires, et elles font tout :
   • aucun chiffre — le détail est sur le mur, à deux mètres ;
   • poids 1 au lieu de 3, donc environ un retour sur huit. C'est « des fois ». */
function touchesLegeres({ role, devoirs }, tutoie) {
  const out = [];
  if (role === 'enfant' && devoirs > 0) {
    out.push(tutoie
      ? 'du travail t’attend, quand tu voudras'
      : 'du travail vous attend, quand vous voudrez');
  }
  return out;
}

/* `ctx.qui` est une LISTE : plusieurs personnes peuvent rentrer ensemble. */
function phrase(ctx = {}) {
  const qui = [].concat(ctx.qui || []).filter(Boolean);
  if (!qui.length) return '';
  const heure = typeof ctx.heure === 'number' ? ctx.heure : 12;

  /* À plusieurs, on nomme et on s'arrête là : une touche personnelle adressée
     à un groupe tomberait forcément à côté pour quelqu'un. */
  if (qui.length > 1) {
    return `Bonjour ${qui.slice(0, -1).join(', ')} et ${qui[qui.length - 1]}.`;
  }

  const nom = qui[0];
  const tutoie = ctx.role === 'enfant';
  const appel = ctx.appellation || nom;

  /* « Et des fois bonjour Madame » (Rémi, 12/09). Une appellation employée à
     CHAQUE fois finit par sonner comme un automate ; alternée avec le prénom,
     elle redevient une marque d'égard. L'assistant vocal, lui, n'alterne pas :
     là on répond à une question, ici on accueille quelqu'un. */
  const nommer = ctx.appellation
    ? choisir([ctx.appellation, nom], 'n:' + nom, ctx.graine)
    : appel;
  const debut = `${choisir(tutoie ? ACCUEIL : ACCUEIL_VOUS, 'd:' + nom, ctx.graine)} ${nommer}`;

  /* 🐞 Premier jet : « le contexte s'il existe, sinon le générique ». Résultat,
     Martial entendait la même phrase sur son cours tous les soirs — le contexte
     supprimait toute variation au lieu de l'enrichir.
     Le contexte reste PRIVILÉGIÉ (compté deux fois dans le tirage), mais les
     génériques restent dans le pool : deux fois sur trois on parle de son cours,
     une fois sur trois on dit simplement bonjour. */
  const gen = GENERIQUES.map((g) => conjuguer(g, tutoie));
  const dispo = touches({ ...ctx, heure }, tutoie);

  /* Compliments — demandés par Rémi le 12/09 (« vous êtes en beauté aujourd'hui,
     vous gérez d'une main de maître »).
     🔑 Ils ne sont JAMAIS génériques : le serveur ne les fournit que pour les
     personnes explicitement désignées dans les réglages. Dire « vous êtes
     superbe » à un enfant, ou à quelqu'un qui ne l'a pas demandé, sonnerait
     faux — exactement le bug d'Amandine appelée « Monsieur » (§ 2 quaterdecies).
     Ils sont pris tels quels, sans conjugaison : c'est du texte écrit à la main
     dans /admin/, et personne n'a envie qu'un automate retouche un compliment. */
  const flat = [].concat(ctx.compliments || []).filter((x) => typeof x === 'string' && x.trim());

  /* Le contexte pèse TROIS fois, mais ne monopolise pas : avec deux génériques
     seulement, retirer les devoirs a fait tomber Martial à trois formules — une
     répétition un soir sur trois, attrapée par le test le 12/09. Quatre
     génériques rendent la variété sans noyer ce qu'on sait de vrai. */
  const leger = touchesLegeres({ ...ctx, heure }, tutoie);
  const pool = dispo.length
    ? [...dispo, ...dispo, ...dispo, ...gen.slice(0, 4), ...leger, ...flat]
    : [...gen, ...leger, ...flat];
  const suite = choisir(pool, 's:' + nom, ctx.graine);

  /* Une touche qui est déjà une question se suffit ; sinon on la rattache par
     une virgule. Et jamais deux ponctuations finales. */
  const fin = /\?$/.test(suite) ? '' : '.';
  /* « Bonjour Enora, Tu as fini tard » — la majuscule au milieu d'une phrase se
     voit à l'écrit et s'entend à peine, mais elle trahit l'assemblage. On la
     ramène en minuscule, sauf pour un nom propre (le plat du soir). */
  const s2 = /^[A-ZÀ-Ý][a-zà-ÿ]/.test(suite) && !/^ce soir/.test(suite)
    ? suite[0].toLowerCase() + suite.slice(1)
    : suite;
  return `${debut}, ${s2}${fin}`;
}

/* Pour les tests : repartir d'un état propre. */
const oublier = () => derniere.clear();

module.exports = { phrase, oublier, GENERIQUES, ACCUEIL };

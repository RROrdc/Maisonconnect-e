'use strict';
/* Quels devoirs méritent d'être sur le mur, maintenant.
 *
 * ── Le problème ───────────────────────────────────────────────────────────
 * Trois enfants × un cahier de textes = de quoi remplir un écran de choses
 * qui ne concernent personne aujourd'hui. Sur un mur, ce qui compte n'est pas
 * l'information, c'est l'échéance courte.
 *
 * ── Les deux règles, données par Rémi ─────────────────────────────────────
 * 1. **On ne montre que les devoirs de qui est À LA MAISON.** Augustin vient
 *    un week-end sur deux : ses devoirs n'ont rien à faire sur le mur les
 *    treize autres jours. La présence vient du module `presence/`, qui la lit
 *    dans le calendrier iCloud.
 * 2. **Le week-end, on regarde plus loin.** « Augustin quand il est là le
 *    week-end doit afficher les devoirs du lundi, mardi et mercredi qui
 *    arrivent. » C'est juste : le week-end on a du temps, donc on prépare la
 *    semaine ; un soir de semaine, on prépare demain.
 *
 * ⚠️ Nuance à ne pas perdre : un devoir « pour lundi » alors qu'Augustin
 * repart dimanche soir doit s'afficher PENDANT le week-end — c'est justement
 * le seul moment où il peut le faire chez nous. Le filtre porte donc sur
 * « qui est là aujourd'hui », jamais sur « l'échéance tombe un jour de présence ».
 *
 * 💡 Les jours d'école se DÉDUISENT de l'emploi du temps réel, jamais d'un
 * calendrier théorique : mercredis après-midi, fériés, ponts et vacances sont
 * ainsi gérés sans une seule règle à maintenir. C'est la même idée que pour la
 * garde alternée — la source fait foi (§ 2 terdecies).
 */

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusNJours = (iso, n) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/* Les dates où CET élève a effectivement cours, d'après son emploi du temps.
   Un cours annulé compte quand même comme un jour d'école : l'enfant y va. */
function joursEcoleDe(cours, eleve) {
  const jours = new Set();
  for (const c of cours) if (c.eleve === eleve && c.jour) jours.add(c.jour);
  return jours;
}

/* Repli quand la date dépasse l'horizon lu de l'emploi du temps : on ne sait
   pas, donc on suppose qu'un jour de semaine est un jour d'école. Supposer
   l'inverse ferait disparaître des devoirs — l'erreur la plus coûteuse des deux. */
function estJourEcole(date, joursConnus, horizonConnu) {
  if (joursConnus.has(date)) return true;
  if (date <= horizonConnu) return false;
  const j = new Date(date + 'T12:00:00').getDay();
  return j !== 0 && j !== 6;
}

/* Les N prochains jours d'école à partir de demain (aujourd'hui exclu : ce qui
   était à rendre aujourd'hui l'était ce matin). */
function prochainsJoursEcole(aujourdhui, joursConnus, horizonConnu, combien) {
  const trouves = [];
  for (let i = 1; i <= 21 && trouves.length < combien; i++) {
    const date = plusNJours(aujourdhui, i);
    if (estJourEcole(date, joursConnus, horizonConnu)) trouves.push(date);
  }
  return trouves;
}

/**
 * @param devoirs   devoirs normalisés (tous élèves confondus)
 * @param cours     emploi du temps normalisé, sert à déduire les jours d'école
 * @param presents  prénoms des personnes à la maison aujourd'hui
 * @param aujourdhui  'AAAA-MM-JJ'
 * @param enSemaine   nb de jours d'école regardés quand demain est un jour d'école
 * @param enCreux     nb de jours d'école regardés quand demain n'en est pas un
 */
function devoirsDuMoment({
  devoirs = [], cours = [], presents = null, aujourdhui = ymd(new Date()),
  enSemaine = 1, enCreux = 3,
} = {}) {
  const horizonConnu = cours.reduce((max, c) => (c.jour > max ? c.jour : max), aujourdhui);
  const parEleve = new Map();

  for (const d of devoirs) {
    /* Règle 1 : seulement qui est là. `presents = null` veut dire « on ne sait
       pas » (module de garde éteint, agenda injoignable) — on montre alors tout
       le monde plutôt que rien : un écran vide ferait croire à une panne. */
    if (presents && !presents.includes(d.eleve)) continue;
    if (!parEleve.has(d.eleve)) parEleve.set(d.eleve, []);
    parEleve.get(d.eleve).push(d);
  }

  const sortie = [];
  const details = {};
  for (const [eleve, siens] of parEleve) {
    const joursConnus = joursEcoleDe(cours, eleve);
    const demain = plusNJours(aujourdhui, 1);
    /* Règle 2 : a-t-il du TEMPS ? Oui s'il n'a pas école aujourd'hui, ou si
       demain est libre. Les deux conditions comptent, et il a fallu les vraies
       données pour le voir :
         · samedi  → pas d'école aujourd'hui        ⇒ creux
         · DIMANCHE → pas d'école aujourd'hui non plus, mais demain SI ⇒ le
           premier jet ne montrait que lundi. Or le dimanche est justement le
           dernier moment où Augustin peut travailler chez nous avant de
           repartir : c'est LE jour où il faut voir lundi, mardi et mercredi.
         · vendredi soir → école aujourd'hui mais pas demain ⇒ creux, on peut
           déjà s'avancer sur la semaine.
       ⚠️ On regarde l'emploi du temps de CET enfant : l'un peut être en
       vacances quand l'autre a cours, les établissements ne s'alignent pas. */
    const creux = !estJourEcole(aujourdhui, joursConnus, horizonConnu)
               || !estJourEcole(demain, joursConnus, horizonConnu);
    const combien = creux ? enCreux : enSemaine;
    const vises = prochainsJoursEcole(aujourdhui, joursConnus, horizonConnu, combien);
    const limite = vises.length ? vises[vises.length - 1] : demain;

    details[eleve] = { creux, jours: vises, limite };
    for (const d of siens) {
      /* Une échéance passée sort d'elle-même : on n'efface rien (rien n'est
         stocké ici, la source garde tout), on cesse simplement d'afficher.
         C'est ce qui garantit que la liste se vide seule, même si personne ne
         coche jamais rien dans l'application de l'établissement.

         🔑 AUJOURD'HUI EST EXCLU, et c'est une demande de Rémi devant l'écran :
         « je vois pour Augustin ceux du jour, du vendredi, mais ça on s'en
         fout — ce qui m'intéresse c'est ceux de lundi, mardi, mercredi qui
         suivent ». Il a raison : un devoir « pour vendredi » a été rendu en
         cours le vendredi matin, le voir le soir sur le mur de la cuisine
         n'apporte rien et pousse dehors ce qui reste à faire. Le mur regarde
         DEVANT — c'est d'ailleurs déjà ce que fait `prochainsJoursEcole()`,
         qui commence à demain ; seule cette ligne laissait entrer le jour même.
         ⚠️ L'APP, elle, garde le jour même : elle sert à suivre, et un enfant
         peut vouloir vérifier le matin ce qui est dû dans la journée. */
      if (d.pour <= aujourdhui) continue;
      /* 🐞 On coupait ici sur `limite`, et le mur mentait : les deux devoirs de
         Martial tombaient le 10/09, hors fenêtre, donc le résumé annonçait
         « tout est fait » alors qu'il lui restait deux choses à faire
         (constaté par Rémi le 04/09). Couper avait un sens tant que la tuile
         portait une LISTE qu'il fallait borner ; depuis qu'elle porte un
         compte, couper ne fait plus gagner de place — ça fabrique un chiffre
         faux. On garde donc tout, et on MARQUE ce qui est proche. */
      /* ⚠️ Les devoirs FAITS restent dans la liste, avec leur drapeau : c'est
         l'AFFICHAGE qui décide de les barrer (dans l'app, où la hauteur est
         abondante et où l'enfant veut voir sa progression) ou de les masquer
         (sur le mur, où chaque ligne barrée est une ligne volée à ce qui reste
         à faire — défaut corrigé le 14/08 avec `triFait`).
         Un premier jet excluait les faits du jour et gardait ceux des jours
         suivants : deux comportements pour la même notion, donc un affichage
         impossible à expliquer. */
      /* `pourAujourdhui` est toujours faux ici depuis que le jour même est
         exclu ; il reste parce que `devoirsDe()` (l'app) s'en sert, lui.
         `proche` prend le relais sur le mur : il dit ce qui tombe dans les
         prochains jours d'école, donc ce qu'il faut faire en priorité. */
      sortie.push({ ...d, pourAujourdhui: d.pour === aujourdhui, proche: d.pour <= limite });
    }
  }

  /* Non faits d'abord, puis par échéance : sur une tuile à hauteur limitée, on
     doit voir ce qui reste à faire, pas les lignes barrées (§ corrections du
     14/08, `triFait`). */
  sortie.sort((a, b) => Number(a.fait) - Number(b.fait)
    || a.pour.localeCompare(b.pour)
    || String(a.eleve).localeCompare(String(b.eleve)));

  /* `restants` est ce qu'affiche une pastille de compteur : le nombre de
     devoirs faits n'intéresse personne sur un mur, le nombre restant si. */
  const restants = sortie.filter((d) => !d.fait).length;
  return { devoirs: sortie, details, restants, faits: sortie.length - restants };
}

/* ─────────────────────────────────────────────────────────────────────────
   Les devoirs de QUI REGARDE — pour l'app, pas pour le mur.
   Deux besoins opposés, donc deux fonctions et non un paramètre de plus :
     · le MUR montre une à trois lignes de ce qui est urgent pour qui est là ;
     · l'APP est personnelle et sert à SUIVRE — l'enfant veut voir tout ce
       qu'il a devant lui, qu'il soit chez nous ou chez son autre parent.
   Il n'y a donc aucun filtre de présence ici : filtrer sur la présence
   viderait l'app d'Augustin treize jours sur quatorze, c'est-à-dire
   exactement quand il en a besoin.

   🔒 Le filtre d'identité est un choix de CONFIDENTIALITÉ (§ 2 vicies) :
   un enfant voit les siens, un adulte voit ceux de tous. On se fie au RÔLE
   et non à la présence dans la liste des élèves : Enora est une enfant même
   si son compte scolaire n'est pas encore branché — sans cette nuance elle
   verrait les devoirs de Martial et d'Augustin.
   ⚠️ Le prénom vient du jeton de l'appareil, jamais du corps de la requête —
   même règle que « Mon emploi du temps » (§ 2 quater).
 */
function devoirsDe({
  devoirs = [], personne = null, role = null, eleves = [],
  aujourdhui = ymd(new Date()), jusquA = null,
} = {}) {
  const prenoms = eleves.map((e) => e.prenom);
  /* Un enfant ⇒ les siens seulement. Un adulte, ou le mur (aucun jeton) ⇒ tous.
     Rôle inconnu : on retombe sur « est-il un élève connu ? », ce qui couvre le
     cas d'un appareil enrôlé avant que la fiche ait un rôle. */
  const enfant = role ? role === 'enfant' : prenoms.includes(personne);
  const sortie = [];
  for (const d of devoirs) {
    if (enfant && d.eleve !== personne) continue;
    if (d.pour < aujourdhui) continue;      // l'échéance passée sort d'elle-même
    if (jusquA && d.pour > jusquA) continue;
    sortie.push({ ...d, pourAujourdhui: d.pour === aujourdhui });
  }
  /* Non faits d'abord, puis échéance : on ouvre l'app pour voir ce qui reste. */
  sortie.sort((a, b) => Number(a.fait) - Number(b.fait)
    || a.pour.localeCompare(b.pour)
    || String(a.eleve).localeCompare(String(b.eleve))
    || String(a.matiere).localeCompare(String(b.matiere)));

  const parEleve = {};
  for (const d of sortie) (parEleve[d.eleve] = parEleve[d.eleve] || []).push(d);
  const restants = sortie.filter((d) => !d.fait).length;
  return { devoirs: sortie, parEleve, restants, faits: sortie.length - restants, personnel: enfant };
}

module.exports = { devoirsDuMoment, devoirsDe, joursEcoleDe, prochainsJoursEcole, estJourEcole, ymd, plusNJours };

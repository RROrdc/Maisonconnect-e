'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   LES MOUVEMENTS : ce qui a CHANGÉ dans l'emploi du temps depuis la dernière
   lecture.

   Rémi, 17/09 : « permets de voir les changements, les annulations, les
   mouvements ». Les annulations étaient déjà détectées (`rappels.js`). Restait
   le reste, et c'est le plus utile : un cours DÉPLACÉ, personne ne le voit
   venir — l'enfant arrive à l'heure d'hier.

   Ce fichier ne fait QUE comparer deux photographies. Aucune base, aucune
   horloge, aucun réseau : c'est ce qui le rend vérifiable sans rien monter,
   comme `maison/accueil.js`.

   ── TROIS RÈGLES, ET LA PREMIÈRE EST CELLE QUI ÉVITE LE BRUIT ─────────────
   1. On ne compare QUE les jours présents dans les DEUX photographies.
      La lecture porte sur sept jours glissants : sans ce garde-fou, chaque
      journée qui sort de la fenêtre serait annoncée « retirée » et chaque
      journée qui entre « ajoutée » — soit une fausse alerte par jour, tous les
      jours, le plus sûr moyen de faire ignorer les vraies.
   2. On ignore la salle et le professeur. C'est déjà la règle retenue pour les
      annulations : l'enfant le voit sur place, et une notification par
      modification mineure noierait les déplacements réels.
   3. Un cours marqué ANNULÉ n'est pas un mouvement — il a son propre message.
      Le dire deux fois ferait douter de ce qu'on lit.
   ═══════════════════════════════════════════════════════════════════════════ */

/* La clef d'un cours : l'élève, le jour et la matière. Pas l'heure — c'est
   justement ce dont on veut voir le changement. */
const clefCours = (c) =>
  [c.eleve || '', c.jour || '', String(c.matiere || c.libelle || '').trim()].join('|');

/* Deux séances de la même matière le même jour existent (deux heures de maths).
   On indexe donc une LISTE d'heures par clef et on compare les ensembles :
   sinon la seconde séance passerait pour un déplacement de la première. */
function indexer(cours) {
  const jours = new Set();
  const par = new Map();
  for (const c of cours || []) {
    if (!c || !c.eleve || !c.jour) continue;
    jours.add(c.jour);
    if (c.annule) continue;                      // règle 3
    const k = clefCours(c);
    if (!par.has(k)) par.set(k, []);
    par.get(k).push(String(c.debut || ''));
  }
  for (const heures of par.values()) heures.sort();
  return { jours, par };
}

const eleveDe = (k) => k.split('|')[0];
const jourDe = (k) => k.split('|')[1];
const matiereDe = (k) => k.split('|').slice(2).join('|');

/* Compare deux index. Rend une liste de mouvements déjà prêts à être dits :
   { eleve, jour, matiere, quoi: 'deplace' | 'ajoute' | 'retire', de, a } */
function comparerIndex(A, B) {
  /* Règle 1 : l'intersection des jours observés, et rien d'autre. */
  const communs = new Set([...A.jours].filter((j) => B.jours.has(j)));

  const out = [];
  for (const k of new Set([...A.par.keys(), ...B.par.keys()])) {
    if (!communs.has(jourDe(k))) continue;
    const av = A.par.get(k) || [];
    const ap = B.par.get(k) || [];
    if (av.join(',') === ap.join(',')) continue;

    const base = { eleve: eleveDe(k), jour: jourDe(k), matiere: matiereDe(k) };
    const partis = av.filter((h) => !ap.includes(h));
    const venus = ap.filter((h) => !av.includes(h));
    /* Autant de séances avant qu'après : c'est un DÉPLACEMENT, et c'est la
       formulation qui aide — « passe de 13 h 40 à 15 h 50 » se comprend,
       « retiré puis ajouté » fait chercher deux fois. */
    if (av.length === ap.length) {
      for (let i = 0; i < Math.max(partis.length, venus.length); i++) {
        out.push({ ...base, quoi: 'deplace', de: partis[i] || '', a: venus[i] || '' });
      }
      continue;
    }
    for (const h of venus) out.push({ ...base, quoi: 'ajoute', de: '', a: h });
    for (const h of partis) out.push({ ...base, quoi: 'retire', de: h, a: '' });
  }
  out.sort((x, y) => (x.jour + (x.a || x.de) + x.eleve).localeCompare(y.jour + (y.a || y.de) + y.eleve));
  return out;
}

/* Ce qu'on garde d'une lecture pour la comparer à la suivante. Volontairement
   minuscule : ça vit dans un réglage, pas dans un fichier.
   ⚠️ Les JOURS sont mémorisés à part : une journée entièrement vide a bien été
   regardée, et sans elle la règle 1 la croirait hors fenêtre. */
function photographier(cours) {
  const { jours, par } = indexer(cours);
  return {
    jours: [...jours].sort(),
    cours: [...par].map(([k, heures]) => k + '@' + heures.join(',')).sort(),
  };
}

/* Relit une photographie. Tolérant par conception : une photographie illisible
   vaut « aucune », donc un passage muet — jamais une rafale de fausses alertes. */
function relireIndex(photo) {
  const jours = new Set();
  const par = new Map();
  if (!photo || typeof photo !== 'object') return { jours, par };
  for (const j of Array.isArray(photo.jours) ? photo.jours : []) jours.add(String(j));
  for (const ligne of Array.isArray(photo.cours) ? photo.cours : []) {
    const s = String(ligne);
    const i = s.lastIndexOf('@');
    if (i < 0) continue;
    const k = s.slice(0, i);
    if (k.split('|').length < 2) continue;
    jours.add(jourDe(k));
    par.set(k, s.slice(i + 1).split(',').filter((h) => h !== '').sort());
  }
  return { jours, par };
}

/* Le point d'entrée : la photographie d'hier contre la lecture d'aujourd'hui. */
const comparer = (photoAvant, coursApres) => comparerIndex(relireIndex(photoAvant), indexer(coursApres));

/* Une phrase, pas un objet. Écrite pour être LUE sur un mur et ENTENDUE. */
function direMouvement(m) {
  const q = m.matiere || 'Cours';
  if (m.quoi === 'deplace') return `${q} passe de ${m.de || '?'} à ${m.a || '?'}`;
  if (m.quoi === 'ajoute') return `${q} ajouté à ${m.a || '?'}`;
  return `${q} retiré de ${m.de || '?'}`;
}

module.exports = { comparer, comparerIndex, indexer, relireIndex, photographier, direMouvement, clefCours };

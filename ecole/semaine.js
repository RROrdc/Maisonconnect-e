'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   L'emploi du temps RÉEL de la semaine, à la place de la grille saisie.

   POURQUOI
   Rémi, 17/09 : « l'agenda d'école d'Enora n'est pas sur la bonne semaine ou le
   même créneau que l'agenda EcoleDirecte — aujourd'hui c'est affiché qu'elle a
   étude alors qu'elle a math », puis « à part les activités extrascolaires,
   vérifie EcoleDirecte sur les agendas, mets à jour les agendas et permets de
   voir les changements, les annulations, les mouvements ».

   Le diagnostic lui a donné raison : les étiquettes A/B d'Enora étaient
   inversées (Martial, lui, était juste). Mais corriger les étiquettes ne traite
   que ce jour-là — une grille tapée à la main dérive à chaque changement
   d'établissement, et personne ne la retape.

   ⇒ Les COURS viennent désormais de l'espace scolaire, qui les donne DATÉS.
     Aucune semaine A/B à calculer : une date n'a pas de parité. Et elle porte
     ce qu'aucune grille ne saura jamais — le cours annulé, la salle changée.

   ⇒ La grille saisie garde les ACTIVITÉS : danse, natation. L'école ne les
     connaît pas, et c'est le seul endroit où elles existent.

   ── LE REPLI, QUI N'EST PAS UN DÉTAIL ────────────────────────────────────
   Si l'espace scolaire ne répond pas — jeton expiré, QCM à repasser, panne de
   l'éditeur — on garde la grille saisie pour cet élève. Un écran vide se lit
   « il n'a pas cours », ce qui est faux et pire que légèrement périmé.
   C'est aussi pour ça que l'échange A/B d'Enora a été fait : le repli doit être
   juste, pas seulement présent.
   ═══════════════════════════════════════════════════════════════════════════ */

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/* Le lundi de la semaine qui contient `d`, en date locale. On ne découpe jamais
   une chaîne ISO UTC : ça a déjà coûté deux heures de décalage au projet
   (§ 2 quindecies). */
function lundiDe(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Les sept dates de la semaine affichée, indexées par abréviation de jour —
   c'est ce qui relie un cours daté à une colonne de la grille. */
function datesSemaine(depuis = new Date()) {
  const l = lundiDe(depuis);
  const out = {};
  JOURS.forEach((j, i) => {
    const d = new Date(l);
    d.setDate(l.getDate() + i);
    out[j] = ymd(d);
  });
  return out;
}

/* ── Les intitulés ────────────────────────────────────────────────────────
   Les établissements écrivent pour une colonne étroite : « SC.NUMERIQ.TECHNOL. »,
   « ED.PHYSIQUE & SPORT. ». Illisible sur un mur, et c'est la LÉGENDE de la
   grille qui les reprend (§ 2 octodecies).

   🔴 Mon premier jet indexait le joli nom sur l'HEURE du créneau : « le cours
      de 13 h 40 s'appelait Étude dans la grille, donc appelons-le Étude ».
      Essayé, et il affichait « Étude » sur un cours de MATHÉMATIQUES — c'est-à-dire
      EXACTEMENT le bug que ce fichier existe pour corriger. Un horaire n'identifie
      pas une matière.
   ⇒ La correspondance porte sur le LIBELLÉ DE L'ÉCOLE, explicitement, dans un
     réglage. Ce qui n'y figure pas s'affiche tel quel : un intitulé moche est
     un moindre mal devant un intitulé faux. */
const clef = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');

function tableMatieres(reglage) {
  const t = new Map();
  for (const ligne of String(reglage || '').split('\n')) {
    const i = ligne.indexOf('|');
    if (i < 0) continue;
    const brut = clef(ligne.slice(0, i));
    const joli = ligne.slice(i + 1).trim();
    if (brut && joli) t.set(brut, joli);
  }
  return t;
}

/* Un cours daté devient une ligne de grille, exactement dans la forme que
   `lirePlannings()` produit — le rendu du mur n'a donc rien à changer. */
function ligneDeCours(c, matieres) {
  const brut = c.matiere || c.libelle || 'Cours';
  return {
    h: c.debut || '',
    fin: c.fin || '',
    quoi: matieres.get(clef(brut)) || brut,
    ou: '',
    type: '',
    categorie: 'cours',
    prof: c.prof || '',
    salle: c.salle || '',
    quinzaine: '',            // une date n'a pas de parité
    couleur: '',
    annule: Boolean(c.annule),
    reel: true,               // c'est l'école qui le dit, pas nous
  };
}

/* Fusionne : les cours viennent du réel, les activités de la grille saisie.
   `plannings` est ce que rend `donnees.lirePlannings()`. */
function fusionner(plannings, cours, options = {}) {
  const depuis = options.depuis || new Date();
  const matieres = tableMatieres(options.matieres);
  const dates = datesSemaine(depuis);

  const parEleve = new Map();
  for (const c of cours || []) {
    if (!c || !c.eleve || !c.jour) continue;
    if (!parEleve.has(c.eleve)) parEleve.set(c.eleve, []);
    parEleve.get(c.eleve).push(c);
  }

  const personnes = (plannings.personnes || []).map((p) => {
    const reels = parEleve.get(p.nom) || [];
    /* Aucun cours réel pour cette personne : on ne touche à rien. C'est le cas
       d'un enfant sans compte scolaire, et celui d'un espace en panne. */
    if (!reels.length) return { ...p, source: 'grille' };

    const semaine = {};
    let remplaces = 0;
    for (const j of JOURS) {
      const dujour = reels.filter((c) => c.jour === dates[j]).map((c) => ligneDeCours(c, matieres));
      /* 🔑 JOUR PAR JOUR, et pas seulement personne par personne.
         Le garde-fou existait un cran trop haut : il suffisait qu'un élève ait
         des cours QUELQUE PART pour qu'on entre ici, et chaque jour sans
         correspondance repartait vide. Le 20/09 — un dimanche — l'espace
         scolaire rendait les cours du 21 au 25 pendant que le mur affichait la
         semaine du 14 au 20 : aucune intersection, et les deux emplois du temps
         se sont vidés de tous leurs cours. Rémi : « l'emploi du temps est
         planté, il est vide sauf activité extrascolaire ».
         C'est donc TOUS les week-ends que l'écran se vidait.
         La règle tient en une phrase : on ne remplace un jour que si l'on a
         quelque chose à mettre à la place. Un jour non couvert garde sa grille —
         légèrement théorique vaut mieux que vide, puisqu'un écran vide se lit
         « il n'a pas cours » (§ 2 sextricies). */
      if (!dujour.length) { semaine[j] = p.semaine[j] || []; continue; }
      remplaces++;
      /* Les activités survivent — elles n'existent nulle part ailleurs. */
      const activites = (p.semaine[j] || []).filter((c) => c.categorie === 'activite');
      semaine[j] = [...dujour, ...activites]
        .sort((a, b) => (a.h || '').localeCompare(b.h || ''));
    }
    /* Aucun jour remplacé ⇒ rien ne vient de l'école pour CETTE semaine : on ne
       promet pas un « emploi du temps réel » qu'on n'a pas. */
    return { ...p, semaine, source: remplaces ? 'ecole' : 'grille' };
  });

  return {
    ...plannings,
    personnes,
    /* L'écran DOIT pouvoir dire d'où vient ce qu'il montre : une grille tapée à
       la main et un emploi du temps officiel ne méritent pas la même confiance,
       et c'est ce qui permettra de repérer un espace scolaire en panne. */
    reel: personnes.some((p) => p.source === 'ecole'),
    /* Plus de repère A/B quand tout vient du réel : une date n'a pas de parité,
       et afficher « semaine B » sur un emploi du temps daté n'apprend rien. */
    alterne: Boolean(plannings.alterne) && personnes.some((p) => p.source === 'grille'),
    debut: dates.Lun,
  };
}

module.exports = { fusionner, datesSemaine, lundiDe, ymd, tableMatieres, clef, JOURS };

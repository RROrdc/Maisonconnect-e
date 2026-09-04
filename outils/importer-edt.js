#!/usr/bin/env node
/* Emplois du temps des enfants — rentrée 2026.
 *
 *   node outils/importer-edt.js Martial              → simulation (n'écrit rien)
 *   node outils/importer-edt.js Enora --vraiment
 *   node outils/importer-edt.js Enora --vraiment --remplacer
 *        → retire d'abord ses anciens créneaux (corbeille douce, `supprime_le`,
 *          donc restaurables) avant d'insérer les nouveaux.
 *   node outils/importer-edt.js --tous --vraiment --remplacer
 *
 * ── Pourquoi un outil, et un SEUL ─────────────────────────────────────────
 * Un emploi du temps rechange à chaque rentrée et parfois en cours d'année :
 * les tables ci-dessous se relisent et se corrigent à l'œil. Et il n'y en a
 * qu'un pour les deux enfants — deux fichiers quasi identiques, c'est la
 * duplication qui a déjà coûté au projet les rayons de courses codés en dur
 * des deux côtés avec des listes différentes (§ 2 octies).
 *
 * ── Semaine A / semaine B ─────────────────────────────────────────────────
 * Un créneau SANS quinzaine vaut TOUTES les semaines : c'est le cas courant et
 * c'est ce qui garde les tables lisibles. Seuls les créneaux qui diffèrent
 * réellement d'une semaine à l'autre portent 'A' ou 'B'.
 *   A = semaine IMPAIRE (réglage `quinzaine_paire` = '0')
 *   B = semaine PAIRE
 * ⚠️ Le réglage est GLOBAL, pour toute la maison. Si le collège d'Enora et le
 * lycée de Martial n'appellent pas « A » la même semaine, on ne touche pas au
 * réglage : on échange A et B dans la table de CELUI des deux qui est décalé.
 * Une seule vérité pour la maison, deux étiquettes locales.
 */
'use strict';
const path = require('path');
const donnees = require(path.join(__dirname, '..', 'donnees'));

/* ─────────────────────────────────────────────────────────────────────────
   MARTIAL — Lycée Saint-Rémi, seconde. Source : deux captures EcoleDirecte
   (semaine 37 = « semaine 1 » = A, semaine 38 = « semaine 2 » = B).
   Mis à jour le 03/09/2026 : quatre créneaux ajoutés par le lycée (Mar 08:58
   Maths, Mar 11:30 SVT, Mer 13:02 Physique, Jeu 13:02 Français). Ils valent
   les DEUX semaines ; les différences A/B, elles, n'ont pas bougé.

   Intitulés : l'export du lycée est en capitales tronquées
   (« SC.NUMERIQ.TECHNOL. »), illisible à deux mètres sur un mur, et la légende
   de la grille reprend ces noms tels quels. On pose donc des libellés clairs.
   Les noms de professeurs restent dans la forme du lycée : c'est celle que
   Martial lit sur EcoleDirecte.
   ───────────────────────────────────────────────────────────────────────── */
const MARTIAL = {
  /* [jour, début, fin, matière, prof, salle, quinzaine]  ('' = toutes les semaines) */
  cours: [
    ['Lun', '08:00', '09:53', 'DS',                        '',                   'Étude', ''],
    ['Lun', '10:07', '11:02', 'Français',                  'COEUGNET C.',        '17',    ''],
    ['Lun', '11:05', '12:00', 'Espagnol LV2',              'SABEG V.',           '17',    'A'],
    ['Lun', '11:05', '12:00', 'Physique',                  'IDIR R.',            'C052',  'B'],
    ['Lun', '12:03', '12:58', 'Accompagnement perso.',     'IDIR R.',            '110',   ''],
    ['Lun', '14:00', '14:55', 'Accompagnement perso.',     'IDIR R.',            '110',   ''],
    ['Lun', '15:09', '16:04', 'Français',                  'COEUGNET C.',        '17',    ''],
    ['Lun', '16:07', '17:02', 'Création innov. techno.',   'BATOR E.',           'P61 Atelier STI2D', ''],
    ['Lun', '17:05', '18:00', 'Création innov. techno.',   'BATOR E.',           'P61 Atelier STI2D', 'A'],
    ['Mar', '08:00', '08:55', 'Histoire-Géographie',       'VANDERBEKEN B.',     '17',    ''],
    ['Mar', '08:58', '09:53', 'Mathématiques',             'SANDOR V.',          '17',    ''],
    ['Mar', '11:30', '12:50', 'SVT',                       'BONDU N.',           'L101',  ''],
    ['Mar', '14:00', '14:55', 'Mathématiques',             'SANDOR V.',          '17',    ''],
    ['Mar', '15:09', '16:04', 'Espagnol LV2',              'SABEG V.',           '17',    ''],
    ['Mar', '16:07', '17:02', 'Anglais LV1',               'MARQUET O.',         '17',    ''],
    ['Mer', '08:00', '09:53', 'EPS',                       'JACQUET O.',         'EPS',   ''],
    ['Mer', '10:07', '11:02', 'Français',                  'COEUGNET C.',        '17',    ''],
    ['Mer', '13:02', '14:22', 'Physique',                  'IDIR R.',            'L054',  ''],
    ['Jeu', '08:00', '08:55', 'Sciences numériques',       'HAMMADOU H.',        '210i',  'B'],
    ['Jeu', '08:58', '09:53', 'Sciences numériques',       'HAMMADOU H.',        '210i',  ''],
    ['Jeu', '10:07', '11:02', 'Anglais LV1',               'MARQUET O.',         '17',    ''],
    ['Jeu', '11:05', '12:00', 'Sciences éco. & sociales',  'CARLIER CHIBANI M.', '17',    ''],
    ['Jeu', '13:02', '13:57', 'Français',                  'COEUGNET C.',        '17',    ''],
    ['Jeu', '14:00', '14:55', 'Mathématiques',             'SANDOR V.',          '17',    ''],
    ['Jeu', '15:09', '16:04', 'Sciences éco. & sociales',  'CARLIER CHIBANI M.', '17',    'B'],
    ['Jeu', '16:07', '17:02', 'Espagnol LV2',              'SABEG V.',           '17',    ''],
    ['Ven', '08:58', '09:53', 'EMC',                       'VANDERBEKEN B.',     '10',    'A'],
    ['Ven', '10:07', '11:02', 'Physique',                  'IDIR R.',            'C053',  ''],
    ['Ven', '11:05', '12:00', 'Mathématiques',             'SANDOR V.',          '17',    ''],
    ['Ven', '12:03', '12:58', 'Anglais LV1',               'MARQUET O.',         '17',    ''],
    ['Ven', '15:09', '16:04', 'Histoire-Géographie',       'VANDERBEKEN B.',     '17',    ''],
    ['Ven', '16:07', '17:02', 'Histoire-Géographie',       'VANDERBEKEN B.',     '17',    ''],
  ],
  /* Natation — le club propose 5 créneaux (reprise jeudi 3 septembre, 1 h 30).
     Martial en suit deux ; les trois autres restent ENREGISTRÉES mais décochées,
     visibles dans /admin/ et rallumables d'une case à cocher. Un créneau qu'il
     faut retaper est un créneau qu'on ne rallume jamais.
     ⚠️ Lundi 18 h est impossible en semaine A : le cours va jusqu'à 18 h 00 pile.
     ⚠️ Mercredi 13 h est devenu impossible le 03/09 : Physique 13 h 02 – 14 h 22.
     [jour, début, fin, quoi, lieu, actif] */
  activites: [
    ['Lun', '18:00', '19:30', 'Natation', '', false],
    ['Mar', '19:00', '20:30', 'Natation', '', true],
    ['Mer', '13:00', '14:30', 'Natation', '', false],
    ['Jeu', '19:00', '20:30', 'Natation', '', true],
    ['Ven', '19:00', '20:30', 'Natation', '', false],
  ],
};

/* ─────────────────────────────────────────────────────────────────────────
   ENORA — Collège Jeanne d'Arc, 4e B. Source : la carte cartonnée du collège,
   REMPLIE À LA MAIN, photographiée à travers une pochette plastique.

   ⚠️ Lecture incertaine sur le bloc du LUNDI MATIN (8h05 et 9h05) : la pochette
   photo le recouvre en diagonale. Ce qui est posé ci-dessous est ma meilleure
   lecture, à faire confirmer. Le reste de la carte est net.
   Une matière fausse envoie un enfant en cours sans le bon cahier : on signale,
   on ne devine pas en silence.

   Horaires du collège : 8h05-9h05 · 9h05-10h00 · 10h15-11h15 · 11h15-12h10
                         13h40-14h40 · 14h40-15h35 · 15h50-16h50 · 16h50-17h45
   ───────────────────────────────────────────────────────────────────────── */
const ENORA = {
  cours: [
    // ------------------------------------------------------------- lundi
    ['Lun', '08:05', '09:05', 'Sciences physiques / SVT', '', 'labo',  'A'],   // ⚠️ à confirmer
    ['Lun', '08:05', '09:05', 'Vie de classe',            '', '',      'B'],   // ⚠️ à confirmer
    ['Lun', '09:05', '10:00', 'Sciences physiques / SVT', '', 'labo',  'A'],   // ⚠️ à confirmer
    ['Lun', '09:05', '10:00', 'Technologie',              '', '',      'B'],   // ⚠️ à confirmer
    ['Lun', '10:15', '11:15', 'Mathématiques',            '', '220',   ''],
    ['Lun', '11:15', '12:10', 'Français',                 '', '214',   ''],
    ['Lun', '13:40', '14:40', 'Allemand',                 '', '006',   ''],
    ['Lun', '14:40', '15:35', 'Arts plastiques',          '', '215',   ''],
    ['Lun', '15:50', '16:50', 'EPS',                      '', '',      ''],
    // ------------------------------------------------------------- mardi
    ['Mar', '08:05', '09:05', 'Latin',                    '', '114',   ''],
    ['Mar', '09:05', '10:00', 'Musique',                  '', '',      ''],
    ['Mar', '10:15', '11:15', 'Technologie',              '', '',      ''],
    ['Mar', '11:15', '12:10', 'Anglais',                  '', '213',   ''],
    ['Mar', '13:40', '14:40', 'Histoire-Géographie',      '', '208',   ''],
    ['Mar', '14:40', '15:35', 'Français',                 '', '214',   ''],
    ['Mar', '15:50', '16:50', 'Sciences physiques',       '', '',      ''],
    // ---------------------------------------------------------- mercredi
    ['Mer', '08:05', '09:05', 'DS',                       '', '',      ''],
    ['Mer', '09:05', '10:00', 'Histoire-Géographie',      '', '120',   ''],
    ['Mer', '10:15', '11:15', 'Allemand',                 '', '006',   ''],
    ['Mer', '11:15', '12:10', 'Mathématiques',            '', '220',   ''],
    // ------------------------------------------------------------- jeudi
    ['Jeu', '08:05', '09:05', 'Anglais',                  '', '213',   ''],
    ['Jeu', '09:05', '10:00', 'Français',                 '', '214',   ''],
    ['Jeu', '10:15', '11:15', 'EPS',                      '', '',      ''],
    ['Jeu', '11:15', '12:10', 'EPS',                      '', '',      ''],
    ['Jeu', '13:40', '14:40', 'Mathématiques',            '', '220',   'A'],
    ['Jeu', '13:40', '14:40', 'Étude',                    '', '',      'B'],
    ['Jeu', '14:40', '15:35', 'Français',                 '', '214',   ''],
    // ---------------------------------------------------------- vendredi
    ['Ven', '09:05', '10:00', 'Latin',                    '', '114',   ''],
    ['Ven', '10:15', '11:15', 'Français',                 '', '214',   'A'],
    ['Ven', '10:15', '11:15', 'Allemand',                 '', '006',   'B'],
    ['Ven', '11:15', '12:10', 'Histoire-Géographie',      '', '207',   ''],
    ['Ven', '13:40', '14:40', 'Anglais',                  '', '213',   ''],
    ['Ven', '14:40', '15:35', 'SVT',                      '', 'labo 2', ''],
    ['Ven', '15:50', '16:50', 'Mathématiques',            '', '220',   ''],
  ],
  activites: [
    ['Mer', '17:00', '19:00', 'Danse', '', true],
  ],
};

const EDT = { Martial: MARTIAL, Enora: ENORA };

/* Un créneau déjà présent n'est pas réinséré : l'outil doit pouvoir être rejoué
   après une correction sans dupliquer la moitié de la semaine. */
const cle = (c) => [c.personne, c.jour, c.debut || '', c.activite, c.quinzaine || ''].join('|');

function voulusPour(personne) {
  const e = EDT[personne];
  return [
    ...e.cours.map(([jour, debut, fin, activite, prof, salle, quinzaine]) => ({
      personne, jour, debut, fin, activite,
      prof: prof || null, salle: salle || null,
      categorie: 'cours', quinzaine: quinzaine || null, actif: true,
    })),
    ...e.activites.map(([jour, debut, fin, activite, lieu, actif]) => ({
      personne, jour, debut, fin, activite,
      prof: null, salle: null, lieu: lieu || null,
      categorie: 'activite', quinzaine: null, actif,
    })),
  ];
}

function importer(personne, { vraiment, remplacer }) {
  const voulus = voulusPour(personne);
  const avant = donnees.lignesPlanning({ personne });
  const anciens = avant.filter((c) => !voulus.some((v) => cle(v) === cle(c)));
  const deja = new Set(avant.map(cle));
  const nouveaux = voulus.filter((v) => !deja.has(cle(v)));

  console.log(`\n═══ ${personne} — ${vraiment ? 'ÉCRITURE' : 'SIMULATION (rien n’est écrit)'}`);
  console.log(`  déjà en base : ${avant.length} créneau(x)`);

  if (remplacer) {
    console.log(`\n  À retirer (corbeille douce, restaurable) : ${anciens.length}`);
    for (const c of anciens) console.log(`    − ${c.jour} ${c.debut || '--:--'} ${c.activite}`);
  } else if (anciens.length) {
    console.log(`\n  ${anciens.length} ancien(s) créneau(x) laissé(s) en place (--remplacer pour les retirer) :`);
    for (const c of anciens) console.log(`    · ${c.jour} ${c.debut || '--:--'} ${c.activite}`);
  }

  console.log(`\n  À insérer : ${nouveaux.length}`);
  for (const c of nouveaux) {
    const q = c.quinzaine ? `  [semaine ${c.quinzaine}]` : '';
    const off = c.actif ? '' : '  (désactivé)';
    const salle = c.salle ? ' · ' + c.salle : '';
    console.log(`    + ${c.jour} ${c.debut}–${c.fin}  ${c.activite}${salle}${q}${off}`);
  }
  if (voulus.length !== nouveaux.length)
    console.log(`  (${voulus.length - nouveaux.length} déjà présent(s), non redupliqué(s))`);

  if (!vraiment) return;

  if (remplacer) for (const c of anciens) donnees.supprimerCreneau(c.id);
  for (const c of nouveaux) donnees.enregistrerCreneau(c);

  const apres = donnees.lignesPlanning({ personne });
  console.log(`\n  ✓ ${personne} : ${apres.length} créneau(x), ${apres.filter((c) => c.actif).length} actif(s).`);
}

function main() {
  const argv = process.argv.slice(2);
  const vraiment = argv.includes('--vraiment');
  const remplacer = argv.includes('--remplacer');
  const qui = argv.includes('--tous')
    ? Object.keys(EDT)
    : argv.filter((a) => !a.startsWith('--'));

  if (!qui.length) {
    console.log('Usage : node outils/importer-edt.js <Martial|Enora|--tous> [--vraiment] [--remplacer]');
    process.exitCode = 1;
    return;
  }
  const inconnu = qui.find((n) => !EDT[n]);
  if (inconnu) {
    console.log(`Personne inconnue : « ${inconnu} ». Connues : ${Object.keys(EDT).join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  for (const n of qui) importer(n, { vraiment, remplacer });

  if (!vraiment) console.log('\nRien n’a été écrit. Relance avec --vraiment pour appliquer.');
  else console.log('\nL’écran mural reprend la nouvelle grille à son prochain rafraîchissement (5 min).');
}

main();

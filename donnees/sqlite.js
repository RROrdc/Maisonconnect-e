/* Couche données — implémentation SQLite (la cible depuis le 18/08/2026).

   Le choix déterminant : `node:sqlite`, INTÉGRÉ à Node depuis la 22.5.
   Aucun module natif à compiler, aucune installation, aucun droit admin — ce qui
   aurait bloqué `better-sqlite3` sur ce poste. Et `maison.db` se copie tel quel
   vers le Mac mini.

   Conventions du schéma :
   - `supprime_le` = suppression douce. On reproduit la corbeille de Notion, qui
     nous a déjà sauvés plusieurs fois. Rien n'est jamais effacé pour de bon.
   - `maj_le` sur toute table de contenu, pour la synchro.
   - `origine_notion` UNIQUE, pour que la migration reste rejouable.

   ⚠️ L'interface est la même que `notion.js`, mais tout est SYNCHRONE ici.
   Côté serveur on `await` quand même : attendre une valeur non-promesse est sans
   effet, et ça garde une interface unique entre les deux sources. */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { JOURS, COULEURS_FAMILLE, couleurDe, trierPersonnes } = require('./commun');
const { migrer } = require('./migrations');

const fichier = process.env.DB_FICHIER || path.join(__dirname, '..', 'maison.db');

/* ------------------------------------------------------------------ ouverture */
let db = null;

function ouvrir() {
  if (db) return db;
  const neuve = !fs.existsSync(fichier);
  db = new DatabaseSync(fichier);
  /* WAL : un lecteur ne bloque plus un écrivain. Sur un écran mural qui interroge
     en permanence pendant que les téléphones écrivent, ce n'est pas un luxe. */
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  if (neuve) {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);
    console.log('✓ Base créée : ' + fichier);
  }
  migrer(db);
  return db;
}

/* node:sqlite n'accepte ni `undefined` ni les booléens comme paramètres liés.
   On normalise ici plutôt que sur chaque appel — c'est le genre d'oubli qui ne
   se voit qu'au moment d'écrire, donc en production. */
const par = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

const q = (sql, ...p) => ouvrir().prepare(sql).all(...par(p));
const un = (sql, ...p) => ouvrir().prepare(sql).get(...par(p));
const ecrire = (sql, ...p) => ouvrir().prepare(sql).run(...par(p));

/* Les identifiants partent en TEXTE dans l'API. Le front les compare à des
   attributs `data-…`, qui sont toujours des chaînes : un id numérique ne
   correspondrait jamais et les coches deviendraient inertes. */
const sid = (v) => (v === null || v === undefined ? '' : String(v));
const nb = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/* Comparaison de noms « à l'humaine » : sans casse ni accents. Sert à ne pas
   créer deux fois « Pâtes pesto » et « pates pesto » dans la bibliothèque. */
const clef = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/* ------------------------------------------------------------------ réglages */
function lireReglages() {
  const out = {};
  for (const r of q(`SELECT cle, valeur FROM reglages`)) out[r.cle] = r.valeur;
  return out;
}
function reglage(cle, defaut) {
  const r = un(`SELECT valeur FROM reglages WHERE cle = ?`, cle);
  return r && r.valeur !== null && r.valeur !== '' ? r.valeur : defaut;
}
function ecrireReglages(obj) {
  for (const [cle, valeur] of Object.entries(obj || {}))
    ecrire(`INSERT INTO reglages (cle, valeur) VALUES (?, ?)
            ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`, cle, String(valeur ?? ''));
  return lireReglages();
}

/* Pose une valeur SEULEMENT si la clé n'existe pas encore. Sert à l'amorçage
   depuis le `.env` : une clé volontairement vidée depuis /admin/ existe toujours
   dans la table, elle ne sera donc jamais réécrite. Renvoie ce qui a été posé. */
function poserReglagesSiAbsents(obj) {
  const poses = [];
  for (const [cle, valeur] of Object.entries(obj || {})) {
    const r = ecrire(`INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO NOTHING`,
      cle, String(valeur ?? ''));
    if (Number(r.changes || 0) > 0) poses.push(cle);
  }
  return poses;
}

const couvertsDefaut = () => Number(reglage('couverts_defaut', 4)) || 4;

/* ------------------------------------------------------------------ personnes */
function lirePersonnes() {
  return q(`SELECT nom, couleur, foyer FROM personnes WHERE actif = 1 ORDER BY ordre, nom`)
    .map((p) => ({ nom: p.nom, couleur: p.couleur || COULEURS_FAMILLE[p.nom] || '', collectif: !p.foyer }));
}

/* ------------------------------------------------------------------ courses */
const lireCourses = () =>
  q(`SELECT id, article, rayon, pris, ajoute_par FROM courses
     WHERE supprime_le IS NULL ORDER BY id`)
    .map((c) => ({ id: sid(c.id), article: c.article, rayon: c.rayon || '', pris: !!c.pris, who: c.ajoute_par || '' }));

function ajouterCourse({ article, rayon, who }) {
  const r = ecrire(`INSERT INTO courses (article, rayon, ajoute_par) VALUES (?, ?, ?)`,
    String(article || '').trim(), rayon || null, who || null);
  return { id: sid(r.lastInsertRowid), article: String(article || '').trim(), rayon: rayon || '', pris: false, who: who || '' };
}

/* Ranger un article dans un rayon. Séparé de `cocherCourse` exprès : ranger et
   cocher sont deux gestes différents, et le rangement peut être automatique là
   où cocher ne l'est jamais. */
function definirRayon(id, rayon) {
  ecrire(`UPDATE courses SET rayon = ?, maj_le = datetime('now') WHERE id = ?`, rayon || null, id);
  return { id: sid(id), rayon: rayon || '' };
}

function cocherCourse(id, pris) {
  ecrire(`UPDATE courses SET pris = ?, maj_le = datetime('now') WHERE id = ?`, pris ? 1 : 0, id);
  return { id: sid(id), pris: !!pris };
}

/* Ajout groupé : UNE écriture, donc UNE diffusion temps réel. Ajouter quinze
   ingrédients un par un déclencherait quinze rechargements en cascade sur
   l'écran mural. */
function ajouterCoursesEnLot(articles, who) {
  const deja = new Set(lireCourses().map((c) => clef(c.article)));
  let ajoutes = 0;
  for (const brut of articles || []) {
    const article = String(brut || '').trim();
    if (!article || deja.has(clef(article))) continue;
    ecrire(`INSERT INTO courses (article, ajoute_par) VALUES (?, ?)`, article, who || null);
    deja.add(clef(article));
    ajoutes++;
  }
  return { ajoutes };
}

function viderCoursesPrises() {
  const r = ecrire(`UPDATE courses SET supprime_le = datetime('now'), maj_le = datetime('now')
                    WHERE pris = 1 AND supprime_le IS NULL`);
  return { supprimes: Number(r.changes || 0) };
}

/* ------------------------------------------------------------------ tâches */
const lireTaches = () =>
  q(`SELECT id, titre, assigne_a, echeance, fait FROM taches
     WHERE supprime_le IS NULL ORDER BY fait, echeance IS NULL, echeance, id`)
    .map((t) => ({ id: sid(t.id), tache: t.titre, who: t.assigne_a || '', due: t.echeance || '', done: !!t.fait }));

function ajouterTache({ tache, who, due }) {
  const r = ecrire(`INSERT INTO taches (titre, assigne_a, echeance) VALUES (?, ?, ?)`,
    String(tache || '').trim(), who || null, due || null);
  return { id: sid(r.lastInsertRowid), tache: String(tache || '').trim(), who: who || '', due: due || '', done: false };
}

function cocherTache(id, done) {
  ecrire(`UPDATE taches SET fait = ?, maj_le = datetime('now') WHERE id = ?`, done ? 1 : 0, id);
  return { id: sid(id), done: !!done };
}

/* ------------------------------------------------------------------ post-it */
const lirePostits = () =>
  q(`SELECT id, message, auteur, epingle FROM postits
     WHERE supprime_le IS NULL ORDER BY epingle DESC, id DESC`)
    .map((p) => ({ id: sid(p.id), message: p.message, who: p.auteur || '', pin: !!p.epingle }));

function ajouterPostit({ message, who }) {
  const r = ecrire(`INSERT INTO postits (message, auteur) VALUES (?, ?)`,
    String(message || '').trim(), who || null);
  return { id: sid(r.lastInsertRowid), message: String(message || '').trim(), who: who || '', pin: false };
}

/* ------------------------------------------------------------------ plats */
/* Le nombre de portions est DÉDUIT du texte, jamais saisi à part : une seule
   source de vérité pour l'utilisateur (« 4 à 6 personnes »), une base numérique
   fiable pour le calcul des quantités. */
function portionsNb(texte) {
  const m = /(\d+)/.exec(String(texte || ''));
  return m ? Number(m[1]) : null;
}

const lignes = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
const listeVirgules = (t) => String(t || '').split(',').map((x) => x.trim()).filter(Boolean);

/* Les plats servis à l'écran : juste de quoi afficher une vignette et savoir s'il
   y a une recette à ouvrir. Les ÉTAPES n'y sont pas — trente recettes à chaque
   rafraîchissement de l'écran mural seraient du gaspillage pur. */
const listePlats = () =>
  q(`SELECT id, nom, emoji, photo, duree, etapes FROM plats WHERE supprime_le IS NULL ORDER BY nom`)
    .map((p) => ({ id: sid(p.id), nom: p.nom, emoji: p.emoji || '', photo: p.photo || '',
      duree: p.duree || '', recette: !!(p.etapes && p.etapes.trim()) }));

const nomsPlats = () =>
  q(`SELECT nom FROM plats WHERE supprime_le IS NULL ORDER BY nom`)
    .map((p) => p.nom).sort((a, b) => a.localeCompare(b, 'fr'));

const listePlatsAdmin = () =>
  q(`SELECT * FROM plats WHERE supprime_le IS NULL ORDER BY nom`).map((p) => ({ ...p, id: sid(p.id) }));

/* Retrouve un plat par son nom, sinon le crée. C'est ce qui fait qu'un plat écrit
   à la main dans le menu rejoint la bibliothèque et devient réutilisable. */
function platId(nom) {
  const v = String(nom || '').trim();
  if (!v) return null;
  const trouve = q(`SELECT id, nom FROM plats WHERE supprime_le IS NULL`).find((p) => clef(p.nom) === clef(v));
  if (trouve) return trouve.id;
  const r = ecrire(`INSERT INTO plats (nom) VALUES (?)`, v);
  console.log(`+ plat ajouté à la bibliothèque : ${v}`);
  return Number(r.lastInsertRowid);
}

function platFiche(id) {
  const p = un(`SELECT * FROM plats WHERE id = ? AND supprime_le IS NULL`, id);
  return p ? { ...p, id: sid(p.id) } : null;
}

function enregistrerPlat(p) {
  const nom = String(p.nom || '').trim();
  if (!nom) throw new Error('Il faut un nom de plat.');
  const champs = {
    nom, emoji: p.emoji || null, categorie: p.categorie || null,
    ingredients: p.ingredients || null, etapes: p.etapes || null,
    portions: p.portions || null, portions_nb: portionsNb(p.portions),
    duree: p.duree || null, source_url: p.source_url || null,
    appareils: p.appareils || null, photo: p.photo || null,
  };
  if (p.id) {
    ecrire(`UPDATE plats SET nom=?, emoji=?, categorie=?, ingredients=?, etapes=?, portions=?,
              portions_nb=?, duree=?, source_url=?, appareils=?, photo=?, maj_le=datetime('now')
            WHERE id = ?`, ...Object.values(champs), p.id);
    return platFiche(p.id);
  }
  const r = ecrire(`INSERT INTO plats (nom, emoji, categorie, ingredients, etapes, portions,
                      portions_nb, duree, source_url, appareils, photo)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, ...Object.values(champs));
  return platFiche(Number(r.lastInsertRowid));
}

/* Fusion de doublons : le menu qui pointait vers le plat absorbé bascule sur celui
   qu'on garde, puis l'absorbé part à la corbeille. Sans le repointage, des jours
   de menu se videraient sans prévenir. */
function fusionnerPlats(garde, absorbe) {
  if (String(garde) === String(absorbe)) throw new Error('Choisis deux plats différents.');
  ecrire(`UPDATE menu SET midi_plat = ?, maj_le = datetime('now') WHERE midi_plat = ?`, garde, absorbe);
  ecrire(`UPDATE menu SET soir_plat = ?, maj_le = datetime('now') WHERE soir_plat = ?`, garde, absorbe);
  ecrire(`UPDATE plats SET supprime_le = datetime('now'), maj_le = datetime('now') WHERE id = ?`, absorbe);
  return { garde: sid(garde), absorbe: sid(absorbe) };
}

/* ------------------------------------------------------------------ menu */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function lundiDe(ref) {
  const d = ref ? new Date(String(ref).slice(0, 10) + 'T12:00:00') : new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/* Le menu est GLISSANT : on peut préparer la semaine suivante ou relire la
   précédente. Les sept jours d'une semaine consultée sont créés à la volée s'ils
   n'existent pas — sinon « Semaine suivante » ouvrirait une page vide et non
   éditable, ce qui ressemble à une panne. */
function assurerSemaine(lundi) {
  /* ⚠️ `i_menu_date` est un index unique PARTIEL (`WHERE date IS NOT NULL`).
     SQLite exige que la cible du ON CONFLICT reprenne le MÊME prédicat, sinon :
     « ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint ». */
  const poser = ouvrir().prepare(
    `INSERT INTO menu (jour, date) VALUES (?, ?)
     ON CONFLICT(date) WHERE date IS NOT NULL DO NOTHING`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(lundi);
    d.setDate(lundi.getDate() + i);
    poser.run(`${JOURS[i]} ${d.getDate()}`, ymd(d));
  }
}

function lireMenu(ref) {
  const lundi = lundiDe(ref);
  const dim = new Date(lundi);
  dim.setDate(lundi.getDate() + 6);
  if (reglage('menu_glissant', '1') === '1') assurerSemaine(lundi);

  const defaut = couvertsDefaut();
  return q(`SELECT m.*, pm.nom AS n_midi, pm.photo AS ph_midi, ps.nom AS n_soir, ps.photo AS ph_soir
            FROM menu m
            LEFT JOIN plats pm ON pm.id = m.midi_plat AND pm.supprime_le IS NULL
            LEFT JOIN plats ps ON ps.id = m.soir_plat AND ps.supprime_le IS NULL
            WHERE m.date BETWEEN ? AND ? ORDER BY m.date`, ymd(lundi), ymd(dim))
    .map((m) => ({
      id: sid(m.id), jour: m.jour, date: m.date,
      midi: m.n_midi || m.midi_libre || '',
      soir: m.n_soir || m.soir_libre || '',
      midiId: m.n_midi ? sid(m.midi_plat) : '',
      soirId: m.n_soir ? sid(m.soir_plat) : '',
      midiPhoto: m.ph_midi || '',
      soirPhoto: m.ph_soir || '',
      /* `couvertsProposes` est branché par le serveur d'après la garde alternée :
         il PROPOSE, il ne remplace pas. Un nombre choisi à la main l'emporte
         toujours — c'est la règle du projet, la machine propose et l'humain
         décide. */
      midiCouverts: m.midi_couverts || defaut,
      soirCouverts: m.soir_couverts || defaut,
      midiCouvertsChoisi: m.midi_couverts != null,
      soirCouvertsChoisi: m.soir_couverts != null,
    }));
}

/* Toutes les lignes de menu, brutes, pour savoir quand un plat a été mangé la
   dernière fois. Lecture seule et sans jointure : c'est un historique, pas un
   affichage. */
const lignesMenuBrutes = () =>
  q(`SELECT date, midi_plat, soir_plat FROM menu WHERE date IS NOT NULL ORDER BY date`);

/* `special:true` = « pas de cuisine » (Restaurant, Sortie…) : texte libre, et
   surtout JAMAIS ajouté à la bibliothèque de plats.
   ⚠️ Piège déjà payé deux fois : restaurer un champ « (libre) » par un PATCH sans
   `special:true` convertit le texte en plat et pollue la bibliothèque. */
function definirMenu(id, corps) {
  const { special } = corps || {};
  for (const champ of ['midi', 'soir']) {
    const val = corps[champ];
    if (typeof val === 'string') {
      const v = val.trim();
      let plat = null, libre = null;
      if (v) { if (special) libre = v; else plat = platId(v); }
      ecrire(`UPDATE menu SET ${champ}_plat = ?, ${champ}_libre = ?, maj_le = datetime('now') WHERE id = ?`,
        plat, libre, id);
    }
    const cvt = corps[champ + 'Couverts'];
    if (cvt !== undefined) {
      ecrire(`UPDATE menu SET ${champ}_couverts = ?, maj_le = datetime('now') WHERE id = ?`,
        nb(cvt), id);
    }
  }
  const ligne = un(`SELECT date FROM menu WHERE id = ?`, id);
  return lireMenu(ligne && ligne.date).find((m) => m.id === sid(id)) || null;
}

/* ------------------------------------------------------------------ planning */
function lignesPlanning(filtre = {}) {
  const où = [`supprime_le IS NULL`];
  const p = [];
  if (filtre.personne) { où.push(`personne = ?`); p.push(filtre.personne); }
  if (filtre.actifSeul) où.push(`actif = 1`);
  return q(`SELECT * FROM planning WHERE ${où.join(' AND ')}
            ORDER BY personne, debut IS NULL, debut, id`, ...p)
    .map((c) => ({ ...c, id: sid(c.id), actif: !!c.actif }));
}

/* Regroupé par personne et par jour, comme l'attend l'écran mural.
   Une personne sans aucun créneau n'apparaît pas : une pastille vide n'apprend
   rien et vole de la place. */
function lirePlannings(options = {}) {
  const par = {};
  const couleurs = {};
  for (const p of q(`SELECT nom, couleur FROM personnes`)) couleurs[p.nom] = p.couleur;

  /* Semaine A / semaine B des collèges et lycées.
     Un créneau SANS quinzaine vaut toutes les semaines — c'est le cas courant,
     et c'est pour ça que le champ est vide par défaut. Un créneau marqué A ne
     doit apparaître qu'en semaine A : sans ce filtre, l'écran mural affichait
     les deux emplois du temps SUPERPOSÉS, ce qui est pire que pas d'emploi du
     temps du tout — on ne sait plus lequel croire. */
  const quinzaine = options.quinzaine === undefined ? quinzaineCourante() : options.quinzaine;

  for (const c of lignesPlanning({ actifSeul: true })) {
    if (quinzaine && c.quinzaine && c.quinzaine !== quinzaine) continue;
    if (!par[c.personne]) {
      par[c.personne] = {
        nom: c.personne,
        couleur: couleurs[c.personne] || couleurDe(c.personne, Object.keys(par).length),
        semaine: {},
      };
    }
    (par[c.personne].semaine[c.jour] ||= []).push({
      h: c.debut || '', fin: c.fin || '', quoi: c.activite, ou: c.lieu || '',
      type: c.type || '', categorie: c.categorie || '', prof: c.prof || '',
      salle: c.salle || '', quinzaine: c.quinzaine || '', couleur: c.couleur || '',
    });
  }
  for (const p of Object.values(par))
    for (const j of JOURS) (p.semaine[j] ||= []).sort((a, b) => (a.h || '').localeCompare(b.h || ''));

  return {
    exemple: reglage('planning_exemple', '0') === '1',
    personnes: trierPersonnes(Object.values(par)),
    /* L'écran DIT quelle quinzaine il montre. Un emploi du temps qui change une
       semaine sur deux sans l'annoncer fait douter de son exactitude. */
    quinzaine,
    semaine: semaineIso(),
    /* Y a-t-il seulement des créneaux en quinzaine ? Si non, inutile d'encombrer
       l'écran avec un repère A/B qui ne sert à personne. */
    alterne: q(`SELECT COUNT(*) n FROM planning
                WHERE supprime_le IS NULL AND actif = 1 AND quinzaine IS NOT NULL AND quinzaine != ''`)[0].n > 0,
  };
}

/* Quelle quinzaine pour une date donnée — pour consulter la semaine suivante. */
function quinzaineDe(date) {
  const paire = reglage('quinzaine_paire', '0') === '1';
  const s = semaineIso(date ? new Date(date) : new Date());
  return (s % 2 === 0) === paire ? 'A' : 'B';
}

function enregistrerCreneau(c) {
  const activite = String(c.activite || '').trim();
  if (!activite) throw new Error('Il faut un intitulé.');
  if (!c.personne) throw new Error('Il faut une personne.');
  const champs = [
    c.personne, c.jour || 'Lun', c.debut || null, c.fin || null, activite,
    c.lieu || null, c.type || null, c.actif === false ? 0 : 1,
    c.categorie || null, c.prof || null, c.salle || null,
    c.quinzaine || null, c.couleur || null,
  ];
  if (c.id) {
    ecrire(`UPDATE planning SET personne=?, jour=?, debut=?, fin=?, activite=?, lieu=?, type=?,
              actif=?, categorie=?, prof=?, salle=?, quinzaine=?, couleur=?, maj_le=datetime('now')
            WHERE id = ?`, ...champs, c.id);
    return sid(c.id);
  }
  const r = ecrire(`INSERT INTO planning (personne, jour, debut, fin, activite, lieu, type,
                      actif, categorie, prof, salle, quinzaine, couleur)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...champs);
  return sid(r.lastInsertRowid);
}

function supprimerCreneau(id) {
  ecrire(`UPDATE planning SET supprime_le = datetime('now'), maj_le = datetime('now') WHERE id = ?`, id);
  return { id: sid(id) };
}

/* Copie d'une journée vers une autre. Les créneaux du jour d'arrivée sont
   CONSERVÉS : la copie s'ajoute. Écraser silencieusement une journée déjà saisie
   serait le pire des deux comportements. */
function copierJournee(personne, de, vers) {
  if (!personne || !de || !vers || de === vers) throw new Error('Choisis deux jours différents.');
  const source = lignesPlanning({ personne }).filter((c) => c.jour === de);
  for (const c of source) enregistrerCreneau({ ...c, id: null, jour: vers });
  return { copies: source.length };
}

/* ------------------------------------------------------------------ corbeille commune */
const GENRES = { todo: 'taches', course: 'courses', postit: 'postits', plat: 'plats', notif: 'notifications' };

function supprimer(genre, id) {
  const table = GENRES[genre];
  if (!table) return null;
  ecrire(`UPDATE ${table} SET supprime_le = datetime('now'), maj_le = datetime('now') WHERE id = ?`, id);
  return { genre, id: sid(id) };
}

/* ------------------------------------------------------------------ membres */
const listeMembres = () =>
  q(`SELECT * FROM personnes ORDER BY ordre, nom`).map((m) => ({
    id: sid(m.id), nom: m.nom, couleur: m.couleur || '', role: m.role || '',
    ordre: m.ordre, email: m.email || '', telephone: m.telephone || '',
    etablissement: m.etablissement || '', classe: m.classe || '',
    naissance: m.naissance || '',
    admin: !!m.admin, notif: !!m.notif, actif: !!m.actif,
    collectif: !m.foyer, a_code: !!m.code_hash,
  }));

/* Renommer une personne doit propager le nouveau nom PARTOUT : les tables
   référencent le prénom (héritage de Notion). Sans ça, on orpheline d'un coup
   son planning, ses tâches et ses appareils. */
function renommerPartout(avant, apres) {
  if (!avant || !apres || avant === apres) return;
  const cibles = [
    ['planning', 'personne'], ['taches', 'assigne_a'], ['courses', 'ajoute_par'],
    ['postits', 'auteur'], ['appareils', 'personne'], ['sessions', 'personne'],
    ['notifications', 'pour'], ['notifications', 'de'],
  ];
  for (const [table, champ] of cibles)
    ecrire(`UPDATE ${table} SET ${champ} = ? WHERE ${champ} = ?`, apres, avant);
}

function enregistrerMembre(m) {
  const nom = String(m.nom || '').trim();
  if (!nom) throw new Error('Il faut un prénom.');
  /* Date de naissance : la colonne existait depuis le § 2 quater mais aucun
     formulaire ne l'alimentait — les anniversaires étaient donc inatteignables.
     Vide est accepté et signifie « non renseignée », pas « à ignorer ». */
  const naissance = /^\d{4}-\d{2}-\d{2}$/.test(String(m.naissance || '')) ? m.naissance : null;
  const champs = [
    nom, m.couleur || null, m.role || null, Number(m.ordre) || 0,
    m.collectif ? 0 : 1, m.actif === false ? 0 : 1,
    m.email || null, m.telephone || null, m.etablissement || null, m.classe || null,
    m.admin ? 1 : 0, m.notif === false ? 0 : 1, naissance,
  ];
  if (m.id) {
    const avant = un(`SELECT nom FROM personnes WHERE id = ?`, m.id);
    ecrire(`UPDATE personnes SET nom=?, couleur=?, role=?, ordre=?, foyer=?, actif=?,
              email=?, telephone=?, etablissement=?, classe=?, admin=?, notif=?, naissance=?,
              maj_le=datetime('now')
            WHERE id = ?`, ...champs, m.id);
    if (avant) renommerPartout(avant.nom, nom);
    return sid(m.id);
  }
  const r = ecrire(`INSERT INTO personnes (nom, couleur, role, ordre, foyer, actif,
                      email, telephone, etablissement, classe, admin, notif, naissance)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...champs);
  return sid(r.lastInsertRowid);
}

/* On DÉSACTIVE, on ne supprime pas : ses tâches et son planning gardent un sens,
   et le geste est réversible. */
function desactiverMembre(id) {
  ecrire(`UPDATE personnes SET actif = 0, maj_le = datetime('now') WHERE id = ?`, id);
  return { id: sid(id) };
}

/* ------------------------------------------------------------------ codes & sessions */
/* scrypt + sel par personne. Le code n'est JAMAIS stocké en clair : on ne peut
   pas le relire, seulement le remplacer. */
function definirCode(nom, code) {
  if (!code) {
    ecrire(`UPDATE personnes SET code_hash = NULL, code_sel = NULL, maj_le = datetime('now') WHERE nom = ?`, nom);
    return { code: false };
  }
  const sel = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(code), sel, 64).toString('hex');
  ecrire(`UPDATE personnes SET code_hash = ?, code_sel = ?, maj_le = datetime('now') WHERE nom = ?`, hash, sel, nom);
  return { code: true };
}

function verifierCode(nom, code) {
  const p = un(`SELECT * FROM personnes WHERE nom = ? AND actif = 1`, nom);
  if (!p) return null;
  /* Un membre SANS code peut entrer : c'est l'amorçage (personne n'a de code au
     départ), et c'est déjà le niveau d'ouverture de l'app sur le réseau local.
     Le tableau de bord affiche un avertissement tant qu'il en reste. */
  if (!p.code_hash) return p;
  if (!code) return null;
  const essai = crypto.scryptSync(String(code), p.code_sel, 64);
  const attendu = Buffer.from(p.code_hash, 'hex');
  return essai.length === attendu.length && crypto.timingSafeEqual(essai, attendu) ? p : null;
}

const profil = (p) => p && ({
  nom: p.nom, couleur: p.couleur || '', role: p.role || '',
  admin: !!p.admin, collectif: !p.foyer,
});

function creerSession(nom, heures = 12) {
  const jeton = crypto.randomBytes(24).toString('hex');
  const expire = new Date(Date.now() + heures * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  ecrire(`INSERT INTO sessions (jeton, personne, expire_le) VALUES (?, ?, ?)`, jeton, nom, expire);
  return jeton;
}

function lireSession(jeton) {
  if (!jeton) return null;
  const s = un(`SELECT * FROM sessions WHERE jeton = ? AND expire_le > datetime('now')`, jeton);
  if (!s) return null;
  return un(`SELECT * FROM personnes WHERE nom = ? AND actif = 1`, s.personne) || null;
}

const supprimerSession = (jeton) => ecrire(`DELETE FROM sessions WHERE jeton = ?`, jeton);
const purgerSessions = () => ecrire(`DELETE FROM sessions WHERE expire_le <= datetime('now')`);

/* ------------------------------------------------------------------ appareils */
/* Enrôlement une seule fois : le téléphone tire un jeton au sort, on l'associe à
   une personne, et on ne redemande plus jamais. */
function enrolerAppareil({ jeton, personne, nom }) {
  if (!jeton || !personne) throw new Error('Jeton et personne obligatoires.');
  ecrire(`INSERT INTO appareils (jeton, personne, nom) VALUES (?, ?, ?)
          ON CONFLICT(jeton) DO UPDATE SET personne = excluded.personne, nom = excluded.nom,
            revoque_le = NULL, vu_le = datetime('now')`, jeton, personne, nom || null);
  return { personne };
}

function appareil(jeton) {
  if (!jeton) return null;
  const a = un(`SELECT * FROM appareils WHERE jeton = ? AND revoque_le IS NULL`, jeton);
  if (!a) return null;
  ecrire(`UPDATE appareils SET vu_le = datetime('now') WHERE id = ?`, a.id);
  return { id: sid(a.id), personne: a.personne, nom: a.nom || '' };
}

const listeAppareils = () =>
  q(`SELECT * FROM appareils ORDER BY revoque_le IS NOT NULL, vu_le DESC, id`)
    .map((a) => ({ id: sid(a.id), personne: a.personne, nom: a.nom || '', vu_le: a.vu_le || '', revoque: !!a.revoque_le }));

const revoquerAppareil = (id) => {
  ecrire(`UPDATE appareils SET revoque_le = datetime('now') WHERE id = ?`, id);
  return { id: sid(id) };
};

/* ------------------------------------------------------------------ notifications */
/* On écrit en base PUIS on diffuse (la diffusion est faite par le serveur).
   Séparer les deux permet à un téléphone éteint de rattraper l'historique. */
function ajouterNotif({ titre, message, pour, de, niveau }) {
  const r = ecrire(`INSERT INTO notifications (titre, message, pour, de, niveau, maj_le)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    String(titre || '').trim(), message || null, pour || null, de || null, niveau || 'info');
  return {
    id: sid(r.lastInsertRowid), titre: String(titre || '').trim(), message: message || '',
    pour: pour || '', de: de || '', niveau: niveau || 'info',
    cree_le: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
}

const listeNotifs = (pour, max = 40) =>
  q(`SELECT * FROM notifications WHERE supprime_le IS NULL
     ${pour ? `AND (pour IS NULL OR pour = ?)` : ''}
     ORDER BY id DESC LIMIT ?`, ...(pour ? [pour, max] : [max]))
    .map((n) => ({ id: sid(n.id), titre: n.titre, message: n.message || '', pour: n.pour || '',
      de: n.de || '', niveau: n.niveau || 'info', cree_le: n.cree_le, lu: !!n.lu_le }));

/* ------------------------------------------------------------------ journal
   Une panne qui n'existe que dans la console du serveur n'existe pour personne :
   sur le mur, un calendrier injoignable ressemble à un agenda vide. */
function journaliser(niveau, source, message, detail) {
  const cle = `${source}|${String(message).slice(0, 120)}`;
  /* Une même panne qui se répète toutes les dix minutes ne doit pas noyer le
     journal : on incrémente un compteur et on remonte la date. */
  ecrire(`INSERT INTO journal (niveau, source, message, detail, cle)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(cle) WHERE cle IS NOT NULL DO UPDATE SET
            nb = journal.nb + 1, cree_le = datetime('now'),
            detail = excluded.detail, niveau = excluded.niveau, vu_le = NULL`,
    niveau || 'erreur', source, String(message || ''), detail ? String(detail).slice(0, 2000) : null, cle);
  /* On borne : 200 lignes suffisent à comprendre, et personne ne relit au-delà. */
  ecrire(`DELETE FROM journal WHERE id NOT IN (SELECT id FROM journal ORDER BY cree_le DESC LIMIT 200)`);
}

const lireJournal = (max = 80) =>
  q(`SELECT * FROM journal ORDER BY cree_le DESC LIMIT ?`, max)
    .map((l) => ({ ...l, id: sid(l.id), vu: !!l.vu_le }));

const viderJournal = () => ({ retires: Number(ecrire(`DELETE FROM journal`).changes || 0) });
const marquerJournalVu = () => ecrire(`UPDATE journal SET vu_le = datetime('now') WHERE vu_le IS NULL`);
const journalNonVu = () => Number((un(`SELECT COUNT(*) n FROM journal WHERE vu_le IS NULL AND niveau != 'info'`) || {}).n || 0);

/* ------------------------------------------------------------------ anniversaires
   Deux origines, une seule lecture :
   - le foyer, dans `personnes.naissance` (la colonne existait déjà, inutilisée) ;
   - les autres (grands-parents, cousins…), dans la table `anniversaires`.
   Une personne n'est donc jamais décrite à deux endroits. */
const moisJour = (d) => String(d || '').slice(5, 10);          // 'AAAA-MM-JJ' → 'MM-JJ'

function lireAnniversaires() {
  const out = [];
  for (const p of q(`SELECT nom, naissance, couleur FROM personnes
                     WHERE actif = 1 AND naissance IS NOT NULL AND naissance != ''`))
    out.push({ id: 'p:' + p.nom, nom: p.nom, naissance: p.naissance, relation: 'foyer',
      couleur: p.couleur || '', foyer: true, rappel: true });

  for (const a of q(`SELECT * FROM anniversaires WHERE supprime_le IS NULL`))
    out.push({ id: sid(a.id), nom: a.nom, naissance: a.naissance, relation: a.relation || '',
      couleur: '', foyer: false, rappel: !!a.rappel });

  /* Triés par date dans l'ANNÉE, pas par année de naissance : c'est « qui vient
     ensuite » qui intéresse. */
  return out.sort((a, b) => moisJour(a.naissance).localeCompare(moisJour(b.naissance)));
}

/* Âge atteint le jour de l'anniversaire. Renvoie null si l'année est inconnue —
   annoncer « 0 ans » serait pire que ne rien annoncer. */
function ageAtteint(naissance, reference = new Date()) {
  const an = Number(String(naissance || '').slice(0, 4));
  if (!an || an < 1900) return null;
  const [m, j] = moisJour(naissance).split('-').map(Number);
  let age = reference.getFullYear() - an;
  const mois = reference.getMonth() + 1, jour = reference.getDate();
  if (mois < m || (mois === m && jour < j)) age -= 1;
  return age;
}

/* Ceux dont c'est l'anniversaire dans exactement `dans` jours (0 = aujourd'hui). */
function anniversairesDans(dans = 0, liste) {
  const cible = new Date();
  cible.setDate(cible.getDate() + dans);
  const cle = `${String(cible.getMonth() + 1).padStart(2, '0')}-${String(cible.getDate()).padStart(2, '0')}`;
  return (liste || lireAnniversaires())
    .filter((a) => moisJour(a.naissance) === cle)
    .map((a) => ({ ...a, age: ageAtteint(a.naissance, cible) }));
}

function enregistrerAnniversaire(a) {
  const nom = String(a.nom || '').trim();
  if (!nom) throw new Error('Il faut un nom.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.naissance || '')))
    throw new Error('Date attendue au format AAAA-MM-JJ (mets 0000 si tu ne connais pas l’année).');
  const champs = [nom, a.naissance, a.relation || null, a.rappel === false ? 0 : 1];
  if (a.id) {
    ecrire(`UPDATE anniversaires SET nom=?, naissance=?, relation=?, rappel=?, maj_le=datetime('now')
            WHERE id = ?`, ...champs, a.id);
    return sid(a.id);
  }
  const r = ecrire(`INSERT INTO anniversaires (nom, naissance, relation, rappel) VALUES (?,?,?,?)`, ...champs);
  return sid(r.lastInsertRowid);
}

const supprimerAnniversaire = (id) => {
  ecrire(`UPDATE anniversaires SET supprime_le = datetime('now'), maj_le = datetime('now') WHERE id = ?`, id);
  return { id: sid(id) };
};

/* ------------------------------------------------------------------ courses : historique
   La corbeille conserve tout ce qui a été acheté puis retiré : c'est
   gratuitement un historique d'achats. On s'en sert pour proposer ce qu'on
   rachète toujours, au lieu de le retaper chaque semaine. */
function articlesHabituels(max = 10) {
  const surLaListe = new Set(lireCourses().map((c) => clef(c.article)));
  return q(`SELECT article, COUNT(*) n, MAX(rayon) rayon, MAX(cree_le) dernier
            FROM courses
            WHERE supprime_le IS NOT NULL
            GROUP BY LOWER(article)
            HAVING n >= 2
            ORDER BY n DESC, dernier DESC
            LIMIT 40`)
    .filter((a) => !surLaListe.has(clef(a.article)))
    .slice(0, max)
    .map((a) => ({ article: a.article, fois: a.n, rayon: a.rayon || '' }));
}

/* ------------------------------------------------------------------ tâches à échéance
   « en retard ou pour aujourd'hui » : c'est ce dont on veut être prévenu le matin. */
const tachesAEcheance = () => {
  const aujourdhui = ymd(new Date());
  return lireTaches().filter((t) => !t.done && t.due && t.due <= aujourdhui)
    .map((t) => ({ ...t, retard: t.due < aujourdhui }));
};

/* ------------------------------------------------------------------ état (back-office) */
/* Numéro de semaine ISO — sert à savoir si on est en quinzaine A ou B. */
function semaineIso(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - jan1) / 86400000 + 1) / 7);
}

function quinzaineCourante() {
  const paire = reglage('quinzaine_paire', '0') === '1';
  const s = semaineIso();
  return (s % 2 === 0) === paire ? 'A' : 'B';
}

function etat() {
  const compte = (sql) => Number((un(sql) || {}).n || 0);
  return {
    semaine: semaineIso(),
    quinzaine: quinzaineCourante(),
    exemple: reglage('planning_exemple', '0') === '1',
    sansCode: q(`SELECT nom FROM personnes WHERE actif = 1 AND foyer = 1 AND code_hash IS NULL ORDER BY ordre`)
      .map((p) => p.nom),
    membres: compte(`SELECT COUNT(*) n FROM personnes WHERE actif = 1`),
    creneaux: compte(`SELECT COUNT(*) n FROM planning WHERE supprime_le IS NULL AND actif = 1`),
    plats: compte(`SELECT COUNT(*) n FROM plats WHERE supprime_le IS NULL`),
    courses: compte(`SELECT COUNT(*) n FROM courses WHERE supprime_le IS NULL AND pris = 0`),
    taches: compte(`SELECT COUNT(*) n FROM taches WHERE supprime_le IS NULL AND fait = 0`),
    appareils: compte(`SELECT COUNT(*) n FROM appareils WHERE revoque_le IS NULL`),
  };
}

/* ------------------------------------------------------------------ tout */
function tout() {
  return {
    personnes: lirePersonnes(),
    dishes: nomsPlats(),
    plats: listePlats(),
    menu: lireMenu(),
    courses: lireCourses(),
    todos: lireTaches(),
    postits: lirePostits(),
    plannings: lirePlannings(),
  };
}

module.exports = {
  nom: 'sqlite', fichier, ouvrir,
  tout, lireCourses, lireTaches, lirePostits, lireMenu, lirePlannings, lirePersonnes,
  ajouterCourse, cocherCourse, definirRayon, ajouterCoursesEnLot, viderCoursesPrises,
  ajouterTache, cocherTache, ajouterPostit,
  definirMenu, lignesMenuBrutes, supprimer,
  listePlats, listePlatsAdmin, nomsPlats, platId, platFiche, enregistrerPlat, fusionnerPlats,
  lignesPlanning, enregistrerCreneau, supprimerCreneau, copierJournee,
  listeMembres, enregistrerMembre, desactiverMembre, definirCode, verifierCode, profil,
  creerSession, lireSession, supprimerSession, purgerSessions,
  enrolerAppareil, appareil, listeAppareils, revoquerAppareil,
  ajouterNotif, listeNotifs,
  lireReglages, ecrireReglages, poserReglagesSiAbsents, reglage, couvertsDefaut,
  journaliser, lireJournal, viderJournal, marquerJournalVu, journalNonVu,
  lireAnniversaires, anniversairesDans, ageAtteint, enregistrerAnniversaire, supprimerAnniversaire,
  articlesHabituels, tachesAEcheance,
  etat, semaineIso, quinzaineCourante, quinzaineDe,
  lignes, listeVirgules, portionsNb, clef, ymd,
};

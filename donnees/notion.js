/* Couche données — implémentation Notion (l'historique).
   Conservée pour deux raisons : elle sert de SOURCE à la migration, et elle reste un filet
   si la bascule vers SQLite pose problème (`SOURCE=notion` dans .env).
   Après la bascule, la famille n'écrit plus dans Notion : cet espace devient une archive figée.

   Note : l'interface est la même que `sqlite.js`, mais tout est asynchrone ici.
   Côté serveur on `await` systématiquement — attendre une valeur non-promesse est sans effet. */
const { Client } = require('@notionhq/client');
const { JOURS, couleurDe, trierPersonnes } = require('./commun');

/* On force le fetch natif de Node (undici) : le node-fetch embarqué par le SDK
   casse sur Node 20+ avec « ERR_STREAM_PREMATURE_CLOSE » sur les réponses gzip. */
const notion = new Client({ auth: process.env.NOTION_TOKEN, fetch: (...a) => fetch(...a) });

const DB = {
  todo: process.env.DB_TODO, course: process.env.DB_COURSE, postit: process.env.DB_POSTIT,
  menu: process.env.DB_MENU, plats: process.env.DB_PLATS, planning: process.env.DB_PLANNING,
};

const pTitle = (p) => p?.title?.[0]?.plain_text ?? '';
const pText  = (p) => p?.rich_text?.[0]?.plain_text ?? '';
const pSel   = (p) => p?.select?.name ?? '';
const pChk   = (p) => !!p?.checkbox;
const pDate  = (p) => p?.date?.start ?? '';
const pStatus= (p) => p?.status?.name ?? '';

async function queryAll(database_id, extra = {}) {
  const out = []; let cursor;
  do {
    const r = await notion.databases.query({ database_id, start_cursor: cursor, ...extra });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function platsMap() {
  const map = {};
  for (const pg of await queryAll(DB.plats)) map[pg.id] = pTitle(pg.properties['Plat']);
  return map;
}

async function lireMenu(pm) {
  pm = pm || await platsMap();
  return (await queryAll(DB.menu)).map((pg) => {
    const P = pg.properties;
    const soirRel = (P['Soir (plat)']?.relation || []).map((r) => pm[r.id]).filter(Boolean);
    const midiRel = (P['Midi (plat)']?.relation || []).map((r) => pm[r.id]).filter(Boolean);
    return { id: pg.id, jour: pTitle(P['Jour']), date: pDate(P['Date']),
      soir: soirRel[0] || pText(P['Soir (libre)']), midi: midiRel[0] || pText(P['Midi (libre)']) };
  }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

const lireCourses = async () => (await queryAll(DB.course)).map((pg) => ({
  id: pg.id, article: pTitle(pg.properties['Article']), rayon: pSel(pg.properties['Rayon']),
  pris: pChk(pg.properties['Pris']), who: pSel(pg.properties['Ajouté par']) }));

const lireTaches = async () => (await queryAll(DB.todo)).map((pg) => ({
  id: pg.id, tache: pTitle(pg.properties['Tâche']), who: pSel(pg.properties['Assigné à']),
  due: pDate(pg.properties['Échéance']), done: pStatus(pg.properties['Statut']) === 'Terminé' }));

const lirePostits = async () => (await queryAll(DB.postit)).map((pg) => ({
  id: pg.id, message: pTitle(pg.properties['Message']), who: pSel(pg.properties['Auteur']),
  pin: pChk(pg.properties['Épinglé']) })).sort((a, b) => (b.pin === a.pin ? 0 : b.pin ? 1 : -1));

async function lirePlannings() {
  if (!DB.planning) return { exemple: false, personnes: [] };
  try {
    const par = {};
    for (const pg of await queryAll(DB.planning)) {
      const P = pg.properties;
      if (P['Actif']?.checkbox === false) continue;        // créneau désactivé (vacances…)
      const nom = pSel(P['Personne']), jour = pSel(P['Jour']);
      if (!nom || !jour) continue;
      if (!par[nom]) par[nom] = { nom, couleur: couleurDe(nom, Object.keys(par).length), semaine: {} };
      (par[nom].semaine[jour] ||= []).push({
        h: pText(P['Début']), fin: pText(P['Fin']),
        quoi: pTitle(P['Activité']), ou: pText(P['Lieu']), type: pSel(P['Type']) });
    }
    for (const p of Object.values(par))
      for (const j of JOURS) (p.semaine[j] ||= []).sort((a, b) => (a.h || '').localeCompare(b.h || ''));
    return { exemple: process.env.PLANNING_EXEMPLE === '1', personnes: trierPersonnes(Object.values(par)) };
  } catch (e) {
    console.error('Planning Notion:', e.message);
    return { exemple: false, personnes: [] };
  }
}

/* Notion n'a pas de base « personnes » : on rend la liste historique, celle qui était
   codée en dur dans le front. Avec SQLite, elle vient de la table `personnes`. */
const lirePersonnes = () => ['Rémi', 'Amandine', 'Enora', 'Martial', 'Garçons', 'Toute la famille']
  .map((nom, i) => ({ nom, couleur: '', collectif: i === 5 }));

async function tout() {
  const pm = await platsMap();
  const [menu, courses, todos, postits, plannings] = await Promise.all([
    lireMenu(pm), lireCourses(), lireTaches(), lirePostits(), lirePlannings(),
  ]);
  return { personnes: lirePersonnes(),
    dishes: Object.values(pm).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    menu, courses, todos, postits, plannings };
}

/* ---------- écritures ---------- */

async function ajouterCourse({ article, rayon, who }) {
  const props = { 'Article': { title: [{ text: { content: article || '' } }] }, 'Pris': { checkbox: false } };
  if (rayon) props['Rayon'] = { select: { name: rayon } };
  if (who) props['Ajouté par'] = { select: { name: who } };
  const pg = await notion.pages.create({ parent: { database_id: DB.course }, properties: props });
  return { id: pg.id, article: article || '', rayon: rayon || '', pris: false, who: who || '' };
}

async function cocherCourse(id, pris) {
  await notion.pages.update({ page_id: id, properties: { 'Pris': { checkbox: !!pris } } });
  return { id, pris: !!pris };
}

async function ajouterTache({ tache, who, due }) {
  const props = { 'Tâche': { title: [{ text: { content: tache || '' } }] },
    'Statut': { status: { name: 'Pas commencé' } } };
  if (who) props['Assigné à'] = { select: { name: who } };
  if (due) props['Échéance'] = { date: { start: due } };
  const pg = await notion.pages.create({ parent: { database_id: DB.todo }, properties: props });
  return { id: pg.id, tache: tache || '', who: who || '', due: due || '', done: false };
}

async function cocherTache(id, done) {
  await notion.pages.update({ page_id: id,
    properties: { 'Statut': { status: { name: done ? 'Terminé' : 'Pas commencé' } } } });
  return { id, done: !!done };
}

async function ajouterPostit({ message, who }) {
  const props = { 'Message': { title: [{ text: { content: message || '' } }] }, 'Épinglé': { checkbox: false } };
  if (who) props['Auteur'] = { select: { name: who } };
  const pg = await notion.pages.create({ parent: { database_id: DB.postit }, properties: props });
  return { id: pg.id, message: message || '', who: who || '', pin: false };
}

async function definirMenu(id, { midi, soir, special }) {
  const byName = {};
  for (const [pid, nom] of Object.entries(await platsMap())) if (nom) byName[nom.trim()] = pid;
  const props = {};
  for (const champ of ['midi', 'soir']) {
    const val = champ === 'midi' ? midi : soir;
    if (typeof val !== 'string') continue;
    const label = champ === 'midi' ? 'Midi' : 'Soir';
    const v = val.trim();
    if (!v) {
      props[`${label} (plat)`] = { relation: [] };
      props[`${label} (libre)`] = { rich_text: [] };
    } else if (special) {
      props[`${label} (plat)`] = { relation: [] };
      props[`${label} (libre)`] = { rich_text: [{ text: { content: v } }] };
    } else {
      let platId = byName[v];
      if (!platId) {
        const pg = await notion.pages.create({ parent: { database_id: DB.plats },
          properties: { 'Plat': { title: [{ text: { content: v } }] } } });
        platId = pg.id;
        console.log(`+ plat ajouté à la bibliothèque : ${v}`);
      }
      props[`${label} (plat)`] = { relation: [{ id: platId }] };
      props[`${label} (libre)`] = { rich_text: [] };
    }
  }
  await notion.pages.update({ page_id: id, properties: props });
  return (await lireMenu()).find((m) => m.id === id);
}

/* Suppression = archivage (corbeille Notion, restaurable). */
const GENRES = { todo: DB.todo, course: DB.course, postit: DB.postit, plat: DB.plats };
async function supprimer(genre, id) {
  if (!GENRES[genre]) return null;
  await notion.pages.update({ page_id: id, archived: true });
  return { genre, id };
}

async function viderCoursesPrises() {
  const pris = (await queryAll(DB.course)).filter((pg) => pChk(pg.properties['Pris']));
  for (const pg of pris) await notion.pages.update({ page_id: pg.id, archived: true });
  return { supprimes: pris.length };
}

/* Pas d'enrôlement d'appareils côté Notion : ces routes n'existent qu'avec SQLite. */
const nonSupporte = () => { throw new Error('Fonction disponible seulement avec SOURCE=sqlite'); };

module.exports = {
  nom: 'notion', notion, DB, queryAll, platsMap,
  pTitle, pText, pSel, pChk, pDate, pStatus,
  tout, lireCourses, lireTaches, lirePostits, lireMenu, lirePlannings, lirePersonnes,
  ajouterCourse, cocherCourse, ajouterTache, cocherTache, ajouterPostit,
  definirMenu, supprimer, viderCoursesPrises,
  enrolerAppareil: nonSupporte, appareil: () => null,
  /* Notion n'a pas de table `reglages` : le serveur retombe sur les valeurs par
     défaut et sur le `.env`. Des talons plutôt qu'un plantage — `SOURCE=notion`
     n'est plus qu'un filet de secours, il doit démarrer même diminué. */
  lireReglages: () => ({}),
  reglage: (_cle, defaut) => defaut,
  ecrireReglages: nonSupporte,
  poserReglagesSiAbsents: () => [],
  /* Idem pour tout ce qui est arrivé après la bascule : des talons plutôt qu'un
     plantage. `SOURCE=notion` doit démarrer, même diminué. */
  journaliser: (n, s, m) => console.error(`[${s}] ${m}`),
  lireJournal: () => [], viderJournal: () => ({ retires: 0 }),
  marquerJournalVu: () => {}, journalNonVu: () => 0,
  lireAnniversaires: () => [], anniversairesDans: () => [], ageAtteint: () => null,
  enregistrerAnniversaire: nonSupporte, supprimerAnniversaire: nonSupporte,
  articlesHabituels: () => [], tachesAEcheance: () => [],
};

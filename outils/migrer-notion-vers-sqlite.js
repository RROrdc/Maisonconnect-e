/* Migration Notion -> SQLite.
   Usage :  node outils/migrer-notion-vers-sqlite.js  [--vraiment]
   Sans --vraiment : SIMULATION, on lit Notion et on affiche ce qui serait écrit. Rien n'est modifié.

   Deux garanties :
   1. Notion est ouvert en LECTURE SEULE. Aucune écriture, aucun archivage — l'espace Notion
      reste intact, consultable, et récupérable si la bascule tourne mal.
   2. Le script est REJOUABLE : chaque ligne garde `origine_notion` (l'id de la page Notion),
      contrainte UNIQUE. Relancer met à jour au lieu de dupliquer.

   Les éléments déjà archivés dans Notion (corbeille) ne remontent pas : `databases.query`
   ne les renvoie pas. C'est voulu — on ne réimporte pas les courses déjà retirées. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });   // et non le répertoire courant

const VRAIMENT = process.argv.includes('--vraiment');
process.env.SOURCE = 'notion';
const src = require(path.join(__dirname, '..', 'donnees', 'notion'));
const dst = require(path.join(__dirname, '..', 'donnees', 'sqlite'));

const compte = {};
const marque = (quoi, n = 1) => { compte[quoi] = (compte[quoi] || 0) + n; };

async function main() {
  if (!process.env.NOTION_TOKEN) {
    console.error('✗ NOTION_TOKEN manquant : lance la migration depuis C:\\temp\\maison (le .env y est).');
    process.exit(1);
  }
  console.log(VRAIMENT ? '\n=== MIGRATION RÉELLE ===\n' : '\n=== SIMULATION (ajoute --vraiment pour écrire) ===\n');

  const db = VRAIMENT ? dst.ouvrir() : null;
  const run = (sql, ...p) => (VRAIMENT ? db.prepare(sql).run(...p) : { lastInsertRowid: 0, changes: 0 });
  const get = (sql, ...p) => (VRAIMENT ? db.prepare(sql).get(...p) : undefined);

  /* --- 1. Bibliothèque de plats (d'abord : le menu s'y réfère) --- */
  const platsNotion = await src.platsMap();                 // { idNotion: nom }
  const idParNotion = {};
  for (const [idN, nom] of Object.entries(platsNotion)) {
    if (!nom) continue;
    run(`INSERT INTO plats (nom, origine_notion) VALUES (?, ?)
         ON CONFLICT(origine_notion) DO UPDATE SET nom = excluded.nom, maj_le = datetime('now')`, nom, idN);
    const l = get(`SELECT id FROM plats WHERE origine_notion = ?`, idN);
    if (l) idParNotion[idN] = l.id;
    marque('plats');
  }

  /* --- 2. Courses --- */
  for (const c of await src.lireCourses()) {
    run(`INSERT INTO courses (article, rayon, pris, ajoute_par, origine_notion) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(origine_notion) DO UPDATE SET article = excluded.article, rayon = excluded.rayon,
           pris = excluded.pris, ajoute_par = excluded.ajoute_par, maj_le = datetime('now'), supprime_le = NULL`,
      c.article, c.rayon || null, c.pris ? 1 : 0, c.who || null, c.id);
    marque('courses');
  }

  /* --- 3. Tâches --- */
  for (const t of await src.lireTaches()) {
    run(`INSERT INTO taches (titre, assigne_a, echeance, fait, origine_notion) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(origine_notion) DO UPDATE SET titre = excluded.titre, assigne_a = excluded.assigne_a,
           echeance = excluded.echeance, fait = excluded.fait, maj_le = datetime('now'), supprime_le = NULL`,
      t.tache, t.who || null, t.due || null, t.done ? 1 : 0, t.id);
    marque('tâches');
  }

  /* --- 4. Post-it --- */
  for (const p of await src.lirePostits()) {
    run(`INSERT INTO postits (message, auteur, epingle, origine_notion) VALUES (?, ?, ?, ?)
         ON CONFLICT(origine_notion) DO UPDATE SET message = excluded.message, auteur = excluded.auteur,
           epingle = excluded.epingle, maj_le = datetime('now'), supprime_le = NULL`,
      p.message, p.who || null, p.pin ? 1 : 0, p.id);
    marque('post-it');
  }

  /* --- 5. Menu ---
     La lecture Notion aplatit déjà « plat » et « libre » en une seule chaîne. On refait le tri :
     si le texte correspond à un plat de la bibliothèque, on pose la référence ; sinon texte libre. */
  const platParNom = {};
  for (const [idN, nom] of Object.entries(platsNotion)) if (nom) platParNom[nom.trim().toLowerCase()] = idParNotion[idN];
  const champ = (valeur) => {
    const v = (valeur || '').trim();
    if (!v) return [null, null];
    const pid = platParNom[v.toLowerCase()];
    return pid ? [pid, null] : [null, v];
  };
  for (const m of await src.lireMenu()) {
    const [mp, ml] = champ(m.midi), [sp, sl] = champ(m.soir);
    run(`INSERT INTO menu (jour, date, midi_plat, midi_libre, soir_plat, soir_libre, origine_notion)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(origine_notion) DO UPDATE SET jour = excluded.jour, date = excluded.date,
           midi_plat = excluded.midi_plat, midi_libre = excluded.midi_libre,
           soir_plat = excluded.soir_plat, soir_libre = excluded.soir_libre, maj_le = datetime('now')`,
      m.jour, m.date || null, mp, ml, sp, sl, m.id);
    marque('jours de menu');
  }

  /* --- 6. Plannings enfants ---
     La lecture Notion regroupe par personne ; on remet à plat. Pas d'`origine_notion` disponible
     à ce niveau : on vide la table avant de réécrire (elle est petite et n'a pas d'historique). */
  const pl = await src.lirePlannings();
  if (pl.personnes.length) {
    run(`DELETE FROM planning`);
    for (const p of pl.personnes) {
      for (const [jour, creneaux] of Object.entries(p.semaine)) {
        for (const c of creneaux) {
          run(`INSERT INTO planning (personne, jour, debut, fin, activite, lieu, type) VALUES (?,?,?,?,?,?,?)`,
            p.nom, jour, c.h || null, c.fin || null, c.quoi, c.ou || null, c.type || null);
          marque('créneaux de planning');
        }
      }
      run(`INSERT INTO personnes (nom, couleur) VALUES (?, ?) ON CONFLICT(nom) DO UPDATE SET couleur = excluded.couleur`,
        p.nom, p.couleur);
    }
  }

  /* --- 7. Personnes (la liste FAMILY était codée en dur dans le front) --- */
  const { COULEURS_FAMILLE } = require(path.join(__dirname, '..', 'donnees', 'commun'));
  const FAMILLE = [['Rémi', 1], ['Amandine', 1], ['Enora', 1], ['Martial', 1], ['Garçons', 1], ['Toute la famille', 0]];
  FAMILLE.forEach(([nom, foyer], i) => {
    run(`INSERT INTO personnes (nom, ordre, foyer, couleur) VALUES (?, ?, ?, ?)
         ON CONFLICT(nom) DO UPDATE SET ordre = excluded.ordre, foyer = excluded.foyer,
           couleur = COALESCE(excluded.couleur, personnes.couleur)`,
      nom, i, foyer, COULEURS_FAMILLE[nom] || null);
    marque('personnes');
  });

  console.log('Résumé :');
  for (const [quoi, n] of Object.entries(compte)) console.log(`  ${String(n).padStart(4)}  ${quoi}`);
  if (VRAIMENT) {
    console.log(`\n✓ Écrit dans ${dst.fichier}`);
    console.log('  Notion n\'a pas été modifié. Bascule : mets SOURCE=sqlite dans .env, puis relance le serveur.');
  } else {
    console.log('\n(simulation — rien n\'a été écrit ; relance avec --vraiment)');
  }
}

main().catch((e) => { console.error('✗ Migration interrompue :', e.message); process.exit(1); });

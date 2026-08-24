/* Mise à niveau du schéma — idempotente.

   `schema.sql` sait créer une base NEUVE ; il ne sait pas faire évoluer une base
   qui contient déjà les données de la famille. Ce fichier comble ce manque : il lit
   ce qui existe (`PRAGMA table_info`) et n'ajoute que ce qui manque.

   Deux conséquences voulues :
   - rejouable à l'infini, sans numéro de version à tenir à jour ;
   - une base venue d'une autre machine (le Mac mini, demain) se met à niveau toute
     seule au premier démarrage, sans étape manuelle à ne pas oublier.

   ⚠️ SQLite refuse un DEFAULT non constant dans `ALTER TABLE ADD COLUMN`
   (`datetime('now')` est rejeté). Toutes les colonnes ajoutées ici sont donc
   nullables ou à défaut constant — la valeur est posée à l'écriture, pas au schéma. */

/* Colonnes attendues, par table. On ne décrit QUE les ajouts postérieurs à
   `schema.sql` : le reste est déjà créé par lui. */
const COLONNES = {
  personnes: {
    role: 'TEXT', email: 'TEXT', telephone: 'TEXT',
    code_hash: 'TEXT', code_sel: 'TEXT',
    admin: 'INTEGER NOT NULL DEFAULT 0',
    naissance: 'TEXT', etablissement: 'TEXT', classe: 'TEXT',
    notif: 'INTEGER NOT NULL DEFAULT 1',
    cree_le: 'TEXT', maj_le: 'TEXT',
  },
  planning: {
    categorie: 'TEXT', prof: 'TEXT', salle: 'TEXT',
    quinzaine: 'TEXT',                      // semaine A / B des collèges
    couleur: 'TEXT',
    valide_du: 'TEXT', valide_au: 'TEXT',
    supprime_le: 'TEXT',
  },
  plats: {
    ingredients: 'TEXT',
    etapes: 'TEXT',                          // une étape par ligne (relisible dans un champ texte)
    portions: 'TEXT',                        // ce que le site annonce, tel quel
    duree: 'TEXT', source_url: 'TEXT', appareils: 'TEXT',
    portions_nb: 'INTEGER',                  // déduit de `portions` à l'enregistrement
  },
  menu: {
    midi_couverts: 'INTEGER', soir_couverts: 'INTEGER',   // NULL = réglage `couverts_defaut`
  },
  notifications: {
    /* Trouvé par le test, pas par la relecture : la corbeille commune écrit `maj_le`
       sur toutes les tables. Convention retenue depuis :
       toute table de contenu porte `supprime_le` ET `maj_le`. */
    maj_le: 'TEXT',
  },
};

/* Tables apparues après `schema.sql`. Créées telles quelles si elles manquent. */
const TABLES = {
  /* Journal technique. Jusqu'ici, un calendrier iCloud injoignable ou un flux RSS
     mort n'existait QUE dans la console du serveur : sur un mur, on voyait
     seulement « agenda vide » et on croyait à une absence de rendez-vous.
     `cle` sert à ne pas réécrire cent fois la même panne : on incrémente. */
  journal: `CREATE TABLE journal (
     id       INTEGER PRIMARY KEY,
     niveau   TEXT NOT NULL DEFAULT 'erreur',   -- 'info' | 'alerte' | 'erreur'
     source   TEXT NOT NULL,                    -- 'agenda' | 'meteo' | 'actus' | 'ia' | 'rappels'…
     message  TEXT NOT NULL,
     detail   TEXT,
     cle      TEXT,                             -- regroupe les occurrences identiques
     nb       INTEGER NOT NULL DEFAULT 1,
     cree_le  TEXT NOT NULL DEFAULT (datetime('now')),
     vu_le    TEXT
   )`,

  /* Anniversaires des personnes qui ne sont PAS du foyer (grands-parents,
     cousins, amis). Ceux du foyer vivent dans `personnes.naissance` — une seule
     source par personne, pas deux qui divergent. */
  anniversaires: `CREATE TABLE anniversaires (
     id          INTEGER PRIMARY KEY,
     nom         TEXT NOT NULL,
     naissance   TEXT NOT NULL,                 -- 'AAAA-MM-JJ', ou '0000-MM-JJ' si l'année est inconnue
     relation    TEXT,                          -- « grand-mère », « cousin »…
     rappel      INTEGER NOT NULL DEFAULT 1,    -- prévenir quelques jours avant
     cree_le     TEXT NOT NULL DEFAULT (datetime('now')),
     maj_le      TEXT NOT NULL DEFAULT (datetime('now')),
     supprime_le TEXT
   )`,

  notifications: `CREATE TABLE notifications (
     id           INTEGER PRIMARY KEY,
     titre        TEXT NOT NULL,
     message      TEXT,
     pour         TEXT,                     -- prénom du destinataire, ou NULL = tout le foyer
     de           TEXT,                     -- émetteur
     niveau       TEXT NOT NULL DEFAULT 'info',   -- 'info' | 'important' | 'urgent'
     cree_le      TEXT NOT NULL DEFAULT (datetime('now')),
     lu_le        TEXT,
     supprime_le  TEXT,
     maj_le       TEXT
   )`,
  abonnements_push: `CREATE TABLE abonnements_push (
     id        INTEGER PRIMARY KEY,
     personne  TEXT NOT NULL,
     endpoint  TEXT NOT NULL UNIQUE,
     p256dh    TEXT,
     auth      TEXT,
     cree_le   TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  sessions: `CREATE TABLE sessions (
     jeton     TEXT PRIMARY KEY,
     personne  TEXT NOT NULL,
     cree_le   TEXT NOT NULL DEFAULT (datetime('now')),
     expire_le TEXT NOT NULL
   )`,
  reglages: `CREATE TABLE reglages (
     cle    TEXT PRIMARY KEY,
     valeur TEXT
   )`,
};

const INDEX = {
  i_notif_vivantes: `CREATE INDEX i_notif_vivantes ON notifications(cree_le) WHERE supprime_le IS NULL`,
  i_journal_recent: `CREATE INDEX i_journal_recent ON journal(cree_le DESC)`,
  i_journal_cle: `CREATE UNIQUE INDEX i_journal_cle ON journal(cle) WHERE cle IS NOT NULL`,
};

/* Réglages posés une seule fois, à la création. On n'écrase JAMAIS une valeur
   existante : le back-office est la source de vérité une fois la clé créée. */
const REGLAGES_INITIAUX = {
  planning_exemple: '0',
  couverts_defaut: '4',
  quinzaine_paire: '0',
  /* Rappels quotidiens : heure de passage, et combien de jours avant un
     anniversaire on prévient (pour avoir le temps d'acheter le cadeau). */
  rappels_heure: '8',
  rappels_anniversaire_jours: '7',
};

function tables(db) {
  return new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name));
}
function colonnes(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
}

function migrer(db) {
  const faits = [];
  const presentes = tables(db);

  for (const [nom, sql] of Object.entries(TABLES)) {
    if (presentes.has(nom)) continue;
    db.exec(sql);
    presentes.add(nom);
    faits.push('table ' + nom);
  }

  for (const [table, champs] of Object.entries(COLONNES)) {
    if (!presentes.has(table)) continue;          // table absente : rien à compléter
    const dejaLa = colonnes(db, table);
    for (const [champ, type] of Object.entries(champs)) {
      if (dejaLa.has(champ)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${champ} ${type}`);
      faits.push(`${table}.${champ}`);
    }
  }

  const idx = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all().map((r) => r.name));
  for (const [nom, sql] of Object.entries(INDEX)) {
    if (idx.has(nom)) continue;
    try { db.exec(sql); faits.push('index ' + nom); } catch (_) { /* table absente : sans gravité */ }
  }

  if (presentes.has('reglages')) {
    const poser = db.prepare(`INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO NOTHING`);
    for (const [cle, valeur] of Object.entries(REGLAGES_INITIAUX)) poser.run(cle, valeur);
  }

  if (faits.length) console.log('↗ Schéma mis à niveau : ' + faits.join(', '));
  return faits;
}

module.exports = { migrer };

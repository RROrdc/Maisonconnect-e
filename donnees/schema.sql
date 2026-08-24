-- Écran Maison — schéma SQLite (remplace Notion).
-- Choix structurants, valables pour toutes les tables :
--   * `supprime_le` = suppression DOUCE. Rien n'est effacé : on reproduit la corbeille de Notion,
--     qui nous a déjà sauvés une fois (cf. « Leçons » dans CLAUDE.md). Les lectures filtrent dessus.
--   * `maj_le` = date de dernière modification. Indispensable pour la synchro temps réel
--     et pour départager deux clients qui modifient la même ligne.
--   * `origine_notion` = identifiant de la page Notion d'origine, UNIQUE : rend l'import
--     REJOUABLE sans créer de doublons. Vide pour tout ce qui est créé après la bascule.
--   * Les personnes sont référencées par leur PRÉNOM (texte), pas par une clé étrangère :
--     c'est ce que faisait Notion, ça garde l'import simple et ça reste lisible dans la base.

PRAGMA journal_mode = WAL;      -- lectures concurrentes pendant qu'on écrit (écran + téléphones)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS personnes (
  id       INTEGER PRIMARY KEY,
  nom      TEXT NOT NULL UNIQUE,
  couleur  TEXT,
  ordre    INTEGER NOT NULL DEFAULT 0,   -- ordre d'affichage (pastilles, listes déroulantes)
  foyer    INTEGER NOT NULL DEFAULT 1,   -- 0 = valeur collective (« Toute la famille »)
  actif    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plats (
  id             INTEGER PRIMARY KEY,
  nom            TEXT NOT NULL,
  type           TEXT,
  categorie      TEXT,
  emoji          TEXT,                   -- prévu pour § 5 bis « du visuel sur les repas »
  photo          TEXT,
  origine_notion TEXT UNIQUE,
  cree_le        TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le         TEXT NOT NULL DEFAULT (datetime('now')),
  supprime_le    TEXT
);
CREATE INDEX IF NOT EXISTS i_plats_nom ON plats(nom) WHERE supprime_le IS NULL;

CREATE TABLE IF NOT EXISTS courses (
  id             INTEGER PRIMARY KEY,
  article        TEXT NOT NULL,
  rayon          TEXT,
  pris           INTEGER NOT NULL DEFAULT 0,
  ajoute_par     TEXT,
  origine_notion TEXT UNIQUE,
  cree_le        TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le         TEXT NOT NULL DEFAULT (datetime('now')),
  supprime_le    TEXT
);
CREATE INDEX IF NOT EXISTS i_courses_vivantes ON courses(pris) WHERE supprime_le IS NULL;

CREATE TABLE IF NOT EXISTS taches (
  id             INTEGER PRIMARY KEY,
  titre          TEXT NOT NULL,
  assigne_a      TEXT,
  echeance       TEXT,                   -- 'AAAA-MM-JJ' (comparable en texte, comme dans le front)
  fait           INTEGER NOT NULL DEFAULT 0,
  priorite       TEXT,
  origine_notion TEXT UNIQUE,
  cree_le        TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le         TEXT NOT NULL DEFAULT (datetime('now')),
  supprime_le    TEXT
);
CREATE INDEX IF NOT EXISTS i_taches_vivantes ON taches(fait, echeance) WHERE supprime_le IS NULL;

CREATE TABLE IF NOT EXISTS postits (
  id             INTEGER PRIMARY KEY,
  message        TEXT NOT NULL,
  auteur         TEXT,
  epingle        INTEGER NOT NULL DEFAULT 0,
  origine_notion TEXT UNIQUE,
  cree_le        TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le         TEXT NOT NULL DEFAULT (datetime('now')),
  supprime_le    TEXT
);

-- Menu : on garde EXACTEMENT la forme de Notion (7 lignes jour + date, midi et soir,
-- soit un plat de la bibliothèque, soit un texte libre type « Restaurant »).
-- Passer à un menu glissant par date est une évolution à part : on ne change pas
-- le modèle de données et le comportement dans le même mouvement.
CREATE TABLE IF NOT EXISTS menu (
  id             INTEGER PRIMARY KEY,
  jour           TEXT NOT NULL,          -- « Lundi », « Mardi »… (le front teste startsWith('Lun'))
  date           TEXT,
  midi_plat      INTEGER REFERENCES plats(id) ON DELETE SET NULL,
  midi_libre     TEXT,
  soir_plat      INTEGER REFERENCES plats(id) ON DELETE SET NULL,
  soir_libre     TEXT,
  origine_notion TEXT UNIQUE,
  maj_le         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS planning (
  id             INTEGER PRIMARY KEY,
  personne       TEXT NOT NULL,
  jour           TEXT NOT NULL,          -- 'Lun'…'Dim'
  debut          TEXT,
  fin            TEXT,
  activite       TEXT NOT NULL,
  lieu           TEXT,
  type           TEXT,
  actif          INTEGER NOT NULL DEFAULT 1,   -- décocher = masquer sans supprimer (vacances)
  origine_notion TEXT UNIQUE,
  maj_le         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Enrôlement des appareils : « une fois enregistré, on ne redemande plus » (règle de Rémi).
-- Le téléphone garde `jeton`, le serveur en déduit QUI agit. Prévu pour accueillir
-- plus tard une clé d'accès Face ID / Touch ID (passkey) sans changer de table.
CREATE TABLE IF NOT EXISTS appareils (
  id          INTEGER PRIMARY KEY,
  jeton       TEXT NOT NULL UNIQUE,
  personne    TEXT NOT NULL,
  nom         TEXT,                      -- « iPhone d'Amandine », « Écran cuisine »
  passkey     TEXT,                      -- réservé (WebAuthn), NULL aujourd'hui
  cree_le     TEXT NOT NULL DEFAULT (datetime('now')),
  vu_le       TEXT,
  revoque_le  TEXT
);

-- Réglages divers (remplace peu à peu le .env, prépare le back-office du § 5 ter).
CREATE TABLE IF NOT EXISTS reglages (
  cle    TEXT PRIMARY KEY,
  valeur TEXT
);

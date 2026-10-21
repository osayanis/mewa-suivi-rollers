// Schéma de la base SQLite et migrations (PRAGMA user_version).
//
// Version 1 : un seul poste (rollers + mouvements).
// Version 2 : agences, comptes utilisateurs, sessions, maintenance des rollers.
// Version 3 : villes des agences renseignées, agence GS18 Saarlouis.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 3;

// Agences Mewa, créées avec une base neuve et ajoutées aux bases existantes (version 3).
export const DEFAULT_AGENCIES = [
  { code: 'GS18', city: 'Saarlouis' },
  { code: 'GS60', city: 'Binche' },
  { code: 'GS74', city: 'Spay' },
  { code: 'GS75', city: 'Toussieu' },
  { code: 'GS76', city: 'Rémy' },
  { code: 'GS78', city: 'Gémenos' },
];
// Agence à laquelle sont rattachés les rollers d'une base créée avant les agences (un seul poste).
const LEGACY_AGENCY = 'GS75';

const TABLES = `
CREATE TABLE agencies (
  id         INTEGER PRIMARY KEY,
  code       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  city       TEXT,
  created_at TEXT    NOT NULL
);

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  username             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT    NOT NULL,
  role                 TEXT    NOT NULL CHECK (role IN ('admin', 'agent')),
  agency_id            INTEGER REFERENCES agencies(id),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT    NOT NULL,
  last_login_at        TEXT,
  -- Un compte d'agence est obligatoirement rattaché à une agence ; un administrateur n'en a pas.
  CHECK ((role = 'agent' AND agency_id IS NOT NULL) OR (role = 'admin' AND agency_id IS NULL))
);

CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY, -- empreinte SHA-256 du jeton (le jeton lui-même n'est jamais stocké)
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);

CREATE TABLE rollers (
  id                  INTEGER PRIMARY KEY,
  seq                 INTEGER NOT NULL UNIQUE,
  code                TEXT    NOT NULL UNIQUE,
  agency_id           INTEGER NOT NULL REFERENCES agencies(id),
  label               TEXT,
  notes               TEXT,
  status              TEXT    NOT NULL DEFAULT 'on_site' CHECK (status IN ('on_site', 'in_transit', 'maintenance')),
  maintenance_reasons TEXT,   -- ex. "roulettes,plateaux"
  maintenance_since   TEXT,
  last_movement_at    TEXT,   -- dernier départ ou retour
  last_agent          TEXT,
  created_at          TEXT    NOT NULL,
  created_by          TEXT,
  archived_at         TEXT
);

CREATE TABLE movements (
  id           INTEGER PRIMARY KEY,
  roller_id    INTEGER NOT NULL REFERENCES rollers(id),
  agency_id    INTEGER NOT NULL REFERENCES agencies(id),
  kind         TEXT    NOT NULL CHECK (kind IN ('out', 'in', 'maintenance_start', 'maintenance_end')),
  reasons      TEXT,
  agent        TEXT,
  scanned_at   TEXT    NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT
);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_rollers_agency ON rollers(agency_id, status);
CREATE INDEX IF NOT EXISTS idx_movements_roller ON movements(roller_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_movements_scanned ON movements(scanned_at);
CREATE INDEX IF NOT EXISTS idx_movements_agency ON movements(agency_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

// Ajoute les agences manquantes et renseigne les villes encore vides.
// Une ville déjà saisie dans le panneau admin n'est jamais remplacée.
function seedAgencies(db, now) {
  const insert = db.prepare(
    'INSERT INTO agencies (code, city, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM agencies WHERE code = ?)',
  );
  const fillCity = db.prepare(`UPDATE agencies SET city = ? WHERE code = ? AND (city IS NULL OR city = '')`);
  for (const a of DEFAULT_AGENCIES) {
    insert.run(a.code, a.city, now, a.code);
    fillCity.run(a.city, a.code);
  }
}

function tableExists(db, name) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}

// Base de la version 1 : les rollers et leurs mouvements sont rattachés à l'agence GS75 (ancien poste unique).
function migrateFromV1(db, now) {
  db.exec(TABLES.replace(/CREATE TABLE (rollers|movements) \(/g, 'CREATE TABLE $1_v2 ('));
  seedAgencies(db, now);
  const { id: agencyId } = db.prepare('SELECT id FROM agencies WHERE code = ?').get(LEGACY_AGENCY);
  db.prepare(
    `INSERT INTO rollers_v2 (id, seq, code, agency_id, label, notes, status, last_movement_at, last_agent,
                             created_at, created_by, archived_at)
     SELECT id, seq, code, ?, label, notes, status, last_movement_at, last_agent, created_at, created_by, archived_at
     FROM rollers`,
  ).run(agencyId);
  db.prepare(
    `INSERT INTO movements_v2 (id, roller_id, agency_id, kind, agent, scanned_at, cancelled_at, cancelled_by)
     SELECT id, roller_id, ?, direction, agent, scanned_at, cancelled_at, cancelled_by FROM movements`,
  ).run(agencyId);
  db.exec(`
    DROP TABLE movements;
    DROP TABLE rollers;
    ALTER TABLE rollers_v2 RENAME TO rollers;
    ALTER TABLE movements_v2 RENAME TO movements;
  `);
}

function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version >= SCHEMA_VERSION) return;
  const now = new Date().toISOString();
  // Les clés étrangères sont suspendues le temps de reconstruire les tables (procédure SQLite recommandée).
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (version < 2) {
      if (tableExists(db, 'rollers')) migrateFromV1(db, now);
      else db.exec(TABLES);
    }
    seedAgencies(db, now);
    db.exec(INDEXES);
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length) throw new Error(`Migration : ${broken.length} référence(s) invalide(s)`);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

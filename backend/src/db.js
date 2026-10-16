import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { formatCode } from './codes.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rollers (
  id               INTEGER PRIMARY KEY,
  seq              INTEGER NOT NULL UNIQUE,
  code             TEXT    NOT NULL UNIQUE,
  label            TEXT,
  notes            TEXT,
  status           TEXT    NOT NULL DEFAULT 'on_site' CHECK (status IN ('on_site', 'in_transit')),
  last_movement_at TEXT,
  last_agent       TEXT,
  created_at       TEXT    NOT NULL,
  created_by       TEXT,
  archived_at      TEXT
);

CREATE TABLE IF NOT EXISTS movements (
  id           INTEGER PRIMARY KEY,
  roller_id    INTEGER NOT NULL REFERENCES rollers(id),
  direction    TEXT    NOT NULL CHECK (direction IN ('out', 'in')),
  agent        TEXT,
  scanned_at   TEXT    NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_movements_roller ON movements(roller_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_movements_scanned ON movements(scanned_at);
`;

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const nowIso = () => new Date().toISOString();
const secondsBetween = (fromIso, toIso) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000);

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export class Store {
  constructor(db, config) {
    this.db = db;
    this.config = config;
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------- Rollers ----------

  toRoller(row, now = nowIso()) {
    if (!row) return null;
    const sinceSeconds = row.last_movement_at ? secondsBetween(row.last_movement_at, now) : null;
    return {
      id: row.id,
      code: row.code,
      label: row.label ?? '',
      notes: row.notes ?? '',
      status: row.status,
      lastMovementAt: row.last_movement_at ?? null,
      lastAgent: row.last_agent ?? null,
      sinceSeconds,
      overdue: row.status === 'in_transit' && sinceSeconds !== null && sinceSeconds > this.config.overdueDays * 86400,
      createdAt: row.created_at,
      createdBy: row.created_by ?? null,
      archived: Boolean(row.archived_at),
    };
  }

  createRollers({ count = 1, label = '', notes = '' }, agent) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      throw new HttpError(400, 'invalid_count', 'Le nombre de rollers doit être compris entre 1 et 200.');
    }
    const baseLabel = String(label ?? '').trim().slice(0, 80);
    const cleanNotes = String(notes ?? '').trim().slice(0, 500);
    return this.tx(() => {
      const { maxSeq } = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM rollers').get();
      const insert = this.db.prepare(
        `INSERT INTO rollers (seq, code, label, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const created = [];
      const now = nowIso();
      for (let i = 1; i <= n; i++) {
        const seq = Number(maxSeq) + i;
        const code = formatCode(this.config.codePrefix, this.config.codeDigits, seq);
        // Avec un libellé et plusieurs rollers, on numérote : "Roller linge 1", "Roller linge 2"...
        const rowLabel = baseLabel && n > 1 ? `${baseLabel} ${i}` : baseLabel;
        const { lastInsertRowid } = insert.run(seq, code, rowLabel || null, cleanNotes || null, now, agent ?? null);
        created.push(this.getRollerRowById(lastInsertRowid));
      }
      return created.map((r) => this.toRoller(r, now));
    });
  }

  getRollerRowById(id) {
    return this.db.prepare('SELECT * FROM rollers WHERE id = ?').get(id);
  }

  getRollerRow(code) {
    return this.db.prepare('SELECT * FROM rollers WHERE code = ?').get(code);
  }

  requireRoller(code) {
    const row = this.getRollerRow(code);
    if (!row) throw new HttpError(404, 'unknown_code', `Code « ${code} » inconnu. Ce roller n'est pas enregistré.`);
    return row;
  }

  listRollers({ status, q, includeArchived = false } = {}) {
    const where = [];
    const params = [];
    if (!includeArchived) where.push('archived_at IS NULL');
    if (status === 'on_site' || status === 'in_transit') {
      where.push('status = ?');
      params.push(status);
    } else if (status === 'overdue') {
      where.push(`status = 'in_transit' AND last_movement_at < ?`);
      params.push(new Date(Date.now() - this.config.overdueDays * 86400_000).toISOString());
    }
    if (q) {
      where.push('(code LIKE ? OR label LIKE ? OR notes LIKE ?)');
      const like = `%${String(q).trim()}%`;
      params.push(like, like, like);
    }
    const sql = `SELECT * FROM rollers ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY CASE status WHEN 'in_transit' THEN 0 ELSE 1 END, last_movement_at ASC, seq ASC`;
    const now = nowIso();
    return this.db.prepare(sql).all(...params).map((r) => this.toRoller(r, now));
  }

  updateRoller(code, { label, notes }) {
    const row = this.requireRoller(code);
    const nextLabel = label === undefined ? row.label : String(label).trim().slice(0, 80) || null;
    const nextNotes = notes === undefined ? row.notes : String(notes).trim().slice(0, 500) || null;
    this.db.prepare('UPDATE rollers SET label = ?, notes = ? WHERE id = ?').run(nextLabel, nextNotes, row.id);
    return this.toRoller(this.getRollerRowById(row.id));
  }

  setArchived(code, archived) {
    const row = this.requireRoller(code);
    this.db.prepare('UPDATE rollers SET archived_at = ? WHERE id = ?').run(archived ? nowIso() : null, row.id);
    return this.toRoller(this.getRollerRowById(row.id));
  }

  stats() {
    const overdueBefore = new Date(Date.now() - this.config.overdueDays * 86400_000).toISOString();
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(status = 'on_site'), 0) AS onSite,
                COALESCE(SUM(status = 'in_transit'), 0) AS inTransit,
                COALESCE(SUM(status = 'in_transit' AND last_movement_at < ?), 0) AS overdue
         FROM rollers WHERE archived_at IS NULL`,
      )
      .get(overdueBefore);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const moves = this.db
      .prepare(
        `SELECT COALESCE(SUM(direction = 'out'), 0) AS outToday, COALESCE(SUM(direction = 'in'), 0) AS inToday
         FROM movements WHERE cancelled_at IS NULL AND scanned_at >= ?`,
      )
      .get(today.toISOString());
    return {
      total: Number(row.total),
      onSite: Number(row.onSite),
      inTransit: Number(row.inTransit),
      overdue: Number(row.overdue),
      outToday: Number(moves.outToday),
      inToday: Number(moves.inToday),
      overdueDays: this.config.overdueDays,
    };
  }

  // ---------- Scans / mouvements ----------

  // Un seul mode : le statut du roller décide du sens (sur site → départ, en transit → retour).
  scan({ code }, agent) {
    if (!code) throw new HttpError(400, 'missing_code', 'Aucun code scanné.');

    return this.tx(() => {
      const row = this.requireRoller(code);
      if (row.archived_at) {
        throw new HttpError(409, 'archived', `Le roller ${row.code} est archivé. Réactivez-le avant de le scanner.`);
      }
      const now = nowIso();
      const elapsed = row.last_movement_at ? secondsBetween(row.last_movement_at, now) : null;

      if (elapsed !== null && elapsed < this.config.duplicateWindowSeconds) {
        return {
          result: 'duplicate',
          message: `${row.code} vient déjà d'être scanné il y a ${elapsed} s — scan ignoré.`,
          roller: this.toRoller(row, now),
        };
      }

      const direction = row.status === 'on_site' ? 'out' : 'in';

      const { lastInsertRowid } = this.db
        .prepare(`INSERT INTO movements (roller_id, direction, agent, scanned_at) VALUES (?, ?, ?, ?)`)
        .run(row.id, direction, agent ?? null, now);

      this.db
        .prepare(
          `UPDATE rollers SET status = ?, last_movement_at = ?, last_agent = ? WHERE id = ?`,
        )
        .run(direction === 'out' ? 'in_transit' : 'on_site', now, agent ?? null, row.id);

      return {
        result: direction,
        // Date et heure du départ (pour un retour : celle du départ précédent).
        departedAt: direction === 'in' ? row.last_movement_at : now,
        movement: this.toMovement(this.getMovementRow(lastInsertRowid)),
        roller: this.toRoller(this.getRollerRowById(row.id), now),
      };
    });
  }

  getMovementRow(id) {
    return this.db
      .prepare(`SELECT m.*, r.code, r.label FROM movements m JOIN rollers r ON r.id = m.roller_id WHERE m.id = ?`)
      .get(id);
  }

  toMovement(row) {
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      label: row.label ?? '',
      direction: row.direction,
      agent: row.agent ?? null,
      scannedAt: row.scanned_at,
      cancelled: Boolean(row.cancelled_at),
      cancelledAt: row.cancelled_at ?? null,
      cancelledBy: row.cancelled_by ?? null,
    };
  }

  listMovements({ code, limit = 100, before, from, to, includeCancelled = true } = {}) {
    const where = [];
    const params = [];
    if (code) {
      where.push('r.code = ?');
      params.push(code);
    }
    if (before) {
      where.push('m.id < ?');
      params.push(Number(before));
    }
    if (from) {
      where.push('m.scanned_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('m.scanned_at < ?');
      params.push(to);
    }
    if (!includeCancelled) where.push('m.cancelled_at IS NULL');
    const n = Math.min(Math.max(Number(limit) || 100, 1), 5000);
    const sql = `SELECT m.*, r.code, r.label FROM movements m JOIN rollers r ON r.id = m.roller_id
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...params, n).map((r) => this.toMovement(r));
  }

  // Annule un mouvement (bouton "Annuler" après une erreur de scan).
  // Seul le dernier mouvement actif d'un roller peut être annulé, pour garder un historique cohérent.
  cancelMovement(id, agent) {
    return this.tx(() => {
      const mv = this.getMovementRow(Number(id));
      if (!mv) throw new HttpError(404, 'unknown_movement', 'Mouvement introuvable.');
      if (mv.cancelled_at) throw new HttpError(409, 'already_cancelled', 'Ce mouvement est déjà annulé.');
      const latest = this.db
        .prepare(
          `SELECT id FROM movements WHERE roller_id = ? AND cancelled_at IS NULL ORDER BY scanned_at DESC, id DESC LIMIT 1`,
        )
        .get(mv.roller_id);
      if (latest.id !== mv.id) {
        throw new HttpError(409, 'not_latest', 'Seul le dernier mouvement de ce roller peut être annulé.');
      }
      const now = nowIso();
      this.db.prepare('UPDATE movements SET cancelled_at = ?, cancelled_by = ? WHERE id = ?').run(now, agent ?? null, mv.id);

      // Recalcule l'état du roller à partir du mouvement actif précédent.
      const prev = this.db
        .prepare(
          `SELECT * FROM movements WHERE roller_id = ? AND cancelled_at IS NULL ORDER BY scanned_at DESC, id DESC LIMIT 1`,
        )
        .get(mv.roller_id);
      this.db
        .prepare(
          `UPDATE rollers SET status = ?, last_movement_at = ?, last_agent = ? WHERE id = ?`,
        )
        .run(
          prev ? (prev.direction === 'out' ? 'in_transit' : 'on_site') : 'on_site',
          prev?.scanned_at ?? null,
          prev?.agent ?? null,
          mv.roller_id,
        );
      return {
        movement: this.toMovement(this.getMovementRow(mv.id)),
        roller: this.toRoller(this.getRollerRowById(mv.roller_id), now),
      };
    });
  }
}

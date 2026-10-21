// Rollers et mouvements (départs, retours, maintenances), toujours lus dans le périmètre d'une agence.
//
// `scope.agencyId` : agence de l'utilisateur, ou celle choisie par un administrateur ;
// `null` = toutes les agences (administrateur uniquement).
import { formatCode } from './codes.js';
import { HttpError } from './errors.js';

export { HttpError } from './errors.js';
export { openDatabase } from './schema.js';

// Raisons de mise en maintenance d'un roller (on peut en cocher plusieurs).
export const MAINTENANCE_REASONS = [
  { id: 'paroi', label: 'Paroi' },
  { id: 'roulettes', label: 'Roulettes' },
  { id: 'plateaux', label: 'Plateaux' },
];
const REASON_IDS = MAINTENANCE_REASONS.map((r) => r.id);

// Statut d'un roller après chaque type de mouvement.
const STATUS_AFTER = { out: 'in_transit', in: 'on_site', maintenance_start: 'maintenance', maintenance_end: 'on_site' };

const nowIso = () => new Date().toISOString();
const secondsBetween = (fromIso, toIso) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000);
const splitReasons = (s) => (s ? s.split(',').filter((r) => REASON_IDS.includes(r)) : []);
const agencyName = (code, city) => (city ? `${code} ${city}` : code);

const ROLLER_SELECT = `SELECT r.*, a.code AS agency_code, a.city AS agency_city
                       FROM rollers r JOIN agencies a ON a.id = r.agency_id`;
const MOVEMENT_SELECT = `SELECT m.*, r.code, r.label, a.code AS agency_code, a.city AS agency_city
                         FROM movements m JOIN rollers r ON r.id = m.roller_id JOIN agencies a ON a.id = m.agency_id`;

export function normalizeReasons(input) {
  const list = Array.isArray(input) ? input : [];
  const reasons = REASON_IDS.filter((id) => list.includes(id));
  if (reasons.length === 0) {
    throw new HttpError(400, 'missing_reasons', 'Choisissez au moins une raison de maintenance.');
  }
  return reasons;
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

  overdueBefore() {
    return new Date(Date.now() - this.config.overdueDays * 86400_000).toISOString();
  }

  // ---------- Rollers ----------

  toRoller(row, now = nowIso()) {
    if (!row) return null;
    const sinceSeconds = row.last_movement_at ? secondsBetween(row.last_movement_at, now) : null;
    return {
      id: row.id,
      code: row.code,
      agency: { id: row.agency_id, code: row.agency_code, city: row.agency_city ?? '', name: agencyName(row.agency_code, row.agency_city) },
      label: row.label ?? '',
      notes: row.notes ?? '',
      status: row.status,
      maintenanceReasons: splitReasons(row.maintenance_reasons),
      maintenanceSince: row.maintenance_since ?? null,
      lastMovementAt: row.last_movement_at ?? null,
      lastAgent: row.last_agent ?? null,
      sinceSeconds,
      overdue: row.status === 'in_transit' && sinceSeconds !== null && sinceSeconds > this.config.overdueDays * 86400,
      createdAt: row.created_at,
      createdBy: row.created_by ?? null,
      archived: Boolean(row.archived_at),
    };
  }

  requireAgency(agencyId) {
    const id = Number(agencyId);
    const row = Number.isInteger(id) ? this.db.prepare('SELECT * FROM agencies WHERE id = ?').get(id) : undefined;
    if (!row) throw new HttpError(400, 'unknown_agency', 'Agence inconnue.');
    return row;
  }

  createRollers({ count = 1, label = '', notes = '', agencyId }, agent) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      throw new HttpError(400, 'invalid_count', 'Le nombre de rollers doit être compris entre 1 et 200.');
    }
    const agency = this.requireAgency(agencyId);
    const baseLabel = String(label ?? '').trim().slice(0, 80);
    const cleanNotes = String(notes ?? '').trim().slice(0, 500);
    return this.tx(() => {
      // Numérotation commune à toutes les agences : un code-barres est unique dans tout Mewa.
      const { maxSeq } = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM rollers').get();
      const insert = this.db.prepare(
        `INSERT INTO rollers (seq, code, agency_id, label, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const created = [];
      const now = nowIso();
      for (let i = 1; i <= n; i++) {
        const seq = Number(maxSeq) + i;
        const code = formatCode(this.config.codePrefix, this.config.codeDigits, seq);
        // Avec un libellé et plusieurs rollers, on numérote : "Roller linge 1", "Roller linge 2"...
        const rowLabel = baseLabel && n > 1 ? `${baseLabel} ${i}` : baseLabel;
        const { lastInsertRowid } = insert.run(seq, code, agency.id, rowLabel || null, cleanNotes || null, now, agent ?? null);
        created.push(this.getRollerRowById(lastInsertRowid));
      }
      return created.map((r) => this.toRoller(r, now));
    });
  }

  getRollerRowById(id) {
    return this.db.prepare(`${ROLLER_SELECT} WHERE r.id = ?`).get(id);
  }

  /** Roller du périmètre `scope` ; un roller d'une autre agence est signalé comme tel. */
  requireRoller(code, scope) {
    const row = this.db.prepare(`${ROLLER_SELECT} WHERE r.code = ?`).get(code);
    if (!row) throw new HttpError(404, 'unknown_code', `Code « ${code} » inconnu. Ce roller n'est pas enregistré.`);
    if (scope.agencyId !== null && row.agency_id !== scope.agencyId) {
      throw new HttpError(
        403,
        'other_agency',
        `Le roller ${row.code} appartient à l'agence ${agencyName(row.agency_code, row.agency_city)}.`,
      );
    }
    return row;
  }

  listRollers(scope, { status, q, includeArchived = false } = {}) {
    const where = [];
    const params = [];
    if (scope.agencyId !== null) {
      where.push('r.agency_id = ?');
      params.push(scope.agencyId);
    }
    if (!includeArchived) where.push('r.archived_at IS NULL');
    if (status === 'on_site' || status === 'in_transit' || status === 'maintenance') {
      where.push('r.status = ?');
      params.push(status);
    } else if (status === 'overdue') {
      where.push(`r.status = 'in_transit' AND r.last_movement_at < ?`);
      params.push(this.overdueBefore());
    }
    if (q) {
      where.push('(r.code LIKE ? OR r.label LIKE ? OR r.notes LIKE ?)');
      const like = `%${String(q).trim()}%`;
      params.push(like, like, like);
    }
    const sql = `${ROLLER_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY CASE r.status WHEN 'in_transit' THEN 0 WHEN 'maintenance' THEN 1 ELSE 2 END,
                          r.last_movement_at ASC, r.seq ASC`;
    const now = nowIso();
    return this.db.prepare(sql).all(...params).map((r) => this.toRoller(r, now));
  }

  updateRoller(code, scope, { label, notes, agencyId }) {
    const row = this.requireRoller(code, scope);
    const nextLabel = label === undefined ? row.label : String(label).trim().slice(0, 80) || null;
    const nextNotes = notes === undefined ? row.notes : String(notes).trim().slice(0, 500) || null;
    // Transfert vers une autre agence : réservé aux administrateurs (scope sans agence).
    const nextAgency = agencyId === undefined || scope.agencyId !== null ? row.agency_id : this.requireAgency(agencyId).id;
    this.db
      .prepare('UPDATE rollers SET label = ?, notes = ?, agency_id = ? WHERE id = ?')
      .run(nextLabel, nextNotes, nextAgency, row.id);
    return this.toRoller(this.getRollerRowById(row.id));
  }

  setArchived(code, scope, archived) {
    const row = this.requireRoller(code, scope);
    this.db.prepare('UPDATE rollers SET archived_at = ? WHERE id = ?').run(archived ? nowIso() : null, row.id);
    return this.toRoller(this.getRollerRowById(row.id));
  }

  /** Compteurs d'un périmètre (une agence, ou toutes). */
  stats(scope) {
    const agencyFilter = scope.agencyId === null ? '' : 'AND agency_id = ?';
    const agencyParam = scope.agencyId === null ? [] : [scope.agencyId];
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(status = 'on_site'), 0) AS onSite,
                COALESCE(SUM(status = 'in_transit'), 0) AS inTransit,
                COALESCE(SUM(status = 'maintenance'), 0) AS maintenance,
                COALESCE(SUM(status = 'in_transit' AND last_movement_at < ?), 0) AS overdue
         FROM rollers WHERE archived_at IS NULL ${agencyFilter}`,
      )
      .get(this.overdueBefore(), ...agencyParam);
    const moves = this.db
      .prepare(
        `SELECT COALESCE(SUM(kind = 'out'), 0) AS outToday, COALESCE(SUM(kind = 'in'), 0) AS inToday
         FROM movements WHERE cancelled_at IS NULL AND scanned_at >= ? ${agencyFilter}`,
      )
      .get(this.startOfToday(), ...agencyParam);
    return {
      total: Number(row.total),
      onSite: Number(row.onSite),
      inTransit: Number(row.inTransit),
      maintenance: Number(row.maintenance),
      overdue: Number(row.overdue),
      outToday: Number(moves.outToday),
      inToday: Number(moves.inToday),
      overdueDays: this.config.overdueDays,
    };
  }

  startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.toISOString();
  }

  /** Supervision : compteurs de chaque agence. */
  overview() {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.code, a.city,
                COUNT(r.id) AS total,
                COALESCE(SUM(r.status = 'on_site'), 0) AS onSite,
                COALESCE(SUM(r.status = 'in_transit'), 0) AS inTransit,
                COALESCE(SUM(r.status = 'maintenance'), 0) AS maintenance,
                COALESCE(SUM(r.status = 'in_transit' AND r.last_movement_at < ?), 0) AS overdue
         FROM agencies a LEFT JOIN rollers r ON r.agency_id = a.id AND r.archived_at IS NULL
         GROUP BY a.id ORDER BY a.code`,
      )
      .all(this.overdueBefore());
    const today = this.db
      .prepare(
        `SELECT agency_id, COALESCE(SUM(kind = 'out'), 0) AS outToday, COALESCE(SUM(kind = 'in'), 0) AS inToday
         FROM movements WHERE cancelled_at IS NULL AND scanned_at >= ? GROUP BY agency_id`,
      )
      .all(this.startOfToday());
    const todayByAgency = new Map(today.map((t) => [t.agency_id, t]));
    const agencies = rows.map((a) => ({
      agency: { id: a.id, code: a.code, city: a.city ?? '', name: agencyName(a.code, a.city) },
      total: Number(a.total),
      onSite: Number(a.onSite),
      inTransit: Number(a.inTransit),
      maintenance: Number(a.maintenance),
      overdue: Number(a.overdue),
      outToday: Number(todayByAgency.get(a.id)?.outToday ?? 0),
      inToday: Number(todayByAgency.get(a.id)?.inToday ?? 0),
    }));
    return {
      totals: this.stats({ agencyId: null }),
      agencies,
      activity: this.activity(14),
      overdueRollers: this.listRollers({ agencyId: null }, { status: 'overdue' }).slice(0, 8),
    };
  }

  /** Départs et retours par jour (heure locale du serveur, TZ=Europe/Paris), du plus ancien au plus récent. */
  activity(days) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const dayKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const buckets = new Map();
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      buckets.set(dayKey(d), { date: dayKey(d), out: 0, in: 0 });
    }
    const rows = this.db
      .prepare(
        `SELECT kind, scanned_at FROM movements
         WHERE cancelled_at IS NULL AND kind IN ('out', 'in') AND scanned_at >= ?`,
      )
      .all(start.toISOString());
    for (const row of rows) {
      const bucket = buckets.get(dayKey(new Date(row.scanned_at)));
      if (bucket) bucket[row.kind] += 1;
    }
    return [...buckets.values()];
  }

  // ---------- Scans / mouvements ----------

  insertMovement(row, kind, agent, now, reasons = null) {
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO movements (roller_id, agency_id, kind, reasons, agent, scanned_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.agency_id, kind, reasons, agent ?? null, now);
    return this.toMovement(this.getMovementRow(lastInsertRowid));
  }

  // Un seul mode : le statut du roller décide du sens (sur site → départ, en transit → retour).
  scan({ code, confirm = false }, scope, agent) {
    if (!code) throw new HttpError(400, 'missing_code', 'Aucun code scanné.');

    return this.tx(() => {
      const row = this.requireRoller(code, scope);
      if (row.archived_at) {
        throw new HttpError(409, 'archived', `Le roller ${row.code} est archivé. Réactivez-le avant de le scanner.`);
      }
      const now = nowIso();
      if (row.status === 'maintenance') {
        throw new HttpError(
          409,
          'in_maintenance',
          `Le roller ${row.code} est en maintenance. Remettez-le en service avant de le faire partir.`,
          { roller: this.toRoller(row, now) },
        );
      }
      const elapsed = row.last_movement_at ? secondsBetween(row.last_movement_at, now) : null;

      if (elapsed !== null && elapsed < this.config.duplicateWindowSeconds) {
        return {
          result: 'duplicate',
          message: `${row.code} vient déjà d'être scanné il y a ${elapsed} s — scan ignoré.`,
          roller: this.toRoller(row, now),
        };
      }

      const kind = row.status === 'on_site' ? 'out' : 'in';

      // Rescan rapproché : rien n'est enregistré tant que l'agent n'a pas confirmé.
      if (!confirm && elapsed !== null && elapsed < this.config.rescanConfirmHours * 3600) {
        return {
          result: 'confirm',
          // Dernier scan : un départ si le roller est en transit, un retour s'il est sur site.
          lastScan: { kind: row.status === 'in_transit' ? 'out' : 'in', at: row.last_movement_at },
          next: kind,
          roller: this.toRoller(row, now),
        };
      }

      const movement = this.insertMovement(row, kind, agent, now);
      this.db
        .prepare(`UPDATE rollers SET status = ?, last_movement_at = ?, last_agent = ? WHERE id = ?`)
        .run(STATUS_AFTER[kind], now, agent ?? null, row.id);

      return {
        result: kind,
        // Date et heure du départ (pour un retour : celle du départ précédent).
        departedAt: kind === 'in' ? row.last_movement_at : now,
        movement,
        roller: this.toRoller(this.getRollerRowById(row.id), now),
      };
    });
  }

  /** Met un roller en maintenance, ou change les raisons d'une maintenance en cours. */
  startMaintenance(code, scope, reasonsInput, agent) {
    const reasons = normalizeReasons(reasonsInput).join(',');
    return this.tx(() => {
      const row = this.requireRoller(code, scope);
      if (row.archived_at) throw new HttpError(409, 'archived', `Le roller ${row.code} est archivé.`);
      if (row.status === 'in_transit') {
        throw new HttpError(
          409,
          'in_transit',
          `Le roller ${row.code} est en transit : scannez son retour avant de le mettre en maintenance.`,
        );
      }
      const now = nowIso();
      if (row.status === 'maintenance') {
        const current = this.activeMovementRow(row.id);
        this.db.prepare('UPDATE movements SET reasons = ? WHERE id = ?').run(reasons, current.id);
        this.db.prepare('UPDATE rollers SET maintenance_reasons = ? WHERE id = ?').run(reasons, row.id);
        return { movement: this.toMovement(this.getMovementRow(current.id)), roller: this.toRoller(this.getRollerRowById(row.id), now) };
      }
      const movement = this.insertMovement(row, 'maintenance_start', agent, now, reasons);
      this.db
        .prepare(`UPDATE rollers SET status = 'maintenance', maintenance_reasons = ?, maintenance_since = ? WHERE id = ?`)
        .run(reasons, now, row.id);
      return { movement, roller: this.toRoller(this.getRollerRowById(row.id), now) };
    });
  }

  /** Fin de maintenance : le roller est de nouveau disponible sur site. */
  endMaintenance(code, scope, agent) {
    return this.tx(() => {
      const row = this.requireRoller(code, scope);
      if (row.status !== 'maintenance') {
        throw new HttpError(409, 'not_in_maintenance', `Le roller ${row.code} n'est pas en maintenance.`);
      }
      const now = nowIso();
      const movement = this.insertMovement(row, 'maintenance_end', agent, now);
      this.db
        .prepare(`UPDATE rollers SET status = 'on_site', maintenance_reasons = NULL, maintenance_since = NULL WHERE id = ?`)
        .run(row.id);
      return { movement, roller: this.toRoller(this.getRollerRowById(row.id), now) };
    });
  }

  getMovementRow(id) {
    return this.db.prepare(`${MOVEMENT_SELECT} WHERE m.id = ?`).get(id);
  }

  activeMovementRow(rollerId, kinds) {
    const kindFilter = kinds ? `AND kind IN (${kinds.map(() => '?').join(', ')})` : '';
    return this.db
      .prepare(
        `SELECT * FROM movements WHERE roller_id = ? AND cancelled_at IS NULL ${kindFilter}
         ORDER BY scanned_at DESC, id DESC LIMIT 1`,
      )
      .get(rollerId, ...(kinds ?? []));
  }

  toMovement(row) {
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      label: row.label ?? '',
      agency: { id: row.agency_id, code: row.agency_code, city: row.agency_city ?? '', name: agencyName(row.agency_code, row.agency_city) },
      kind: row.kind,
      reasons: splitReasons(row.reasons),
      agent: row.agent ?? null,
      scannedAt: row.scanned_at,
      cancelled: Boolean(row.cancelled_at),
      cancelledAt: row.cancelled_at ?? null,
      cancelledBy: row.cancelled_by ?? null,
    };
  }

  listMovements(scope, { code, limit = 100, before, from, to, includeCancelled = true } = {}) {
    const where = [];
    const params = [];
    if (scope.agencyId !== null) {
      where.push('m.agency_id = ?');
      params.push(scope.agencyId);
    }
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
      params.push(String(from));
    }
    if (to) {
      where.push('m.scanned_at < ?');
      params.push(String(to));
    }
    if (!includeCancelled) where.push('m.cancelled_at IS NULL');
    const n = Math.min(Math.max(Number(limit) || 100, 1), 5000);
    const sql = `${MOVEMENT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...params, n).map((r) => this.toMovement(r));
  }

  // Annule un mouvement (bouton "Annuler" après une erreur de scan).
  // Seul le dernier mouvement actif d'un roller peut être annulé, pour garder un historique cohérent.
  cancelMovement(id, scope, agent) {
    return this.tx(() => {
      const mv = this.getMovementRow(Number(id));
      if (!mv || (scope.agencyId !== null && mv.agency_id !== scope.agencyId)) {
        throw new HttpError(404, 'unknown_movement', 'Mouvement introuvable.');
      }
      if (mv.cancelled_at) throw new HttpError(409, 'already_cancelled', 'Ce mouvement est déjà annulé.');
      if (this.activeMovementRow(mv.roller_id).id !== mv.id) {
        throw new HttpError(409, 'not_latest', 'Seul le dernier mouvement de ce roller peut être annulé.');
      }
      const now = nowIso();
      this.db.prepare('UPDATE movements SET cancelled_at = ?, cancelled_by = ? WHERE id = ?').run(now, agent ?? null, mv.id);

      // Recalcule l'état du roller à partir des mouvements actifs restants.
      const prev = this.activeMovementRow(mv.roller_id);
      const prevTrip = this.activeMovementRow(mv.roller_id, ['out', 'in']);
      const inMaintenance = prev?.kind === 'maintenance_start';
      this.db
        .prepare(
          `UPDATE rollers SET status = ?, maintenance_reasons = ?, maintenance_since = ?, last_movement_at = ?, last_agent = ?
           WHERE id = ?`,
        )
        .run(
          prev ? STATUS_AFTER[prev.kind] : 'on_site',
          inMaintenance ? prev.reasons : null,
          inMaintenance ? prev.scanned_at : null,
          prevTrip?.scanned_at ?? null,
          prevTrip?.agent ?? null,
          mv.roller_id,
        );
      return {
        movement: this.toMovement(this.getMovementRow(mv.id)),
        roller: this.toRoller(this.getRollerRowById(mv.roller_id), now),
      };
    });
  }
}

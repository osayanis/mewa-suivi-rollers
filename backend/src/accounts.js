// Comptes utilisateurs, agences et sessions de connexion.
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './errors.js';

const scryptAsync = promisify(scrypt);

// Paramètres scrypt (recommandations OWASP) : ~50 ms par vérification.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 8;

const nowIso = () => new Date().toISOString();
const agencyName = (code, city) => (city ? `${code} ${city}` : code);

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, n, r, p, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(key, expected);
}

// Empreinte calculée une fois : sert à garder un temps de réponse identique quand l'identifiant n'existe pas.
let dummyHash;

/** Mot de passe lisible (sans 0/O, 1/l/I) pour le compte administrateur initial. */
export function generatePassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}

const tokenId = (token) => createHash('sha256').update(token).digest('hex');

function cleanUsername(raw) {
  const username = String(raw ?? '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    throw new HttpError(
      400,
      'invalid_username',
      "L'identifiant doit faire de 3 à 40 caractères : lettres sans accent, chiffres, point, tiret ou tiret bas.",
    );
  }
  return username;
}

function checkPassword(raw) {
  const password = typeof raw === 'string' ? raw : '';
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    throw new HttpError(400, 'weak_password', `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  }
  return password;
}

export class Accounts {
  constructor(db, config) {
    this.db = db;
    this.config = config;
  }

  // ---------- Agences ----------

  toAgency(row) {
    return { id: row.id, code: row.code, city: row.city ?? '', name: agencyName(row.code, row.city) };
  }

  listAgencies() {
    return this.db
      .prepare(
        `SELECT a.*,
                (SELECT COUNT(*) FROM rollers r WHERE r.agency_id = a.id AND r.archived_at IS NULL) AS rollers,
                (SELECT COUNT(*) FROM users u WHERE u.agency_id = a.id) AS users
         FROM agencies a ORDER BY a.code`,
      )
      .all()
      .map((row) => ({ ...this.toAgency(row), rollers: Number(row.rollers), users: Number(row.users) }));
  }

  requireAgencyRow(id) {
    const row = this.db.prepare('SELECT * FROM agencies WHERE id = ?').get(Number(id));
    if (!row) throw new HttpError(404, 'unknown_agency', 'Agence introuvable.');
    return row;
  }

  cleanAgencyInput({ code, city }) {
    const cleanCode = String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9-]{2,12}$/.test(cleanCode)) {
      throw new HttpError(400, 'invalid_agency_code', 'Le code agence doit faire de 2 à 12 caractères (ex. GS75).');
    }
    return { code: cleanCode, city: String(city ?? '').trim().slice(0, 60) || null };
  }

  assertAgencyCodeFree(code, exceptId = 0) {
    const row = this.db.prepare('SELECT id FROM agencies WHERE code = ? AND id <> ?').get(code, exceptId);
    if (row) throw new HttpError(409, 'agency_exists', `L'agence ${code} existe déjà.`);
  }

  createAgency(input) {
    const { code, city } = this.cleanAgencyInput(input ?? {});
    this.assertAgencyCodeFree(code);
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO agencies (code, city, created_at) VALUES (?, ?, ?)')
      .run(code, city, nowIso());
    return this.toAgency(this.requireAgencyRow(lastInsertRowid));
  }

  updateAgency(id, input) {
    const row = this.requireAgencyRow(id);
    const { code, city } = this.cleanAgencyInput({ code: input?.code ?? row.code, city: input?.city ?? row.city });
    this.assertAgencyCodeFree(code, row.id);
    this.db.prepare('UPDATE agencies SET code = ?, city = ? WHERE id = ?').run(code, city, row.id);
    return this.toAgency(this.requireAgencyRow(row.id));
  }

  /** Suppression possible uniquement pour une agence vide (ni roller, ni utilisateur, ni historique). */
  deleteAgency(id) {
    const row = this.requireAgencyRow(id);
    const used = this.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM rollers WHERE agency_id = ?) AS rollers,
                (SELECT COUNT(*) FROM users WHERE agency_id = ?) AS users,
                (SELECT COUNT(*) FROM movements WHERE agency_id = ?) AS movements`,
      )
      .get(row.id, row.id, row.id);
    if (used.rollers || used.users || used.movements) {
      throw new HttpError(
        409,
        'agency_not_empty',
        `L'agence ${row.code} a encore des rollers, des utilisateurs ou un historique : elle ne peut pas être supprimée.`,
      );
    }
    this.db.prepare('DELETE FROM agencies WHERE id = ?').run(row.id);
  }

  // ---------- Utilisateurs ----------

  userRow(where, value) {
    return this.db
      .prepare(
        `SELECT u.*, a.code AS agency_code, a.city AS agency_city
         FROM users u LEFT JOIN agencies a ON a.id = u.agency_id WHERE ${where}`,
      )
      .get(value);
  }

  toUser(row) {
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      agency: row.agency_id ? this.toAgency({ id: row.agency_id, code: row.agency_code, city: row.agency_city }) : null,
      mustChangePassword: Boolean(row.must_change_password),
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at ?? null,
    };
  }

  listUsers() {
    return this.db
      .prepare(
        `SELECT u.*, a.code AS agency_code, a.city AS agency_city
         FROM users u LEFT JOIN agencies a ON a.id = u.agency_id
         ORDER BY u.role = 'admin' DESC, a.code, u.username COLLATE NOCASE`,
      )
      .all()
      .map((row) => this.toUser(row));
  }

  requireUserRow(id) {
    const row = this.userRow('u.id = ?', Number(id));
    if (!row) throw new HttpError(404, 'unknown_user', 'Utilisateur introuvable.');
    return row;
  }

  /** Rôle et agence : un compte d'agence doit avoir une agence, un administrateur n'en a pas. */
  cleanRole(role, agencyId) {
    if (role === 'admin') return { role, agencyId: null };
    if (role !== 'agent') throw new HttpError(400, 'invalid_role', 'Rôle inconnu.');
    if (agencyId === null || agencyId === undefined || agencyId === '') {
      throw new HttpError(400, 'agency_required', 'Un compte utilisateur doit être rattaché à une agence.');
    }
    return { role, agencyId: this.requireAgencyRow(agencyId).id };
  }

  countAdmins() {
    return Number(this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get().n);
  }

  async createUser({ username, password, role, agencyId } = {}, { mustChangePassword = false } = {}) {
    const name = cleanUsername(username);
    const pw = checkPassword(password);
    const cleaned = this.cleanRole(role, agencyId);
    if (this.userRow('u.username = ?', name)) {
      throw new HttpError(409, 'username_taken', `L'identifiant « ${name} » est déjà utilisé.`);
    }
    const hash = await hashPassword(pw);
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO users (username, password_hash, role, agency_id, must_change_password, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, hash, cleaned.role, cleaned.agencyId, mustChangePassword ? 1 : 0, nowIso());
    return this.toUser(this.requireUserRow(lastInsertRowid));
  }

  async updateUser(id, { password, role, agencyId } = {}, actingUserId) {
    const row = this.requireUserRow(id);
    const hash = password === undefined ? null : await hashPassword(checkPassword(password));
    const wantsRoleChange = role !== undefined || agencyId !== undefined;
    const cleaned = wantsRoleChange
      ? this.cleanRole(role ?? row.role, agencyId === undefined ? row.agency_id : agencyId)
      : { role: row.role, agencyId: row.agency_id };
    if (row.role === 'admin' && cleaned.role !== 'admin') {
      if (row.id === actingUserId) {
        throw new HttpError(409, 'self_demote', 'Vous ne pouvez pas retirer vos propres droits administrateur.');
      }
      if (this.countAdmins() <= 1) throw new HttpError(409, 'last_admin', 'Il doit rester au moins un administrateur.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE users SET role = ?, agency_id = ? WHERE id = ?').run(cleaned.role, cleaned.agencyId, row.id);
      if (hash) {
        // Le mot de passe a été défini par un administrateur : l'utilisateur pourra le changer depuis son compte.
        // Les sessions ouvertes avec l'ancien mot de passe sont fermées, sauf celle de l'administrateur qui agit sur lui-même.
        this.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, row.id);
        if (row.id !== actingUserId) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
      }
      if (cleaned.role !== row.role || cleaned.agencyId !== row.agency_id) {
        // Les droits changent : l'utilisateur doit se reconnecter.
        if (row.id !== actingUserId) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.toUser(this.requireUserRow(row.id));
  }

  deleteUser(id, actingUserId) {
    const row = this.requireUserRow(id);
    if (row.id === actingUserId) throw new HttpError(409, 'self_delete', 'Vous ne pouvez pas supprimer votre propre compte.');
    if (row.role === 'admin' && this.countAdmins() <= 1) {
      throw new HttpError(409, 'last_admin', 'Il doit rester au moins un administrateur.');
    }
    this.db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
  }

  async changeOwnPassword(userId, currentPassword, newPassword) {
    const row = this.requireUserRow(userId);
    if (!(await verifyPassword(String(currentPassword ?? ''), row.password_hash))) {
      throw new HttpError(400, 'wrong_password', 'Mot de passe actuel incorrect.');
    }
    const pw = checkPassword(newPassword);
    if (pw === currentPassword) {
      throw new HttpError(400, 'same_password', "Le nouveau mot de passe doit être différent de l'ancien.");
    }
    const hash = await hashPassword(pw);
    this.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, row.id);
    return this.toUser(this.requireUserRow(row.id));
  }

  /** Vérifie l'identifiant et le mot de passe. Retourne l'utilisateur, ou null. */
  async authenticate(username, password) {
    const row = typeof username === 'string' && username.trim() ? this.userRow('u.username = ?', username.trim()) : undefined;
    const pw = typeof password === 'string' ? password : '';
    if (!row) {
      dummyHash ??= await hashPassword(generatePassword());
      await verifyPassword(pw, dummyHash);
      return null;
    }
    if (!(await verifyPassword(pw, row.password_hash))) return null;
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
    return this.toUser(this.requireUserRow(row.id));
  }

  // ---------- Sessions ----------

  sessionMs() {
    return this.config.sessionDays * 86400_000;
  }

  createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date(now).toISOString());
    this.db
      .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenId(token), userId, new Date(now).toISOString(), new Date(now + this.sessionMs()).toISOString());
    return token;
  }

  /** Utilisateur connecté avec ce jeton. La session est prolongée tant qu'elle sert (inactivité max : SESSION_DAYS). */
  userForSession(token) {
    if (!token) return null;
    const id = tokenId(token);
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    if (!session) return null;
    const now = Date.now();
    if (Date.parse(session.expires_at) <= now) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return null;
    }
    // Prolongation au plus une fois par heure, pour éviter une écriture à chaque requête.
    if (Date.parse(session.expires_at) - now < this.sessionMs() - 3600_000) {
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(new Date(now + this.sessionMs()).toISOString(), id);
    }
    const row = this.userRow('u.id = ?', session.user_id);
    return row ? this.toUser(row) : null;
  }

  deleteSession(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE id = ?').run(tokenId(token));
  }

  /**
   * Premier démarrage : crée le compte administrateur s'il n'en existe aucun.
   * Sans ADMIN_PASSWORD, un mot de passe provisoire est généré ; il devra être changé à la première connexion.
   * Retourne { username, password, generated } si un compte a été créé.
   */
  async ensureAdmin() {
    if (this.countAdmins() > 0) return null;
    const generated = !this.config.adminPassword;
    const password = this.config.adminPassword || generatePassword();
    let username = this.config.adminUsername;
    // Identifiant déjà pris par un compte d'agence : on en choisit un autre plutôt que d'échouer.
    for (let i = 2; this.userRow('u.username = ?', username); i++) username = `${this.config.adminUsername}${i}`;
    await this.createUser({ username, password, role: 'admin' }, { mustChangePassword: generated });
    return { username, password, generated };
  }
}

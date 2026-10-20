// Connexion par identifiant + mot de passe, session dans un cookie HttpOnly.
import { HttpError } from './errors.js';

export const SESSION_COOKIE = 'mrt_session';

// Au-delà de MAX_FAILURES échecs de connexion en FAILURE_WINDOW_MS, les essais sont bloqués temporairement.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

// En-tête exigé sur les requêtes qui modifient des données : un autre site ne peut pas l'ajouter
// sans autorisation CORS (protection contre les requêtes forgées, en plus du cookie SameSite=Strict).
export const CSRF_HEADER = 'x-requested-with';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function readSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return '';
}

export function setSessionCookie(req, res, token, maxAgeSeconds) {
  const attrs = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (req.secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(req, res) {
  setSessionCookie(req, res, '', 0);
}

export function createLoginLimiter() {
  const failures = new Map(); // clé (adresse IP + identifiant) -> { count, since }
  const entryFor = (key) => {
    const entry = failures.get(key);
    if (entry && Date.now() - entry.since > FAILURE_WINDOW_MS) {
      failures.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    check(key) {
      if ((entryFor(key)?.count ?? 0) >= MAX_FAILURES) {
        throw new HttpError(429, 'too_many_attempts', 'Trop de tentatives de connexion. Réessayez dans quelques minutes.');
      }
    },
    fail(key) {
      const entry = entryFor(key);
      failures.set(key, { count: (entry?.count ?? 0) + 1, since: entry?.since ?? Date.now() });
    },
    reset(key) {
      failures.delete(key);
    },
  };
}

export function requireCsrfHeader(req, _res, next) {
  if (MUTATING.has(req.method) && !req.get(CSRF_HEADER)) {
    return next(new HttpError(403, 'csrf', 'Requête refusée.'));
  }
  next();
}

/**
 * Identifie l'utilisateur à partir du cookie de session et fixe son périmètre :
 * - compte d'agence : sa propre agence, toujours ;
 * - administrateur : toutes les agences, ou celle demandée par le paramètre `?agency=`.
 */
export function createAuthenticate(accounts) {
  return (req, _res, next) => {
    const user = accounts.userForSession(readSessionToken(req));
    if (!user) return next(new HttpError(401, 'auth_required', 'Session expirée. Reconnectez-vous.'));
    if (user.mustChangePassword) {
      return next(new HttpError(403, 'password_change_required', 'Changez votre mot de passe provisoire pour continuer.'));
    }
    req.user = user;
    if (user.role === 'admin') {
      const agency = Number.parseInt(String(req.query.agency ?? ''), 10);
      req.scope = { agencyId: Number.isInteger(agency) ? agency : null };
    } else {
      req.scope = { agencyId: user.agency.id };
    }
    next();
  };
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'admin_only', 'Réservé aux administrateurs.'));
  next();
}

import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './db.js';

// Au-delà de MAX_FAILURES codes faux en FAILURE_WINDOW_MS, l'adresse IP est bloquée temporairement.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

function decodeHeader(req, name) {
  const raw = req.get(name);
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return '';
  }
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Identifie le poste (en-tête X-Agent-Name s'il est fourni, sinon STATION_NAME) et vérifie le code d'accès
 * partagé (en-tête X-Access-Code) si ACCESS_CODE est défini.
 */
export function createAuth(config) {
  const failures = new Map(); // ip -> { count, since }

  return (req, _res, next) => {
    req.user = { name: decodeHeader(req, 'x-agent-name').slice(0, 80) || config.stationName };
    if (!config.accessCode) return next();

    const ip = req.ip ?? 'inconnue';
    const now = Date.now();
    const entry = failures.get(ip);
    if (entry && now - entry.since > FAILURE_WINDOW_MS) failures.delete(ip);
    const current = failures.get(ip);
    if (current && current.count >= MAX_FAILURES) {
      return next(new HttpError(429, 'too_many_attempts', 'Trop de codes incorrects. Réessayez dans quelques minutes.'));
    }

    const code = decodeHeader(req, 'x-access-code');
    if (!code) return next(new HttpError(401, 'access_code_required', "Code d'accès requis."));
    if (!safeEqual(code, config.accessCode)) {
      failures.set(ip, { count: (current?.count ?? 0) + 1, since: current?.since ?? now });
      return next(new HttpError(401, 'access_code_invalid', "Code d'accès incorrect."));
    }
    failures.delete(ip);
    next();
  };
}

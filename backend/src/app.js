import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { Accounts } from './accounts.js';
import {
  clearSessionCookie,
  createAuthenticate,
  createLoginLimiter,
  readSessionToken,
  requireAdmin,
  requireCsrfHeader,
  setSessionCookie,
} from './auth.js';
import { normalizeScannedCode } from './codes.js';
import { HttpError, MAINTENANCE_REASONS, Store } from './db.js';

// Politique de sécurité de l'interface : tout vient du serveur lui-même (aucun CDN externe).
// Les styles sont injectés par l'application (style-src 'unsafe-inline'), la police est en data:.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

const KIND_LABELS = {
  out: 'Départ',
  in: 'Retour',
  maintenance_start: 'Mise en maintenance',
  maintenance_end: 'Fin de maintenance',
};
const REASON_LABELS = Object.fromEntries(MAINTENANCE_REASONS.map((r) => [r.id, r.label]));

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // Neutralise les formules Excel (=, +, -, @) et échappe les guillemets.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function createApp(db, config) {
  const store = new Store(db, config);
  const accounts = new Accounts(db, config);
  const loginLimiter = createLoginLimiter();
  const app = express();
  app.disable('x-powered-by');
  // Derrière un reverse proxy du réseau interne, l'adresse du client est lue dans X-Forwarded-For.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  // ---------- Interface web ----------
  if (existsSync(join(config.publicDir, 'index.html'))) {
    app.use(
      express.static(config.publicDir, {
        index: 'index.html',
        setHeaders: (res, path) => {
          // Revalidation systématique : une mise à jour du serveur est visible au rechargement.
          res.set('Cache-Control', 'no-cache');
          if (path.endsWith('.html')) {
            res.set('Content-Security-Policy', CSP);
            res.set('X-Frame-Options', 'DENY');
            // Caméra autorisée pour le scan sur tablette, le reste est désactivé.
            res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
          }
        },
      }),
    );
  } else {
    console.warn(`Interface web introuvable dans ${config.publicDir} (lancer "npm run build" dans frontend/).`);
  }

  // ---------- API ----------
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', requireCsrfHeader);
  app.use(express.json({ limit: '32kb' }));

  // Sonde de santé (sans connexion) pour Docker / la supervision.
  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });

  // ---------- Connexion ----------
  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    // Limite par poste ET par identifiant : des essais sur un compte ne bloquent pas les collègues du même PC.
    const attemptKey = `${req.ip ?? 'inconnue'}|${String(username ?? '').trim().toLowerCase()}`;
    loginLimiter.check(attemptKey);
    const user = await accounts.authenticate(username, password);
    if (!user) {
      loginLimiter.fail(attemptKey);
      throw new HttpError(401, 'invalid_credentials', 'Identifiant ou mot de passe incorrect.');
    }
    loginLimiter.reset(attemptKey);
    accounts.deleteSession(readSessionToken(req));
    setSessionCookie(req, res, accounts.createSession(user.id), config.sessionDays * 86400);
    res.json({ user });
  });

  app.post('/api/auth/logout', (req, res) => {
    accounts.deleteSession(readSessionToken(req));
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Session en cours, y compris quand le mot de passe provisoire doit encore être changé.
  const sessionUser = (req) => {
    const user = accounts.userForSession(readSessionToken(req));
    if (!user) throw new HttpError(401, 'auth_required', 'Session expirée. Reconnectez-vous.');
    return user;
  };

  // Sans session : { user: null } (pas d'erreur 401, l'écran de connexion est l'état normal au premier affichage).
  app.get('/api/auth/me', (req, res) => res.json({ user: accounts.userForSession(readSessionToken(req)) }));

  app.post('/api/auth/password', async (req, res) => {
    const user = sessionUser(req);
    const { currentPassword, newPassword } = req.body ?? {};
    const updated = await accounts.changeOwnPassword(user.id, currentPassword, newPassword);
    // Le mot de passe provisoire du premier démarrage n'est plus valable : son fichier est supprimé.
    if (user.mustChangePassword && config.initialCredentialsFile) rmSync(config.initialCredentialsFile, { force: true });
    res.json({ user: updated });
  });

  // ---------- Données (connexion obligatoire) ----------
  const api = express.Router();
  api.use(createAuthenticate(accounts));

  // Format des codes (l'interface valide un scan dès qu'un code complet est lu) et réglages utiles à l'affichage.
  api.get('/info', (_req, res) =>
    res.json({
      codePrefix: config.codePrefix,
      codeDigits: config.codeDigits,
      overdueDays: config.overdueDays,
      maintenanceReasons: MAINTENANCE_REASONS,
    }),
  );

  api.get('/stats', (req, res) => res.json(store.stats(req.scope)));

  api.get('/rollers', (req, res) => {
    res.json(
      store.listRollers(req.scope, {
        status: req.query.status,
        q: req.query.q,
        includeArchived: req.query.includeArchived === 'true',
      }),
    );
  });

  api.post('/rollers', (req, res) => {
    const body = req.body ?? {};
    const agencyId = req.user.role === 'admin' ? body.agencyId : req.user.agency.id;
    res.status(201).json(store.createRollers({ ...body, agencyId }, req.user.username));
  });

  api.get('/rollers/:code', (req, res) => {
    const code = normalizeScannedCode(req.params.code);
    const roller = store.toRoller(store.requireRoller(code, req.scope));
    res.json({ ...roller, movements: store.listMovements({ agencyId: null }, { code, limit: 200 }) });
  });

  api.patch('/rollers/:code', (req, res) => {
    const { label, notes, archived, agencyId } = req.body ?? {};
    const code = normalizeScannedCode(req.params.code);
    let roller = store.updateRoller(code, req.scope, { label, notes, agencyId });
    if (typeof archived === 'boolean') roller = store.setArchived(code, req.scope, archived);
    res.json(roller);
  });

  api.post('/rollers/:code/maintenance', (req, res) => {
    const code = normalizeScannedCode(req.params.code);
    res.json(store.startMaintenance(code, req.scope, req.body?.reasons, req.user.username));
  });

  api.delete('/rollers/:code/maintenance', (req, res) => {
    const code = normalizeScannedCode(req.params.code);
    res.json(store.endMaintenance(code, req.scope, req.user.username));
  });

  api.post('/scans', (req, res) => {
    const { code, confirm } = req.body ?? {};
    res.json(store.scan({ code: normalizeScannedCode(code), confirm: confirm === true }, req.scope, req.user.username));
  });

  api.get('/movements', (req, res) => {
    res.json(
      store.listMovements(req.scope, {
        code: req.query.code ? normalizeScannedCode(req.query.code) : undefined,
        limit: req.query.limit,
        before: req.query.before,
        from: req.query.from,
        to: req.query.to,
      }),
    );
  });

  api.post('/movements/:id/cancel', (req, res) => {
    res.json(store.cancelMovement(req.params.id, req.scope, req.user.username));
  });

  // Export CSV (séparateur ";" + BOM pour une ouverture directe dans Excel en français).
  api.get('/export/movements.csv', (req, res) => {
    const rows = store.listMovements(req.scope, { limit: 5000, from: req.query.from, to: req.query.to });
    const header = ['Date', 'Agence', 'Code', 'Libellé', 'Mouvement', 'Maintenance', 'Utilisateur', 'Annulé'];
    const lines = rows.map((m) =>
      [
        new Date(m.scannedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }),
        m.agency.name,
        m.code,
        m.label,
        KIND_LABELS[m.kind],
        m.reasons.map((r) => REASON_LABELS[r]).join(', '),
        m.agent,
        m.cancelled ? 'Oui' : '',
      ]
        .map(csvCell)
        .join(';'),
    );
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="mouvements-rollers.csv"');
    res.send('﻿' + [header.join(';'), ...lines].join('\r\n'));
  });

  // ---------- Administration ----------
  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get('/overview', (_req, res) => res.json(store.overview()));

  admin.get('/agencies', (_req, res) => res.json(accounts.listAgencies()));
  admin.post('/agencies', (req, res) => res.status(201).json(accounts.createAgency(req.body)));
  admin.patch('/agencies/:id', (req, res) => res.json(accounts.updateAgency(req.params.id, req.body)));
  admin.delete('/agencies/:id', (req, res) => {
    accounts.deleteAgency(req.params.id);
    res.status(204).end();
  });

  admin.get('/users', (_req, res) => res.json(accounts.listUsers()));
  admin.post('/users', async (req, res) => res.status(201).json(await accounts.createUser(req.body)));
  admin.patch('/users/:id', async (req, res) => res.json(await accounts.updateUser(req.params.id, req.body ?? {}, req.user.id)));
  admin.delete('/users/:id', (req, res) => {
    accounts.deleteUser(req.params.id, req.user.id);
    res.status(204).end();
  });

  api.use('/admin', admin);
  app.use('/api', api);

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Ressource introuvable.')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...(err.details ?? {}) });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'bad_json', message: 'Requête JSON invalide.' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal', message: 'Erreur interne du serveur.' });
  });

  app.locals.accounts = accounts;
  return app;
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { createAuth } from './auth.js';
import { normalizeScannedCode } from './codes.js';
import { HttpError, Store } from './db.js';

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

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // Neutralise les formules Excel (=, +, -, @) et échappe les guillemets.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function createApp(db, config) {
  const store = new Store(db, config);
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
  app.use(express.json({ limit: '32kb' }));

  // Sonde de santé (sans code d'accès) pour Docker / la supervision.
  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });

  const api = express.Router();
  api.use(createAuth(config));

  api.get('/stats', (_req, res) => res.json(store.stats()));

  // Nom du poste et format des codes (l'interface valide un scan dès qu'un code complet est lu).
  api.get('/info', (_req, res) =>
    res.json({ station: config.stationName, codePrefix: config.codePrefix, codeDigits: config.codeDigits }),
  );

  api.get('/rollers', (req, res) => {
    res.json(
      store.listRollers({
        status: req.query.status,
        q: req.query.q,
        includeArchived: req.query.includeArchived === 'true',
      }),
    );
  });

  api.post('/rollers', (req, res) => {
    res.status(201).json(store.createRollers(req.body ?? {}, req.user.name));
  });

  api.get('/rollers/:code', (req, res) => {
    const code = normalizeScannedCode(req.params.code);
    const roller = store.toRoller(store.requireRoller(code));
    res.json({ ...roller, movements: store.listMovements({ code, limit: 200 }) });
  });

  api.patch('/rollers/:code', (req, res) => {
    const { label, notes, archived } = req.body ?? {};
    const code = normalizeScannedCode(req.params.code);
    let roller = store.updateRoller(code, { label, notes });
    if (typeof archived === 'boolean') roller = store.setArchived(code, archived);
    res.json(roller);
  });

  api.post('/scans', (req, res) => {
    const { code } = req.body ?? {};
    res.json(store.scan({ code: normalizeScannedCode(code) }, req.user.name));
  });

  api.get('/movements', (req, res) => {
    res.json(
      store.listMovements({
        code: req.query.code ? normalizeScannedCode(req.query.code) : undefined,
        limit: req.query.limit,
        before: req.query.before,
        from: req.query.from,
        to: req.query.to,
      }),
    );
  });

  api.post('/movements/:id/cancel', (req, res) => {
    res.json(store.cancelMovement(req.params.id, req.user.name));
  });

  // Export CSV (séparateur ";" + BOM pour une ouverture directe dans Excel en français).
  api.get('/export/movements.csv', (req, res) => {
    const rows = store.listMovements({ limit: 5000, from: req.query.from, to: req.query.to });
    const header = ['Date', 'Code', 'Libellé', 'Mouvement', 'Poste', 'Annulé'];
    const lines = rows.map((m) =>
      [
        new Date(m.scannedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }),
        m.code,
        m.label,
        m.direction === 'out' ? 'Départ' : 'Retour',
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

  return app;
}

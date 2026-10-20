import { writeFileSync } from 'node:fs';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const app = createApp(db, config);

// Premier démarrage : création du compte administrateur.
const admin = await app.locals.accounts.ensureAdmin();
if (admin?.generated) {
  const text = [
    'Suivi des rollers Mewa - compte administrateur initial',
    `Identifiant : ${admin.username}`,
    `Mot de passe provisoire : ${admin.password}`,
    'Il devra être changé à la première connexion (ce fichier sera alors supprimé).',
    '',
  ].join('\n');
  console.log(`\n${'='.repeat(64)}\n${text}${'='.repeat(64)}\n`);
  if (config.initialCredentialsFile) writeFileSync(config.initialCredentialsFile, text, { mode: 0o600 });
} else if (admin) {
  console.log(`Compte administrateur « ${admin.username} » créé avec le mot de passe de ADMIN_PASSWORD.`);
}

const server = app.listen(config.port, () => {
  console.log(`Suivi des rollers Mewa : http://localhost:${config.port}  (base : ${config.dbPath})`);
});

function shutdown(signal) {
  console.log(`${signal} reçu, arrêt...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

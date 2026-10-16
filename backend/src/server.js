import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const app = createApp(db, config);

const server = app.listen(config.port, () => {
  console.log(`Suivi des rollers Mewa : http://localhost:${config.port}  (base : ${config.dbPath})`);
  console.log(config.accessCode ? "Code d'accès : activé" : "Code d'accès : désactivé (ACCESS_CODE vide)");
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

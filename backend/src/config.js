// Configuration lue depuis les variables d'environnement (voir .env.example).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`Variable ${name} invalide : "${raw}" (entier attendu)`);
  return value;
}

export function loadConfig(overrides = {}) {
  const config = {
    port: int('PORT', 8080),
    dbPath: process.env.DB_PATH ?? './data/rollers.db',
    // Dossier de l'interface web construite (frontend/dist). Dans l'image Docker : /app/public.
    publicDir: process.env.PUBLIC_DIR ?? fileURLToPath(new URL('../public', import.meta.url)),
    // Compte administrateur créé au premier démarrage (s'il n'existe encore aucun administrateur).
    // Sans ADMIN_PASSWORD, un mot de passe provisoire est généré et affiché dans le journal du serveur.
    adminUsername: (process.env.ADMIN_USERNAME ?? 'admin').trim() || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD ?? '',
    // Une session reste ouverte tant qu'elle sert au moins une fois tous les SESSION_DAYS jours.
    sessionDays: int('SESSION_DAYS', 30),
    codePrefix: (process.env.CODE_PREFIX ?? 'ROL').toUpperCase(),
    codeDigits: int('CODE_DIGITS', 6),
    // Un même roller relu dans ce délai est ignoré : évite qu'une double lecture accidentelle de la douchette
    // enregistre un départ puis un retour. Volontairement très court pour qu'un roller puisse repartir aussitôt.
    duplicateWindowSeconds: int('DUPLICATE_WINDOW_SECONDS', 2),
    // Un roller rescanné moins de RESCAN_CONFIRM_HOURS heures après son dernier départ ou retour
    // n'est enregistré qu'après confirmation de l'agent (0 = pas de confirmation).
    rescanConfirmHours: int('RESCAN_CONFIRM_HOURS', 24),
    // Au-delà de ce nombre de jours en transit, un roller est signalé "en retard".
    overdueDays: int('OVERDUE_DAYS', 14),
    ...overrides,
  };
  // Mot de passe administrateur provisoire, écrit à côté de la base jusqu'à son changement.
  config.initialCredentialsFile =
    config.dbPath === ':memory:' ? null : join(dirname(config.dbPath), 'identifiants-admin-initial.txt');

  // Seules des lettres non ambiguës entre claviers AZERTY et QWERTY sont autorisées dans le préfixe
  // (les douchettes émulent un clavier : A/Q, Z/W et M changent de place selon la disposition).
  if (!/^[BCDEFGHIJKLNOPRSTUVXY]{1,6}$/.test(config.codePrefix)) {
    throw new Error(
      `CODE_PREFIX invalide : "${config.codePrefix}" — 1 à 6 lettres, sans A, Q, Z, W ni M (ambiguës AZERTY/QWERTY)`,
    );
  }
  return config;
}

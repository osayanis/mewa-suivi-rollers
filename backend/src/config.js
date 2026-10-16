// Configuration lue depuis les variables d'environnement (voir .env.example).
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
    // Code d'accès partagé, demandé une fois par appareil. Vide = pas de code (réseau interne de confiance).
    accessCode: (process.env.ACCESS_CODE ?? '').trim(),
    // Nom du poste enregistré avec chaque scan (un seul PC pour l'instant).
    stationName: (process.env.STATION_NAME ?? 'GS75 Toussieu').trim().slice(0, 80) || 'GS75 Toussieu',
    codePrefix: (process.env.CODE_PREFIX ?? 'ROL').toUpperCase(),
    codeDigits: int('CODE_DIGITS', 6),
    // Un même roller relu dans ce délai est ignoré : évite qu'une double lecture accidentelle de la douchette
    // enregistre un départ puis un retour. Volontairement très court pour qu'un roller puisse repartir aussitôt.
    duplicateWindowSeconds: int('DUPLICATE_WINDOW_SECONDS', 2),
    // Au-delà de ce nombre de jours en transit, un roller est signalé "en retard".
    overdueDays: int('OVERDUE_DAYS', 7),
    ...overrides,
  };

  // Seules des lettres non ambiguës entre claviers AZERTY et QWERTY sont autorisées dans le préfixe
  // (les douchettes émulent un clavier : A/Q, Z/W et M changent de place selon la disposition).
  if (!/^[BCDEFGHIJKLNOPRSTUVXY]{1,6}$/.test(config.codePrefix)) {
    throw new Error(
      `CODE_PREFIX invalide : "${config.codePrefix}" — 1 à 6 lettres, sans A, Q, Z, W ni M (ambiguës AZERTY/QWERTY)`,
    );
  }
  return config;
}

// Format des codes rollers (ex. ROL000042) et correction des saisies de douchette.
// Même logique que backend/src/codes.js.

// Douchette réglée en QWERTY sur un poste AZERTY : les chiffres arrivent sous la forme & é " ' ( - è _ ç à.
const AZERTY_DIGITS: Record<string, string> = {
  '&': '1',
  'é': '2',
  '"': '3',
  "'": '4',
  '(': '5',
  '-': '6',
  'è': '7',
  '_': '8',
  'ç': '9',
  'à': '0',
};

export function normalizeScannedCode(raw: string): string {
  const code = raw.trim().replace(/^\][A-Za-z][0-9]/, '');
  return Array.from(code, (ch) => AZERTY_DIGITS[ch] ?? ch)
    .join('')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** Vrai si la saisie forme un code roller complet (préfixe + nombre exact de chiffres). */
export function isCompleteCode(raw: string, prefix: string, digits: number): boolean {
  const code = normalizeScannedCode(raw);
  return code.length === prefix.length + digits && code.startsWith(prefix) && /^\d+$/.test(code.slice(prefix.length));
}

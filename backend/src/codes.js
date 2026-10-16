// Gestion des codes-barres des rollers.
//
// Format : PRÉFIXE + numéro sur N chiffres, ex. ROL000042.
// Les douchettes USB/Bluetooth se comportent comme un clavier. Sur un poste configuré en AZERTY
// alors que la douchette émule un clavier QWERTY, les chiffres arrivent sous la forme & é " ' ( - è _ ç à.
// normalizeScannedCode() corrige ces cas pour que le scan fonctionne quelle que soit la configuration.

const AZERTY_DIGITS = {
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

export function formatCode(prefix, digits, seq) {
  return `${prefix}${String(seq).padStart(digits, '0')}`;
}

export function normalizeScannedCode(raw) {
  if (typeof raw !== 'string') return '';
  let code = raw.trim();
  // Préfixe d'identification AIM éventuellement ajouté par certaines douchettes (ex. "]C0").
  code = code.replace(/^\][A-Za-z][0-9]/, '');
  code = Array.from(code, (ch) => AZERTY_DIGITS[ch] ?? ch).join('');
  return code.replace(/\s+/g, '').toUpperCase();
}

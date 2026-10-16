// Générateur de codes-barres Code 128 (jeux B et C) rendu en SVG, sans dépendance externe.
// Le jeu C (paires de chiffres) est utilisé automatiquement pour les suites de chiffres,
// ce qui donne un code plus compact et plus facile à lire pour les douchettes.

const PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

/** Retourne la suite de valeurs Code 128 (start + données + checksum + stop). */
export function encodeCode128(text: string): number[] {
  if (!text) throw new Error('Texte vide');
  const values: number[] = [];
  let set: 'B' | 'C' | undefined;
  let i = 0;

  const digitRun = (from: number): number => {
    let j = from;
    while (j < text.length && isDigit(text[j])) j++;
    return j - from;
  };

  while (i < text.length) {
    const run = digitRun(i);
    const atEdge = i === 0 || i + run === text.length;
    // Passer en jeu C n'est rentable qu'à partir de 4 chiffres (6 au milieu du texte).
    if (run >= 4 && (set === 'C' || run >= (atEdge ? 4 : 6))) {
      if (set !== 'C') {
        values.push(set === undefined ? START_C : CODE_C);
        set = 'C';
      }
      const pairs = run - (run % 2);
      for (let k = 0; k < pairs; k += 2) values.push(Number(text.substr(i + k, 2)));
      i += pairs;
      continue;
    }
    if (set !== 'B') {
      values.push(set === undefined ? START_B : CODE_B);
      set = 'B';
    }
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) throw new Error(`Caractère non supporté : ${text[i]}`);
    values.push(code - 32);
    i++;
  }

  let checksum = values[0];
  for (let k = 1; k < values.length; k++) checksum += values[k] * k;
  values.push(checksum % 103, STOP);
  return values;
}

/** Largeurs des modules (barre, espace, barre, ...) en unités, sans zone de silence. */
export function code128Modules(text: string): number[] {
  const widths: number[] = [];
  for (const value of encodeCode128(text)) {
    for (const ch of PATTERNS[value]) widths.push(Number(ch));
  }
  return widths;
}

export interface IBarcodeSvgOptions {
  /** Hauteur des barres, en unités de module. */
  height?: number;
  /** Zone de silence de chaque côté, en modules (10 minimum recommandé). */
  quietZone?: number;
  /** Classe CSS ajoutée sur le <svg>. */
  className?: string;
}

/** SVG vectoriel (net à l'impression) ; sa largeur s'adapte au conteneur. */
export function code128Svg(text: string, options: IBarcodeSvgOptions = {}): string {
  const height = options.height ?? 50;
  const quiet = options.quietZone ?? 10;
  const modules = code128Modules(text);
  const total = modules.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  let rects = '';
  modules.forEach((w, idx) => {
    if (idx % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
    x += w;
  });
  const cls = options.className ? ` class="${options.className}"` : '';
  return (
    `<svg${cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" ` +
    `shape-rendering="crispEdges" role="img" aria-label="Code-barres ${text}">` +
    `<rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`
  );
}

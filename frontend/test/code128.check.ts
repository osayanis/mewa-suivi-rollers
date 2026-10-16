// Vérifie que les codes-barres générés sont relus correctement par un vrai décodeur (ZXing).
// Lancer : npm run test:barcode
import { BinaryBitmap, Code128Reader, HybridBinarizer, RGBLuminanceSource } from '@zxing/library';
import { code128Modules } from '../src/app/barcode/code128';

function decode(text: string): string {
  const modules = code128Modules(text);
  const scale = 3;
  const quiet = 12;
  const width = (modules.reduce((a, b) => a + b, 0) + quiet * 2) * scale;
  const height = 40;
  const row = new Uint8ClampedArray(width).fill(255);
  let x = quiet * scale;
  modules.forEach((w, i) => {
    if (i % 2 === 0) row.fill(0, x, x + w * scale);
    x += w * scale;
  });
  const lum = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) lum.set(row, y * width);
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, width, height)));
  return new Code128Reader().decode(bitmap).getText();
}

const samples = ['ROL000001', 'ROL000042', 'ROL123456', 'ROL999999', 'ABC12', 'R0L-1', '12345678', 'X1234567Y', 'Roller test 7'];
let failures = 0;
for (const s of samples) {
  let out = '';
  try {
    out = decode(s);
  } catch (e) {
    out = `ERREUR ${(e as Error).name}`;
  }
  const ok = out === s;
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'KO '} ${s.padEnd(14)} -> ${out}`);
}
if (failures) throw new Error(`${failures} code(s)-barres mal décodé(s)`);
console.log('Tous les codes-barres sont décodés correctement.');

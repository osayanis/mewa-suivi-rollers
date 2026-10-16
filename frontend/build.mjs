// Construit l'interface dans dist/ (servie par le backend).
//   node build.mjs          → build de production (minifié)
//   node build.mjs --watch  → reconstruit à chaque modification (développement)
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
for (const file of ['index.html', 'favicon.svg', 'manifest.webmanifest']) copyFileSync(file, `${outdir}/${file}`);

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  splitting: true, // ZXing (scan caméra) dans un fichier séparé, chargé à la demande
  target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
  outdir: `${outdir}/assets`,
  chunkNames: 'chunk-[hash]',
  minify: !watch,
  sourcemap: watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Surveillance des fichiers… (Ctrl+C pour arrêter)');
} else {
  await esbuild.build(options);
}

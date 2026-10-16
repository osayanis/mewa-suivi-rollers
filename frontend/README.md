# Interface web — Suivi des rollers Mewa

Construite avec esbuild dans `dist/`, puis servie par le backend. Le `Dockerfile` à la racine s'en charge automatiquement. Voir le [README principal](../README.md).

- `src/app/` : l'application (TypeScript sans framework ; police et logo Mewa intégrés, aucune ressource externe).
- `index.html`, `favicon.svg`, `manifest.webmanifest` : copiés tels quels dans `dist/`.

```bash
npm install
npm run dev            # reconstruit dist/ à chaque modification
npm run build          # build de production
npm run typecheck
npm run test:barcode   # vérifie les codes-barres avec ZXing
```

// Impression des étiquettes code-barres.
// L'impression passe par un iframe caché : pas de fenêtre pop-up (souvent bloquée), et seule
// la planche d'étiquettes est imprimée, pas l'écran de l'application.

import type { IRoller } from './api';
import { code128Svg } from './barcode/code128';
import { MEWA_LOGO_SVG } from './brand/logo';
import { GEBAUER_FONT_FACES } from './brand/fonts';

export type LabelFormat = 'single' | 'a4';

export const LABEL_FORMATS: { id: LabelFormat; name: string; hint: string }[] = [
  { id: 'single', name: 'Étiquette 100 × 50 mm', hint: 'Imprimante d’étiquettes (Zebra, Brother…) — une étiquette par roller' },
  { id: 'a4', name: 'Planche A4 — 3 × 8', hint: 'Feuilles d’étiquettes autocollantes 70 × 37 mm (24 par page)' },
];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function labelHtml(roller: IRoller): string {
  return `<div class="label">
    <div class="top"><span class="logo">${MEWA_LOGO_SVG}</span><span class="name">${escapeHtml(roller.label || 'Roller')}</span></div>
    <div class="bars">${code128Svg(roller.code, { height: 60 })}</div>
    <div class="code">${escapeHtml(roller.code)}</div>
  </div>`;
}

export function buildLabelsDocument(rollers: IRoller[], format: LabelFormat): string {
  const pageCss =
    format === 'single'
      ? `@page { size: 100mm 50mm; margin: 0; }
         .sheet { display: block; }
         .label { width: 100mm; height: 50mm; padding: 3.5mm 5mm 3mm; page-break-after: always; break-after: page; }
         .label:last-child { page-break-after: auto; break-after: auto; }
         .logo svg { height: 5mm; } .name { font-size: 11pt; }
         .bars { height: 26mm; } .code { font-size: 15pt; }`
      : `@page { size: A4; margin: 0; }
         .sheet { display: grid; grid-template-columns: repeat(3, 70mm); grid-auto-rows: 37mm;
                  padding: 0.5mm 0; width: 210mm; }
         .label { width: 70mm; height: 37mm; padding: 2.5mm 4mm 2mm; break-inside: avoid; }
         .label:nth-child(24n) { page-break-after: always; break-after: page; }
         .logo svg { height: 3.6mm; } .name { font-size: 8pt; }
         .bars { height: 19mm; } .code { font-size: 11pt; }`;

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes rollers</title><style>
    ${GEBAUER_FONT_FACES}
    * { box-sizing: border-box; margin: 0; }
    html, body { background: #fff; color: #222; font-family: Gebauer, Arial, sans-serif;
                 -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .label { display: flex; flex-direction: column; overflow: hidden; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 2mm; color: #e60021; }
    .logo { display: flex; } .logo svg { width: auto; }
    .name { color: #222; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bars { flex: 1 1 auto; margin-top: 1.5mm; }
    .bars svg { width: 100%; height: 100%; display: block; }
    .code { text-align: center; font-weight: 700; letter-spacing: 0.08em; line-height: 1.15; }
    ${pageCss}
  </style></head><body><div class="sheet">${rollers.map(labelHtml).join('')}</div></body></html>`;
}

export function printLabels(rollers: IRoller[], format: LabelFormat): void {
  if (rollers.length === 0) return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(buildLabelsDocument(rollers, format));
  doc.close();

  const cleanup = (): void => {
    setTimeout(() => iframe.remove(), 1000);
  };
  win.addEventListener('afterprint', cleanup);
  // Attendre le chargement de la police avant d'imprimer.
  const ready: Promise<unknown> = doc.fonts?.ready ?? Promise.resolve();
  ready
    .catch(() => undefined)
    .then(() => {
      win.focus();
      win.print();
      // Filet de sécurité si "afterprint" n'est pas émis.
      setTimeout(() => iframe.parentNode && iframe.remove(), 60_000);
    })
    .catch(() => iframe.remove());
}

// Styles de l'application, d'après la charte Mewa (mewa.fr) :
// rouge Mewa #E60021 / #BE0F28, anthracite #222, gris #515151 / #D3D3D3 / #F3F3F3,
// bleus #193273 / #0050A0 / #E7E9EE, police Gebauer, coins arrondis 10–20 px.
// Tout est préfixé par .mrt (styles isolés du reste de la page).

import { GEBAUER_FONT_FACES } from './brand/fonts';

const CSS = `
.mrt {
  --mrt-red: #e60021;
  --mrt-red-dark: #be0f28;
  --mrt-coal: #222222;
  --mrt-grey: #515151;
  --mrt-grey-300: #d3d3d3;
  --mrt-grey-100: #f3f3f3;
  --mrt-blue: #193273;
  --mrt-blue-light: #0050a0;
  --mrt-pastel: #e7e9ee;
  --mrt-green: #1d7a3e;
  --mrt-green-bg: #e3f1e7;
  --mrt-transit-bg: #e3ecf6;
  --mrt-amber: #a65200;
  --mrt-amber-bg: #fcefdf;
  --mrt-violet: #6a3d9a;
  --mrt-violet-bg: #f0eaf7;
  --mrt-radius-sm: 10px;
  --mrt-radius: 15px;
  --mrt-radius-lg: 20px;
  --mrt-shadow: 0 1px 2px rgba(34, 34, 34, .06), 0 4px 16px rgba(34, 34, 34, .06);
  --mrt-ease: cubic-bezier(.2, .8, .2, 1);

  position: relative;
  font-family: Gebauer, "Segoe UI", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.45;
  color: var(--mrt-coal);
  background: #fff;
  -webkit-font-smoothing: antialiased;
  text-align: left;
  max-width: 1280px;
  margin: 0 auto;
}
/* Remise à zéro : .mrt :where(...) = spécificité d’une classe. Les classes des composants (déclarées après) restent prioritaires. */
.mrt *, .mrt *::before, .mrt *::after { box-sizing: border-box; }
.mrt :where(h1, h2, h3, p, ol, ul, dl, dd) { margin: 0; padding: 0; }
.mrt :where(ol, ul) { list-style: none; }
.mrt :where(button, input, select, textarea) { font: inherit; color: inherit; }
.mrt :where(button) { cursor: pointer; }
.mrt :where(button:disabled) { cursor: default; }
.mrt [hidden] { display: none !important; }
.mrt :focus-visible { outline: 3px solid rgba(230, 0, 33, .35); outline-offset: 2px; }
.mrt-icon { width: 20px; height: 20px; flex: none; }

/* ---------- En-tête ---------- */
.mrt-header {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 18px 24px 14px;
}
.mrt-brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
.mrt-logo { color: var(--mrt-red); display: flex; }
.mrt-logo svg { height: 26px; width: auto; display: block; }
.mrt-brand-sep { width: 1px; height: 26px; background: var(--mrt-grey-300); }
.mrt-title { font-size: 20px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mrt-user {
  display: inline-flex; align-items: center; gap: 8px; max-width: 45%;
  border: 1px solid var(--mrt-grey-300); background: #fff; border-radius: 999px;
  padding: 7px 14px 7px 10px; font-size: 14px; color: var(--mrt-grey);
  transition: border-color .15s, color .15s;
}
.mrt-user span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mrt-user:hover { border-color: var(--mrt-coal); color: var(--mrt-coal); }
.mrt-user .mrt-icon { width: 18px; height: 18px; }
.mrt-user .mrt-user-name { color: var(--mrt-coal); font-weight: 500; padding-left: 8px; border-left: 1px solid var(--mrt-grey-300); }

/* ---------- Onglets ---------- */
.mrt-tabs {
  display: flex; gap: 4px; padding: 0 24px; border-bottom: 1px solid var(--mrt-grey-300);
  position: sticky; top: 0; z-index: 5; background: #fff;
}
.mrt-tab {
  display: inline-flex; align-items: center; gap: 8px; position: relative;
  border: 0; background: none; padding: 14px 16px; font-size: 16px; font-weight: 500; color: var(--mrt-grey);
  transition: color .15s;
}
.mrt-tab::after {
  content: ""; position: absolute; left: 12px; right: 12px; bottom: -1px; height: 3px;
  border-radius: 3px 3px 0 0; background: var(--mrt-red); transform: scaleX(0); transition: transform .2s var(--mrt-ease);
}
.mrt-tab:hover { color: var(--mrt-coal); }
.mrt-tab-active { color: var(--mrt-red); }
.mrt-tab-active::after { transform: scaleX(1); }

.mrt-main { padding: 24px; min-height: 420px; }
.mrt-view { animation: mrt-fade .2s var(--mrt-ease); }

/* ---------- Boutons ---------- */
.mrt-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 44px; padding: 10px 18px; border-radius: var(--mrt-radius-sm);
  border: 1px solid transparent; font-weight: 500; font-size: 15px; line-height: 1.2; white-space: nowrap;
  transition: background-color .15s, border-color .15s, color .15s, transform .1s;
}
.mrt-btn:active:not(:disabled) { transform: scale(.98); }
.mrt-btn:disabled { opacity: .5; }
.mrt-btn-primary { background: var(--mrt-red); color: #fff; }
.mrt-btn-primary:hover:not(:disabled) { background: var(--mrt-red-dark); }
.mrt-btn-secondary { background: #fff; color: var(--mrt-coal); border-color: var(--mrt-grey-300); }
.mrt-btn-secondary:hover:not(:disabled) { border-color: var(--mrt-coal); }
.mrt-btn-light { background: #fff; color: var(--mrt-coal); }
.mrt-btn-ghost { background: none; color: var(--mrt-red-dark); padding-left: 0; padding-right: 0; }
.mrt-btn-ghost:hover:not(:disabled) { text-decoration: underline; }
.mrt-btn-ghost-light {
  background: rgba(255, 255, 255, .16); color: inherit; border-color: rgba(255, 255, 255, .5);
}
.mrt-btn-ghost-light:hover:not(:disabled) { background: rgba(255, 255, 255, .28); }
.mrt-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px;
  border: 0; background: none; border-radius: 50%; color: var(--mrt-grey);
}
.mrt-icon-btn:hover { background: var(--mrt-grey-100); color: var(--mrt-coal); }
.mrt-link {
  border: 0; background: none; padding: 0; color: inherit; font-weight: 700; text-align: left;
  text-decoration: underline; text-decoration-color: var(--mrt-grey-300); text-underline-offset: 3px;
}
.mrt-link:hover:not(:disabled) { color: var(--mrt-red); text-decoration-color: currentColor; }
.mrt-link:disabled { text-decoration: none; }

/* ---------- Champs ---------- */
.mrt-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mrt-field > label { font-size: 14px; font-weight: 500; color: var(--mrt-grey); }
.mrt-input {
  width: 100%; min-height: 44px; padding: 10px 14px; border: 1px solid var(--mrt-grey-300);
  border-radius: var(--mrt-radius-sm); background: #fff; font-size: 16px;
  transition: border-color .15s, box-shadow .15s;
}
.mrt-input:hover:not(:disabled) { border-color: #9a9a9a; }
.mrt-input:focus { outline: none; border-color: var(--mrt-coal); box-shadow: 0 0 0 3px rgba(34, 34, 34, .08); }
.mrt-input:disabled { background: var(--mrt-grey-100); color: var(--mrt-grey); }
textarea.mrt-input { resize: vertical; }
.mrt-hint { font-size: 13px; color: var(--mrt-grey); }
.mrt-form { display: flex; flex-direction: column; gap: 16px; }
.mrt-form-row { display: grid; grid-template-columns: 140px 1fr; gap: 16px; }
.mrt-form-actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.mrt-form-error { color: var(--mrt-red-dark); font-size: 14px; font-weight: 500; }
.mrt-form-error:empty { display: none; }
.mrt-check { width: 20px; height: 20px; accent-color: var(--mrt-red); margin: 0; cursor: pointer; }
.mrt-check-hit { display: inline-flex; padding: 10px; margin: -10px; cursor: pointer; }
.mrt-toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 15px; }

/* ---------- Écran Scanner ---------- */
.mrt-scanner-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 32px; align-items: start; }
.mrt-scanner-main { display: flex; flex-direction: column; gap: 20px; }

.mrt-scan-box {
  border: 2px solid var(--mrt-grey-300); border-radius: var(--mrt-radius-lg); padding: 18px 18px 14px 22px;
  background: #fff; cursor: text; transition: border-color .2s, box-shadow .2s;
}
.mrt-scan-ready { border-color: var(--mrt-red); box-shadow: 0 0 0 5px rgba(230, 0, 33, .08); }
.mrt-scan-row { display: flex; align-items: center; gap: 14px; }
.mrt-scan-icon { width: 32px; height: 32px; color: var(--mrt-red); }
.mrt-scan-input {
  flex: 1 1 auto; min-width: 0; border: 0; outline: none !important; background: none; padding: 8px 0;
  font-size: 30px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
}
.mrt-scan-input::placeholder { color: #9a9a9a; font-weight: 400; letter-spacing: 0; text-transform: none; font-size: 24px; }
.mrt-ready { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 14px; color: var(--mrt-grey); }
.mrt-ready-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--mrt-grey-300); }
.mrt-scan-ready .mrt-ready-dot { background: var(--mrt-green); animation: mrt-pulse 1.6s ease-out infinite; }
.mrt-scan-ready .mrt-ready { color: var(--mrt-green); font-weight: 500; }

.mrt-result-area { min-height: 132px; }
.mrt-result {
  display: flex; align-items: center; gap: 20px; padding: 24px 26px; border-radius: var(--mrt-radius-lg);
  min-height: 132px;
}
.mrt-result-icon {
  display: flex; align-items: center; justify-content: center; flex: none;
  width: 64px; height: 64px; border-radius: 50%; background: rgba(255, 255, 255, .2);
}
.mrt-result-icon .mrt-icon { width: 34px; height: 34px; }
.mrt-result-main { flex: 1 1 auto; min-width: 0; }
.mrt-result-kicker { font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.mrt-result-code { font-size: 38px; font-weight: 700; letter-spacing: .04em; line-height: 1.1; margin-top: 2px; overflow-wrap: anywhere; }
.mrt-result-meta { font-size: 17px; margin-top: 4px; opacity: .92; }
.mrt-result-out { background: var(--mrt-blue-light); color: #fff; }
.mrt-result-in { background: var(--mrt-green); color: #fff; }
.mrt-result-error { background: var(--mrt-red-dark); color: #fff; }
.mrt-result-duplicate { background: var(--mrt-pastel); color: var(--mrt-blue); }
.mrt-result-duplicate .mrt-result-icon { background: #fff; }
.mrt-result-maintenance { background: var(--mrt-violet); color: #fff; }
.mrt-result-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.mrt-result-cancelled { background: var(--mrt-grey-100); color: var(--mrt-coal); }
.mrt-result-cancelled .mrt-result-icon { background: #fff; }
.mrt-result-pending { background: var(--mrt-grey-100); color: var(--mrt-grey); }
.mrt-result-idle { background: var(--mrt-grey-100); color: var(--mrt-grey); }
.mrt-steps { list-style: none; counter-reset: mrt-step; display: grid; gap: 10px; font-size: 16px; }
.mrt-steps li { counter-increment: mrt-step; position: relative; padding-left: 38px; min-height: 26px; }
.mrt-steps li::before {
  content: counter(mrt-step); position: absolute; left: 0; top: -1px; display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 50%; background: #fff; color: var(--mrt-red); font-weight: 700; font-size: 14px;
}
.mrt-steps strong { color: var(--mrt-coal); }
.mrt-pop { animation: mrt-pop .28s var(--mrt-ease); }

.mrt-scanner-side { display: flex; flex-direction: column; gap: 24px; }
.mrt-today { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.mrt-today-item { background: var(--mrt-grey-100); border-radius: var(--mrt-radius); padding: 14px 16px; }
.mrt-today-item strong { display: block; font-size: 30px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.mrt-today-item span { font-size: 13px; color: var(--mrt-grey); }
.mrt-today-transit { background: var(--mrt-transit-bg); }
.mrt-today-maintenance { background: var(--mrt-violet-bg); }
.mrt-today-maintenance strong { color: var(--mrt-violet); }
.mrt-today-transit strong { color: var(--mrt-blue-light); }

.mrt-section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--mrt-grey); margin-bottom: 10px; }
.mrt-recent { display: flex; flex-direction: column; }
.mrt-recent-item {
  display: grid; grid-template-columns: auto auto 1fr; grid-template-areas: "time dot code" ". . text";
  column-gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--mrt-grey-100);
}
.mrt-recent-time { grid-area: time; font-size: 13px; color: var(--mrt-grey); font-variant-numeric: tabular-nums; }
.mrt-recent-dot { grid-area: dot; width: 10px; height: 10px; border-radius: 50%; background: var(--mrt-grey-300); }
.mrt-recent-out .mrt-recent-dot { background: var(--mrt-blue-light); }
.mrt-recent-in .mrt-recent-dot { background: var(--mrt-green); }
.mrt-recent-error .mrt-recent-dot { background: var(--mrt-red); }
.mrt-recent-maintenance .mrt-recent-dot { background: var(--mrt-violet); }
.mrt-recent-code { grid-area: code; font-size: 15px; justify-self: start; }
.mrt-recent-text { grid-area: text; font-size: 14px; color: var(--mrt-grey); }
.mrt-recent-label { display: none; }
.mrt-cancelled .mrt-recent-code, .mrt-cancelled .mrt-recent-text, .mrt-cancelled .mrt-timeline-title,
.mrt-history-item.mrt-cancelled > span:not(:last-child) { text-decoration: line-through; opacity: .55; }

/* ---------- Caméra ---------- */
.mrt-cam { position: fixed; inset: 0; z-index: 1000; background: #000; display: flex; flex-direction: column; }
.mrt-cam-viewport { position: relative; flex: 1 1 auto; overflow: hidden; }
.mrt-cam-video { width: 100%; height: 100%; object-fit: cover; display: block; }
.mrt-cam-frame {
  position: absolute; left: 10%; right: 10%; top: 50%; height: 34%; transform: translateY(-50%);
  border: 3px solid rgba(255, 255, 255, .9); border-radius: var(--mrt-radius-lg);
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .45);
}
.mrt-cam-hit { animation: mrt-hit .6s ease-out; }
.mrt-cam-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px;
  padding-bottom: max(16px, env(safe-area-inset-bottom)); background: #000; color: #fff;
}
.mrt-cam-status { font-size: 16px; font-weight: 500; }
.mrt-cam-error .mrt-cam-status { color: #ff8a8a; }

/* ---------- Écran Rollers ---------- */
.mrt-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px; }
.mrt-kpi {
  display: flex; flex-direction: column; gap: 6px; text-align: left; padding: 18px 20px;
  border-radius: var(--mrt-radius-lg); border: 2px solid transparent; background: var(--mrt-grey-100);
  transition: border-color .15s, transform .15s var(--mrt-ease);
}
.mrt-kpi:hover { transform: translateY(-1px); }
.mrt-kpis-static .mrt-kpi:hover { transform: none; }
.mrt-kpi-head { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; color: var(--mrt-grey); }
.mrt-kpi-value { font-size: 40px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
.mrt-kpi-onsite { background: var(--mrt-green-bg); } .mrt-kpi-onsite .mrt-kpi-value, .mrt-kpi-onsite .mrt-icon { color: var(--mrt-green); }
.mrt-kpi-transit { background: var(--mrt-transit-bg); } .mrt-kpi-transit .mrt-kpi-value, .mrt-kpi-transit .mrt-icon { color: var(--mrt-blue-light); }
.mrt-kpi-overdue { background: var(--mrt-amber-bg); } .mrt-kpi-overdue .mrt-kpi-value, .mrt-kpi-overdue .mrt-icon { color: var(--mrt-amber); }
.mrt-kpi-active { border-color: currentColor; }
.mrt-kpi-onsite.mrt-kpi-active { border-color: var(--mrt-green); }
.mrt-kpi-transit.mrt-kpi-active { border-color: var(--mrt-blue-light); }
.mrt-kpi-overdue.mrt-kpi-active { border-color: var(--mrt-amber); }
.mrt-kpi-maintenance { background: var(--mrt-violet-bg); } .mrt-kpi-maintenance .mrt-kpi-value, .mrt-kpi-maintenance .mrt-icon { color: var(--mrt-violet); }
.mrt-kpi-maintenance.mrt-kpi-active { border-color: var(--mrt-violet); }
.mrt-kpi-total.mrt-kpi-active { border-color: var(--mrt-coal); }

.mrt-toolbar { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 14px; }
.mrt-toolbar-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.mrt-search { position: relative; flex: 1 1 320px; max-width: 520px; }
.mrt-search .mrt-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--mrt-grey); pointer-events: none; }
.mrt-search-input { padding-left: 44px; }
.mrt-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.mrt-chip {
  border: 1px solid var(--mrt-grey-300); background: #fff; border-radius: 999px; padding: 7px 16px;
  font-size: 14px; font-weight: 500; color: var(--mrt-grey); min-height: 36px; transition: all .15s;
}
.mrt-chip:hover { border-color: var(--mrt-coal); color: var(--mrt-coal); }
.mrt-chip-active, .mrt-chip-active:hover { background: var(--mrt-coal); border-color: var(--mrt-coal); color: #fff; }

.mrt-card { border: 1px solid var(--mrt-grey-300); border-radius: var(--mrt-radius-lg); background: #fff; overflow: hidden; }
.mrt-table { width: 100%; border-collapse: collapse; font-size: 15px; }
.mrt-table th {
  text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
  color: var(--mrt-grey); padding: 14px 16px; background: var(--mrt-grey-100); white-space: nowrap;
}
.mrt-table td { padding: 12px 16px; border-top: 1px solid var(--mrt-grey-100); vertical-align: middle; }
.mrt-row { cursor: pointer; transition: background-color .12s; }
.mrt-row:hover { background: #fafafa; }
.mrt-row-overdue td:first-child { box-shadow: inset 4px 0 0 var(--mrt-amber); }
.mrt-td-check { width: 48px; }
.mrt-td-code { white-space: nowrap; }
.mrt-code { font-size: 15px; letter-spacing: .03em; }
.mrt-sub { display: block; font-size: 13px; color: var(--mrt-grey); font-weight: 400; }
.mrt-muted { color: #9a9a9a; }
.mrt-td-since { font-variant-numeric: tabular-nums; white-space: nowrap; }
.mrt-td-last { font-size: 13px; color: var(--mrt-grey); }

.mrt-badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 8px; border-radius: 999px;
  font-size: 13px; font-weight: 500; white-space: nowrap; vertical-align: middle;
}
.mrt-badge .mrt-icon { width: 16px; height: 16px; }
.mrt-badge-onsite { background: var(--mrt-green-bg); color: var(--mrt-green); }
.mrt-badge-transit { background: var(--mrt-transit-bg); color: var(--mrt-blue-light); }
.mrt-badge-overdue { background: var(--mrt-amber-bg); color: var(--mrt-amber); }
.mrt-badge-maintenance { background: var(--mrt-violet-bg); color: var(--mrt-violet); }
.mrt-badge-admin { background: var(--mrt-coal); color: #fff; }
.mrt-badge-agent { background: var(--mrt-grey-100); color: var(--mrt-coal); }
.mrt-badge-archived { background: var(--mrt-grey-100); color: var(--mrt-grey); padding-left: 10px; margin-left: 8px; }

.mrt-empty { padding: 48px 24px; text-align: center; color: var(--mrt-grey); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.mrt-empty-title { font-size: 18px; font-weight: 500; color: var(--mrt-coal); }
.mrt-empty .mrt-btn { margin-top: 12px; }
.mrt-loading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 48px; color: var(--mrt-grey); }
.mrt-spinner {
  width: 26px; height: 26px; border-radius: 50%; flex: none;
  border: 3px solid var(--mrt-grey-300); border-top-color: var(--mrt-red); animation: mrt-spin .8s linear infinite;
}

/* ---------- Modales ---------- */
.mrt-backdrop {
  position: fixed; inset: 0; z-index: 900; background: rgba(34, 34, 34, .45);
  display: flex; align-items: center; justify-content: center; padding: 24px; animation: mrt-fade .15s ease-out;
}
.mrt-modal {
  width: 100%; max-width: 560px; max-height: calc(100vh - 48px); display: flex; flex-direction: column;
  background: #fff; border-radius: var(--mrt-radius-lg); box-shadow: 0 24px 64px rgba(0, 0, 0, .25);
  animation: mrt-rise .25s var(--mrt-ease);
}
.mrt-modal-wide { max-width: 920px; }
.mrt-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 18px 6px 26px; }
.mrt-modal-head h2 { font-size: 22px; font-weight: 700; letter-spacing: .02em; }
.mrt-modal-body { padding: 12px 26px 26px; overflow-y: auto; }
.mrt-modal-foot { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; padding: 16px 26px; border-top: 1px solid var(--mrt-grey-100); }

.mrt-print { display: flex; flex-direction: column; gap: 16px; }
.mrt-label-preview {
  align-self: center; width: 300px; max-width: 100%; aspect-ratio: 2 / 1; padding: 14px 18px;
  border: 1px dashed var(--mrt-grey-300); border-radius: 8px; display: flex; flex-direction: column;
}
.mrt-label-preview-name { font-size: 13px; font-weight: 500; }
.mrt-label-preview-bars { flex: 1 1 auto; margin: 6px 0 2px; }
.mrt-label-preview-bars svg, .mrt-detail-bars svg { width: 100%; height: 100%; display: block; }
.mrt-label-preview-code { text-align: center; font-weight: 700; letter-spacing: .08em; }
.mrt-choice-list { display: grid; gap: 10px; }
.mrt-choice {
  display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 14px 16px;
  border: 2px solid var(--mrt-grey-300); border-radius: var(--mrt-radius); background: #fff; transition: border-color .15s;
}
.mrt-choice span { font-size: 14px; color: var(--mrt-grey); }
.mrt-choice:hover { border-color: #9a9a9a; }
.mrt-choice-active, .mrt-choice-active:hover { border-color: var(--mrt-red); }

.mrt-detail-top { display: grid; grid-template-columns: 1fr 300px; gap: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--mrt-grey-100); margin-bottom: 20px; }
.mrt-detail-summary { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.mrt-detail-label { font-size: 22px; font-weight: 500; }
.mrt-dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: 15px; }
.mrt-dl dt { color: var(--mrt-grey); }
.mrt-detail-barcode { display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 16px; background: var(--mrt-grey-100); border-radius: var(--mrt-radius); }
.mrt-detail-bars { height: 64px; background: #fff; padding: 6px; border-radius: 6px; }
.mrt-detail-code { text-align: center; font-weight: 700; letter-spacing: .08em; }
.mrt-detail-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
.mrt-detail-danger { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--mrt-grey-100); }
.mrt-timeline { display: flex; flex-direction: column; max-height: 360px; overflow-y: auto; }
.mrt-timeline-item { display: flex; gap: 12px; padding: 8px 0; position: relative; }
.mrt-timeline-item:not(:last-child)::before { content: ""; position: absolute; left: 15px; top: 40px; bottom: -8px; width: 2px; background: var(--mrt-grey-100); }
.mrt-timeline-dot { flex: none; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.mrt-timeline-dot .mrt-icon { width: 16px; height: 16px; }
.mrt-timeline-out .mrt-timeline-dot { background: var(--mrt-transit-bg); color: var(--mrt-blue-light); }
.mrt-timeline-in .mrt-timeline-dot, .mrt-timeline-maintenance_end .mrt-timeline-dot { background: var(--mrt-green-bg); color: var(--mrt-green); }
.mrt-timeline-maintenance_start .mrt-timeline-dot { background: var(--mrt-violet-bg); color: var(--mrt-violet); }
.mrt-timeline-title { font-weight: 500; }
.mrt-timeline-empty { color: var(--mrt-grey); padding: 8px 0; }

/* ---------- Historique ---------- */
.mrt-history { padding: 4px 0 8px; }
.mrt-history-day { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--mrt-grey); padding: 18px 20px 8px; }
.mrt-history-item {
  display: grid; grid-template-columns: 56px 130px minmax(0, 1fr) minmax(0, 180px) auto;
  gap: 12px; align-items: center; padding: 10px 20px; border-top: 1px solid var(--mrt-grey-100); font-size: 15px;
}
.mrt-history-time { color: var(--mrt-grey); font-variant-numeric: tabular-nums; }
.mrt-history-state:empty { display: none; }
.mrt-dir { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; font-size: 14px; }
.mrt-dir .mrt-icon { width: 18px; height: 18px; }
.mrt-dir-out { color: var(--mrt-blue-light); }
.mrt-dir-in, .mrt-dir-maintenance_end { color: var(--mrt-green); }
.mrt-dir-maintenance_start { color: var(--mrt-violet); }
.mrt-history-who { font-size: 14px; color: var(--mrt-grey); overflow-wrap: anywhere; }
.mrt-history-who:empty { display: none; }
.mrt-more { display: flex; margin: 16px auto 8px; }

/* ---------- Connexion ---------- */
.mrt-login {
  min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 20px; padding: 24px 16px; background: var(--mrt-grey-100);
}
.mrt-login-card {
  width: 100%; max-width: 420px; background: #fff; border-radius: var(--mrt-radius-lg); box-shadow: var(--mrt-shadow);
  padding: 32px 32px 28px; border-top: 5px solid var(--mrt-red); display: flex; flex-direction: column; gap: 20px;
}
.mrt-login-brand { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.mrt-login-brand .mrt-logo svg { height: 30px; }
.mrt-login-title { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--mrt-grey); }
.mrt-login-heading { font-size: 26px; font-weight: 700; }
.mrt-login-text { color: var(--mrt-grey); }
.mrt-login-help { text-align: center; }
.mrt-login-foot { font-size: 13px; color: var(--mrt-grey); }
.mrt-btn-block { width: 100%; min-height: 50px; font-size: 16px; }
.mrt-pw { position: relative; }
.mrt-pw .mrt-input { padding-right: 52px; }
.mrt-pw-toggle { position: absolute; right: 2px; top: 50%; transform: translateY(-50%); }
.mrt-pw-toggle[aria-pressed="true"] { color: var(--mrt-red); }

/* ---------- Compte ---------- */
.mrt-account { display: flex; flex-direction: column; gap: 20px; }
.mrt-account-id { display: flex; align-items: center; gap: 14px; }
.mrt-account-avatar {
  width: 48px; height: 48px; border-radius: 50%; background: var(--mrt-grey-100); color: var(--mrt-red);
  display: flex; align-items: center; justify-content: center; flex: none;
}
.mrt-account-name { font-size: 18px; font-weight: 700; }
.mrt-account-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; padding-top: 16px; border-top: 1px solid var(--mrt-grey-100); }
.mrt-btn-danger { background: var(--mrt-red-dark); color: #fff; }
.mrt-btn-danger:hover:not(:disabled) { background: #9a0b20; }
.mrt-confirm { font-size: 16px; }

/* ---------- Maintenance ---------- */
.mrt-reasons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mrt-reason {
  display: flex; align-items: flex-start; gap: 10px; padding: 14px; border: 2px solid var(--mrt-grey-300);
  border-radius: var(--mrt-radius); cursor: pointer; transition: border-color .15s, background-color .15s;
}
.mrt-reason .mrt-check { margin-top: 2px; accent-color: var(--mrt-violet); }
.mrt-reason strong { display: block; font-size: 16px; }
.mrt-reason span span { font-size: 13px; color: var(--mrt-grey); }
.mrt-reason:hover { border-color: #9a9a9a; }
.mrt-reason-active, .mrt-reason-active:hover { border-color: var(--mrt-violet); background: var(--mrt-violet-bg); }
.mrt-detail-maintenance { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.mrt-maintenance-box { align-self: stretch; display: flex; flex-direction: column; gap: 6px; padding: 16px; border-radius: var(--mrt-radius); background: var(--mrt-violet-bg); }
.mrt-maintenance-box .mrt-form-actions { margin-top: 8px; }
.mrt-maintenance-title { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--mrt-violet); }
.mrt-section-gap { margin-top: 24px; }
.mrt-transfer { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; margin-top: 16px; }

/* ---------- Administration ---------- */
.mrt-view-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.mrt-view-title { font-size: 22px; font-weight: 700; }
.mrt-agency-filter { position: relative; min-width: 260px; }
.mrt-agency-filter .mrt-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--mrt-red); pointer-events: none; }
.mrt-agency-filter .mrt-select { padding-left: 44px; font-weight: 500; }
.mrt-select {
  appearance: none; -webkit-appearance: none; cursor: pointer; padding-right: 40px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23515151' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 12px center; background-size: 18px;
}
.mrt-td-num { text-align: right; font-variant-numeric: tabular-nums; width: 1%; white-space: nowrap; }
.mrt-table-overview td.mrt-td-num { font-size: 18px; font-weight: 700; }
.mrt-num-onsite { color: var(--mrt-green); }
.mrt-num-transit { color: var(--mrt-blue-light); }
.mrt-num-overdue { color: var(--mrt-amber); }
.mrt-num-maintenance { color: var(--mrt-violet); }
.mrt-td-today { white-space: nowrap; color: var(--mrt-grey); font-variant-numeric: tabular-nums; }
.mrt-td-today span { display: inline-flex; align-items: center; gap: 4px; margin-right: 14px; }
.mrt-td-today .mrt-icon { width: 16px; height: 16px; }
.mrt-td-actions { text-align: right; white-space: nowrap; width: 1%; }
.mrt-icon-btn:disabled { opacity: .35; cursor: default; }
.mrt-icon-btn:disabled:hover { background: none; color: var(--mrt-grey); }
.mrt-icon-btn-danger:hover:not(:disabled) { color: var(--mrt-red-dark); background: #fdecee; }
.mrt-td-agency { font-size: 14px; white-space: nowrap; }
.mrt-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mrt-footnote { margin-top: 14px; }
.mrt-inline { display: flex; gap: 10px; }
.mrt-inline .mrt-input { flex: 1 1 auto; min-width: 0; }
.mrt-input-mono { font-family: ui-monospace, Consolas, monospace; letter-spacing: .04em; }
.mrt-choice-row { grid-template-columns: 1fr 1fr; }

/* ---------- Notifications ---------- */
.mrt-toasts { position: fixed; z-index: 1100; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
.mrt-toast {
  display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-radius: var(--mrt-radius);
  background: var(--mrt-coal); color: #fff; font-size: 15px; box-shadow: 0 8px 24px rgba(0, 0, 0, .2);
  animation: mrt-rise .25s var(--mrt-ease); max-width: min(560px, calc(100vw - 32px));
}
.mrt-toast-success .mrt-icon { color: #7fd89b; }
.mrt-toast-error { background: var(--mrt-red-dark); }
.mrt-toast-out { opacity: 0; transform: translateY(8px); transition: opacity .25s, transform .25s; }

/* ---------- Animations ---------- */
@keyframes mrt-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes mrt-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes mrt-pop { 0% { opacity: 0; transform: scale(.96); } 100% { opacity: 1; transform: none; } }
@keyframes mrt-spin { to { transform: rotate(360deg); } }
@keyframes mrt-pulse { 0% { box-shadow: 0 0 0 0 rgba(29, 122, 62, .5); } 100% { box-shadow: 0 0 0 9px rgba(29, 122, 62, 0); } }
@keyframes mrt-hit { 0% { border-color: #3ddc84; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .45), 0 0 0 6px #3ddc84; } 100% { border-color: rgba(255,255,255,.9); } }
@media (prefers-reduced-motion: reduce) {
  .mrt *, .mrt *::before, .mrt *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}

/* ---------- Adaptation tablette / mobile ---------- */
@media (max-width: 1000px) {
  .mrt-scanner-grid { grid-template-columns: 1fr; }
  .mrt-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mrt-tabs-many .mrt-tab { padding: 14px 10px; }
}
@media (max-width: 720px) {
  .mrt-header { padding: 14px 16px 10px; }
  .mrt-logo svg { height: 20px; }
  .mrt-brand { gap: 10px; }
  .mrt-brand-sep { height: 20px; }
  .mrt-title { font-size: 16px; }
  .mrt-user { padding: 6px 10px; }
  .mrt-user span:not(.mrt-user-name) { display: none; }
  .mrt-user .mrt-user-name { border-left: 0; padding-left: 0; }
  .mrt-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mrt-tabs-many { overflow-x: auto; scrollbar-width: none; }
  .mrt-tabs-many .mrt-tab { flex: 1 0 auto; flex-direction: column; gap: 2px; font-size: 12px; padding: 10px 8px; }
  .mrt-reasons, .mrt-choice-row { grid-template-columns: 1fr; }
  .mrt-agency-filter { min-width: 0; width: 100%; }
  .mrt-login-card { padding: 24px 20px; }
  .mrt-table.mrt-table-admin tr { grid-template-columns: 1fr auto; }
  .mrt-table.mrt-table-admin td { grid-column: 1; font-size: 14px; }
  .mrt-table.mrt-table-admin .mrt-td-actions { grid-column: 2; grid-row: 1 / span 4; align-self: center; }
  .mrt-table.mrt-table-admin td[data-label]::before { content: attr(data-label) " : "; color: #767676; }
  .mrt-table.mrt-table-overview tr { grid-template-columns: repeat(5, minmax(0, 1fr)); row-gap: 8px; }
  .mrt-table.mrt-table-overview td.mrt-td-code, .mrt-table.mrt-table-overview td.mrt-td-today { grid-column: 1 / -1; }
  .mrt-table.mrt-table-overview td.mrt-td-num { text-align: left; width: auto; font-size: 18px; }
  .mrt-table.mrt-table-overview td.mrt-td-num::before {
    content: attr(data-label); display: block; font-size: 11px; font-weight: 400; color: #767676;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .mrt-td-agency::before { content: attr(data-label) " : "; color: #767676; }
  .mrt-td-agency { grid-column: 2 / -1; }
  .mrt-transfer { grid-template-columns: 1fr; }
  .mrt-tabs { padding: 0 8px; }
  .mrt-tab { flex: 1 1 0; justify-content: center; padding: 12px 6px; font-size: 15px; }
  .mrt-main { padding: 16px; }
  .mrt-scan-box { padding: 12px 12px 10px 14px; }
  .mrt-scan-icon { display: none; }
  .mrt-scan-input { font-size: 22px; }
  .mrt-scan-input::placeholder { font-size: 18px; }
  .mrt-cam-btn span { display: none; }
  .mrt-result { padding: 18px; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
  .mrt-result-icon { width: 48px; height: 48px; }
  .mrt-result-icon .mrt-icon { width: 26px; height: 26px; }
  .mrt-result-main { flex: 1 1 calc(100% - 62px); }
  .mrt-result-code { font-size: 28px; }
  .mrt-result .mrt-btn { margin-left: 62px; }
  .mrt-kpis { gap: 10px; }
  .mrt-kpi { padding: 14px; }
  .mrt-kpi-value { font-size: 32px; }
  .mrt-toolbar-actions { width: 100%; }
  .mrt-toolbar-actions .mrt-btn { flex: 1 1 0; }
  .mrt-table thead { display: none; }
  .mrt-table, .mrt-table tbody { display: block; }
  .mrt-table tr {
    display: grid; grid-template-columns: 40px 1fr auto; column-gap: 8px; row-gap: 4px;
    padding: 12px 14px; border-top: 1px solid var(--mrt-grey-100);
  }
  .mrt-table tr:first-child { border-top: 0; }
  .mrt-table td { display: block; padding: 0; border: 0; }
  .mrt-td-check { grid-row: 1 / span 3; padding-top: 2px !important; width: auto; }
  .mrt-td-status { grid-column: 3; grid-row: 1; justify-self: end; }
  .mrt-td-since, .mrt-td-last { grid-column: 2 / -1; font-size: 13px; color: var(--mrt-grey); }
  .mrt-td-since::before, .mrt-td-last::before { content: attr(data-label) " : "; color: #767676; }
  .mrt-backdrop { padding: 0; align-items: flex-end; }
  .mrt-modal { max-height: 92vh; border-radius: var(--mrt-radius-lg) var(--mrt-radius-lg) 0 0; }
  .mrt-modal-body { padding: 8px 18px 22px; }
  .mrt-modal-head { padding: 14px 12px 4px 18px; }
  .mrt-modal-foot { padding: 14px 18px; padding-bottom: max(14px, env(safe-area-inset-bottom)); }
  .mrt-modal-foot .mrt-btn { flex: 1 1 0; }
  .mrt-form-row, .mrt-detail-top, .mrt-detail-cols { grid-template-columns: 1fr; }
  .mrt-history-item { grid-template-columns: 44px 1fr; padding: 10px 16px; }
  .mrt-history-item > * { grid-column: 2; }
  .mrt-result-actions { margin-left: 62px; justify-content: flex-start; }
  .mrt-result .mrt-result-actions .mrt-btn { margin-left: 0; }
  .mrt-history-time { grid-column: 1; grid-row: 1 / span 4; align-self: start; }
  .mrt-history-day { padding: 16px 16px 6px; }
}
`;

export const APP_CSS: string = GEBAUER_FONT_FACES + '\n' + CSS;

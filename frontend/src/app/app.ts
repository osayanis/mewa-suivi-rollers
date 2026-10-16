// Application « Suivi des rollers » : en-tête, onglets, réglages et code d'accès.

import { ApiClient } from './api';
import { MEWA_LOGO_SVG } from './brand/logo';
import { clear, h, icon } from './dom';
import { APP_CSS } from './styles';
import { createModal, createToaster, field, IAppContext, IPrefs, IView } from './ui';
import { createHistoryView } from './views/history';
import { createRollersView } from './views/rollers';
import { createScannerView } from './views/scanner';

type TabId = 'scanner' | 'rollers' | 'history';

const PREFS_KEY = 'mewa-roller-tracker:prefs';

function loadPrefs(): IPrefs {
  const defaults: IPrefs = { sound: true, labelFormat: 'single', accessCode: '' };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<IPrefs>) } : defaults;
  } catch {
    return defaults;
  }
}

export function mountRollerApp(host: HTMLElement): void {
  const style = document.createElement('style');
  style.textContent = APP_CSS;
  document.head.appendChild(style);
  clear(host);

  const prefs = loadPrefs();
  const listeners = new Set<() => void>();
  const root = h('div', { className: 'mrt' });
  const savePrefs = (): void => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* stockage indisponible : préférences non conservées */
    }
  };

  // Une seule fenêtre de saisie du code d'accès, même si plusieurs requêtes échouent en même temps.
  let pendingAccessCode: Promise<boolean> | undefined;
  const requestAccessCode = (invalid: boolean): Promise<boolean> => {
    if (!pendingAccessCode) {
      pendingAccessCode = askAccessCode(invalid).finally(() => {
        pendingAccessCode = undefined;
      });
    }
    return pendingAccessCode;
  };

  const api = new ApiClient({ getAccessCode: () => prefs.accessCode, requestAccessCode });

  const ctx: IAppContext = {
    api,
    root,
    prefs,
    savePrefs,
    toast: () => undefined,
    openModal: (o) => createModal(root, o),
    notifyChanged: () => listeners.forEach((l) => l()),
    onChanged: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    showRoller: () => undefined,
  };

  // ---------- En-tête ----------
  // Nom du poste (ex. « GS75 Toussieu », réglé côté serveur) ; un clic ouvre les réglages.
  const stationName = h('span', null, 'Poste');
  const stationChip = h(
    'button',
    { type: 'button', className: 'mrt-user', title: 'Réglages', onClick: () => openSettings() },
    icon('home'),
    stationName,
  );

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'scanner', label: 'Scanner', icon: 'scan' },
    { id: 'rollers', label: 'Rollers', icon: 'list' },
    { id: 'history', label: 'Historique', icon: 'history' },
  ];
  const tabButtons = new Map<TabId, HTMLButtonElement>();
  const nav = h('nav', { className: 'mrt-tabs', role: 'tablist', 'aria-label': 'Navigation' });
  tabs.forEach((t) => {
    const btn = h(
      'button',
      { type: 'button', role: 'tab', className: 'mrt-tab', onClick: () => switchTab(t.id) },
      icon(t.icon),
      h('span', null, t.label),
    );
    tabButtons.set(t.id, btn);
    nav.appendChild(btn);
  });

  const header = h(
    'header',
    { className: 'mrt-header' },
    h(
      'div',
      { className: 'mrt-brand' },
      h('span', { className: 'mrt-logo', html: MEWA_LOGO_SVG }),
      h('span', { className: 'mrt-brand-sep' }),
      h('span', { className: 'mrt-title' }, 'Suivi des rollers'),
    ),
    stationChip,
  );

  const main = h('main', { className: 'mrt-main' });
  root.append(header, nav, main);
  host.appendChild(root);
  ctx.toast = createToaster(root);

  // ---------- Vues ----------
  const scannerView = createScannerView(ctx);
  const rollersView = createRollersView(ctx);
  const historyView = createHistoryView(ctx);
  const views: Record<TabId, IView> = { scanner: scannerView, rollers: rollersView, history: historyView };
  let current: TabId | undefined;

  function switchTab(id: TabId): void {
    if (current === id) return;
    if (current) views[current].deactivate();
    current = id;
    tabButtons.forEach((btn, key) => {
      btn.classList.toggle('mrt-tab-active', key === id);
      btn.setAttribute('aria-selected', String(key === id));
    });
    clear(main);
    main.appendChild(views[id].el);
    views[id].activate();
  }

  // Ouvrir une fiche roller depuis un autre onglet bascule sur « Rollers ».
  ctx.showRoller = (code: string) => {
    switchTab('rollers');
    rollersView.showRoller(code);
  };

  // ---------- Code d'accès ----------
  function askAccessCode(invalid: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      let accepted = false;
      let close: () => void = () => undefined;
      const input = h('input', {
        type: 'password',
        className: 'mrt-input',
        autocomplete: 'current-password',
        maxLength: 100,
      });
      const error = h('p', { className: 'mrt-form-error', role: 'alert' }, invalid ? 'Code incorrect, réessayez.' : '');
      const form = h(
        'form',
        {
          className: 'mrt-form',
          onSubmit: (e: Event) => {
            e.preventDefault();
            const code = input.value.trim();
            if (!code) {
              error.textContent = 'Saisissez le code d’accès.';
              input.focus();
              return;
            }
            prefs.accessCode = code;
            savePrefs();
            accepted = true;
            close();
          },
        },
        field("Code d'accès", input, 'Communiqué par votre responsable. Il est demandé une seule fois sur cet appareil.'),
        error,
        h('div', { className: 'mrt-form-actions' }, h('button', { type: 'submit', className: 'mrt-btn mrt-btn-primary' }, 'Valider')),
      );
      close = ctx.openModal({ title: 'Accès protégé', body: form, onClose: () => resolve(accepted) });
    });
  }

  // ---------- Réglages ----------
  function openSettings(): void {
    let close: () => void = () => undefined;
    const sound = h('input', { type: 'checkbox', className: 'mrt-check', checked: prefs.sound });
    const form = h(
      'form',
      {
        className: 'mrt-form',
        onSubmit: (e: Event) => {
          e.preventDefault();
          prefs.sound = sound.checked;
          savePrefs();
          close();
        },
      },
      h('label', { className: 'mrt-toggle' }, sound, h('span', null, 'Bip sonore après chaque scan')),
      h('div', { className: 'mrt-form-actions' }, h('button', { type: 'submit', className: 'mrt-btn mrt-btn-primary' }, 'Valider')),
    );
    close = ctx.openModal({ title: 'Réglages', body: form });
  }

  api
    .info()
    .then((info) => {
      stationName.textContent = info.station;
    })
    .catch(() => undefined);
  switchTab('scanner');
}

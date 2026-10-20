// Application « Suivi des rollers » : connexion, puis en-tête, onglets et menu du compte.
// - Compte d'agence : Scanner, Rollers, Historique (sa propre agence uniquement).
// - Administrateur : Supervision, Rollers, Historique (toutes les agences), Agences, Utilisateurs.

import { ApiClient, IServerInfo, IUser } from './api';
import { MEWA_LOGO_SVG } from './brand/logo';
import { clear, h, icon } from './dom';
import { APP_CSS } from './styles';
import { createModal, createToaster, IAppContext, IPrefs, IView } from './ui';
import { createAgenciesView } from './views/agencies';
import { createHistoryView } from './views/history';
import { createLoginScreen, createPasswordChangeScreen, passwordChangeForm } from './views/login';
import { createOverviewView } from './views/overview';
import { createRollersView } from './views/rollers';
import { createScannerView } from './views/scanner';
import { createUsersView } from './views/users';

type TabId = 'overview' | 'scanner' | 'rollers' | 'history' | 'agencies' | 'users';

const PREFS_KEY = 'mewa-roller-tracker:prefs';

const DEFAULT_INFO: IServerInfo = {
  codePrefix: 'ROL',
  codeDigits: 6,
  overdueDays: 14,
  maintenanceReasons: [
    { id: 'paroi', label: 'Paroi' },
    { id: 'roulettes', label: 'Roulettes' },
    { id: 'plateaux', label: 'Plateaux' },
  ],
};

function loadPrefs(): IPrefs {
  const defaults: IPrefs = { sound: true, labelFormat: 'single' };
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
  const root = h('div', { className: 'mrt' });
  host.appendChild(root);
  const savePrefs = (): void => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* stockage indisponible : préférences non conservées */
    }
  };

  // Application en cours (après connexion) : arrêtée quand la session est perdue.
  let disposeApp: (() => void) | undefined;

  const api = new ApiClient({
    onSessionLost: () => {
      if (!disposeApp) return;
      showLogin('Votre session a expiré. Reconnectez-vous.');
    },
  });

  function showScreen(el: HTMLElement): void {
    if (disposeApp) disposeApp();
    disposeApp = undefined;
    clear(root);
    root.appendChild(el);
  }

  function showLogin(notice?: string): void {
    showScreen(createLoginScreen(api, onAuthenticated, notice));
  }

  function logout(): void {
    api
      .logout()
      .catch(() => undefined)
      .finally(() => showLogin());
  }

  function onAuthenticated(user: IUser): void {
    if (user.mustChangePassword) {
      showScreen(createPasswordChangeScreen(api, user, onAuthenticated, logout));
      return;
    }
    startApp(user).catch(() => showLogin('Chargement impossible. Vérifiez la connexion puis reconnectez-vous.'));
  }

  async function startApp(user: IUser): Promise<void> {
    const isAdmin = user.role === 'admin';
    const [info, agencies] = await Promise.all([
      api.info().catch(() => DEFAULT_INFO),
      isAdmin ? api.agencies() : Promise.resolve([]),
    ]);
    showScreen(h('div', null));
    disposeApp = mountShell(user, info, agencies);
  }

  function mountShell(user: IUser, info: IServerInfo, agencies: IAppContext['agencies']): () => void {
    clear(root);
    const listeners = new Set<() => void>();
    const isAdmin = user.role === 'admin';

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
      user,
      isAdmin,
      info,
      agencies,
      reloadAgencies: async () => {
        ctx.agencies = await api.agencies();
      },
      agencyFilter: null,
      setAgencyFilter: (id) => {
        if (ctx.agencyFilter === id) return;
        ctx.agencyFilter = id;
        ctx.notifyChanged();
      },
      showAgency: () => undefined,
    };

    // ---------- En-tête ----------
    // Agence (ou « Administration ») et identifiant ; un clic ouvre le menu du compte.
    const accountChip = h(
      'button',
      { type: 'button', className: 'mrt-user', title: 'Mon compte', onClick: () => openAccount() },
      icon(isAdmin ? 'shield' : 'home'),
      h('span', null, isAdmin ? 'Administration' : user.agency?.name ?? ''),
      h('span', { className: 'mrt-user-name' }, user.username),
    );

    const tabs: { id: TabId; label: string; icon: string }[] = isAdmin
      ? [
          { id: 'overview', label: 'Supervision', icon: 'chart' },
          { id: 'rollers', label: 'Rollers', icon: 'list' },
          { id: 'history', label: 'Historique', icon: 'history' },
          { id: 'agencies', label: 'Agences', icon: 'building' },
          { id: 'users', label: 'Utilisateurs', icon: 'users' },
        ]
      : [
          { id: 'scanner', label: 'Scanner', icon: 'scan' },
          { id: 'rollers', label: 'Rollers', icon: 'list' },
          { id: 'history', label: 'Historique', icon: 'history' },
        ];
    const tabButtons = new Map<TabId, HTMLButtonElement>();
    const nav = h('nav', { className: `mrt-tabs${tabs.length > 3 ? ' mrt-tabs-many' : ''}`, role: 'tablist', 'aria-label': 'Navigation' });
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
      accountChip,
    );

    const main = h('main', { className: 'mrt-main' });
    root.append(header, nav, main);
    ctx.toast = createToaster(root);

    // ---------- Vues ----------
    const rollersView = createRollersView(ctx);
    const views: Partial<Record<TabId, IView>> = {
      rollers: rollersView,
      history: createHistoryView(ctx),
    };
    if (isAdmin) {
      views.overview = createOverviewView(ctx);
      views.agencies = createAgenciesView(ctx);
      views.users = createUsersView(ctx);
    } else {
      views.scanner = createScannerView(ctx);
    }
    let current: TabId | undefined;

    function switchTab(id: TabId): void {
      const view = views[id];
      if (!view || current === id) return;
      if (current) views[current]?.deactivate();
      current = id;
      tabButtons.forEach((btn, key) => {
        btn.classList.toggle('mrt-tab-active', key === id);
        btn.setAttribute('aria-selected', String(key === id));
      });
      clear(main);
      main.appendChild(view.el);
      view.activate();
    }

    // Ouvrir une fiche roller depuis un autre onglet bascule sur « Rollers ».
    ctx.showRoller = (code: string) => {
      switchTab('rollers');
      rollersView.showRoller(code);
    };
    ctx.showAgency = (id: number) => {
      ctx.setAgencyFilter(id);
      switchTab('rollers');
    };

    // ---------- Menu du compte ----------
    function openAccount(): void {
      let close: () => void = () => undefined;
      const sound = h('input', {
        type: 'checkbox',
        className: 'mrt-check',
        checked: prefs.sound,
        onChange: () => {
          prefs.sound = sound.checked;
          savePrefs();
        },
      });
      const body = h(
        'div',
        { className: 'mrt-account' },
        h(
          'div',
          { className: 'mrt-account-id' },
          h('span', { className: 'mrt-account-avatar' }, icon(isAdmin ? 'shield' : 'user')),
          h(
            'div',
            null,
            h('p', { className: 'mrt-account-name' }, user.username),
            h('p', { className: 'mrt-sub' }, isAdmin ? 'Administrateur · toutes les agences' : `Agence ${user.agency?.name ?? ''}`),
          ),
        ),
        isAdmin ? null : h('label', { className: 'mrt-toggle' }, sound, h('span', null, 'Bip sonore après chaque scan')),
        h(
          'div',
          { className: 'mrt-account-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'mrt-btn mrt-btn-secondary',
              onClick: () => {
                close();
                openPasswordChange();
              },
            },
            icon('key'),
            'Changer mon mot de passe',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'mrt-btn mrt-btn-primary',
              onClick: () => {
                close();
                logout();
              },
            },
            icon('logout'),
            'Se déconnecter',
          ),
        ),
      );
      close = ctx.openModal({ title: 'Mon compte', body });
    }

    function openPasswordChange(): void {
      let close: () => void = () => undefined;
      const form = passwordChangeForm(
        api,
        () => {
          close();
          ctx.toast('Mot de passe modifié.', 'success');
        },
        { onCancel: () => close() },
      );
      close = ctx.openModal({ title: 'Changer mon mot de passe', body: form });
    }

    switchTab(isAdmin ? 'overview' : 'scanner');

    return () => {
      Object.keys(views).forEach((k) => views[k as TabId]?.dispose());
      listeners.clear();
    };
  }

  // ---------- Démarrage ----------
  root.appendChild(h('div', { className: 'mrt-login' }, h('span', { className: 'mrt-spinner' })));
  api
    .me()
    .then((user) => (user ? onAuthenticated(user) : showLogin()))
    .catch((err: unknown) => showLogin(err instanceof Error ? err.message : undefined));
}

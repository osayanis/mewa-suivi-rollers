import type { ApiClient, IAgency, IRoller, IServerInfo, IUser } from './api';
import { Child, clear, h, icon } from './dom';
import { formatDuration } from './format';
import type { LabelFormat } from './labels';

export interface IPrefs {
  sound: boolean;
  labelFormat: LabelFormat;
}

export interface IAppContext {
  api: ApiClient;
  /** Élément racine de l'application (les modales y sont ajoutées). */
  root: HTMLElement;
  prefs: IPrefs;
  savePrefs(): void;
  toast(message: string, kind?: 'success' | 'error' | 'info'): void;
  openModal(options: IModalOptions): () => void;
  /** Signale un changement de données pour rafraîchir les autres onglets. */
  notifyChanged(): void;
  onChanged(listener: () => void): () => void;
  /** Affiche la fiche d'un roller (onglet Rollers). */
  showRoller(code: string): void;
  /** Utilisateur connecté. */
  user: IUser;
  isAdmin: boolean;
  /** Format des codes, délai de retard, raisons de maintenance (lus sur le serveur). */
  info: IServerInfo;
  /** Administrateur : liste des agences (pour les filtres et formulaires). */
  agencies: IAgency[];
  reloadAgencies(): Promise<void>;
  /** Administrateur : agence affichée dans Rollers et Historique (`null` = toutes). */
  agencyFilter: number | null;
  setAgencyFilter(id: number | null): void;
  /** Administrateur : ouvre l'onglet Rollers sur une agence. */
  showAgency(id: number): void;
}

export interface IView {
  el: HTMLElement;
  activate(): void;
  deactivate(): void;
  dispose(): void;
}

export interface IModalOptions {
  title: string;
  body: Child;
  footer?: Child;
  wide?: boolean;
  onClose?: () => void;
}

export function createModal(root: HTMLElement, options: IModalOptions): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  let close: () => void = () => undefined;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const dialog = h(
    'div',
    {
      className: `mrt-modal${options.wide ? ' mrt-modal-wide' : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.title,
    },
    h(
      'div',
      { className: 'mrt-modal-head' },
      h('h2', null, options.title),
      h('button', { type: 'button', className: 'mrt-icon-btn', 'aria-label': 'Fermer', onClick: () => close() }, icon('close')),
    ),
    h('div', { className: 'mrt-modal-body' }, options.body),
    options.footer ? h('div', { className: 'mrt-modal-foot' }, options.footer) : null,
  );
  const backdrop = h(
    'div',
    {
      className: 'mrt-backdrop',
      onMousedown: (e: MouseEvent) => {
        if (e.target === backdrop) close();
      },
    },
    dialog,
  );
  let closed = false;
  close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    if (options.onClose) options.onClose();
    if (previouslyFocused && document.body.contains(previouslyFocused)) previouslyFocused.focus();
  };
  root.appendChild(backdrop);
  document.addEventListener('keydown', onKey, true);
  const firstField = dialog.querySelector<HTMLElement>('input, select, textarea, .mrt-btn-primary');
  (firstField ?? dialog.querySelector<HTMLElement>('button'))?.focus();
  return close;
}

export function createToaster(root: HTMLElement): (message: string, kind?: 'success' | 'error' | 'info') => void {
  const region = h('div', { className: 'mrt-toasts', role: 'status', 'aria-live': 'polite' });
  root.appendChild(region);
  return (message, kind = 'info') => {
    const el = h(
      'div',
      { className: `mrt-toast mrt-toast-${kind}` },
      icon(kind === 'success' ? 'check' : kind === 'error' ? 'alert' : 'info'),
      h('span', null, message),
    );
    region.appendChild(el);
    window.setTimeout(() => {
      el.classList.add('mrt-toast-out');
      window.setTimeout(() => el.remove(), 250);
    }, kind === 'error' ? 6000 : 3500);
  };
}

export function statusBadge(roller: IRoller): HTMLElement {
  if (roller.archived) return h('span', { className: 'mrt-badge mrt-badge-archived' }, 'Archivé');
  if (roller.status === 'maintenance') {
    return h('span', { className: 'mrt-badge mrt-badge-maintenance' }, icon('wrench'), 'Maintenance');
  }
  if (roller.status === 'on_site') {
    return h('span', { className: 'mrt-badge mrt-badge-onsite' }, icon('home'), 'Sur site');
  }
  if (roller.overdue) {
    return h('span', { className: 'mrt-badge mrt-badge-overdue' }, icon('clock'), 'En retard');
  }
  return h('span', { className: 'mrt-badge mrt-badge-transit' }, icon('truck'), 'En transit');
}

export function sinceText(roller: IRoller): string {
  if (roller.status === 'maintenance') return formatDuration(secondsSince(roller.maintenanceSince));
  if (!roller.lastMovementAt) return 'Jamais sorti';
  return formatDuration(roller.sinceSeconds);
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || `mrt-f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h(
    'div',
    { className: 'mrt-field' },
    h('label', { htmlFor: id }, label),
    control,
    hint ? h('p', { className: 'mrt-hint' }, hint) : null,
  );
}

export function emptyState(title: string, text: string, action?: HTMLElement): HTMLElement {
  return h('div', { className: 'mrt-empty' }, h('p', { className: 'mrt-empty-title' }, title), h('p', null, text), action);
}

/** Lance une promesse sans l'attendre (les erreurs sont gérées par l'appelé). */
export function fire(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

export function spinner(): HTMLElement {
  return h('div', { className: 'mrt-loading', role: 'status' }, h('span', { className: 'mrt-spinner' }), 'Chargement…');
}

function secondsSince(iso: string | null): number | null {
  return iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)) : null;
}

/** « Roulettes, Plateaux » */
export function reasonsText(ids: string[], info: IServerInfo): string {
  return info.maintenanceReasons
    .filter((r) => ids.indexOf(r.id) >= 0)
    .map((r) => r.label)
    .join(', ');
}

/** Fenêtre de confirmation (remplace window.confirm, qui bloque la page). */
export function confirmDialog(
  ctx: IAppContext,
  options: { title: string; message: Child; confirmLabel: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    let close: () => void = () => undefined;
    close = ctx.openModal({
      title: options.title,
      body: h('div', { className: 'mrt-confirm' }, options.message),
      footer: [
        h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => close() }, 'Annuler'),
        h(
          'button',
          {
            type: 'button',
            className: `mrt-btn ${options.danger ? 'mrt-btn-danger' : 'mrt-btn-primary'}`,
            onClick: () => {
              confirmed = true;
              close();
            },
          },
          options.confirmLabel,
        ),
      ],
      onClose: () => resolve(confirmed),
    });
  });
}

/** Liste déroulante des agences. `allLabel` ajoute un choix « toutes les agences » (valeur vide). */
export function agencySelect(agencies: IAgency[], selected: number | null, allLabel?: string): HTMLSelectElement {
  const select = h('select', { className: 'mrt-input mrt-select' });
  fillAgencySelect(select, agencies, selected, allLabel);
  return select;
}

export function fillAgencySelect(select: HTMLSelectElement, agencies: IAgency[], selected: number | null, allLabel?: string): void {
  clear(select);
  if (allLabel) select.appendChild(h('option', { value: '' }, allLabel));
  else if (selected === null) select.appendChild(h('option', { value: '', disabled: true }, 'Choisir une agence…'));
  agencies.forEach((a) => select.appendChild(h('option', { value: String(a.id) }, a.name)));
  select.value = selected === null ? '' : String(selected);
}

export function selectedAgency(select: HTMLSelectElement): number | null {
  return select.value ? Number(select.value) : null;
}

/** Filtre « agence » des administrateurs, partagé entre les onglets Rollers et Historique. */
export function agencyFilter(ctx: IAppContext): { el: HTMLElement; sync(): void } {
  const select = agencySelect(ctx.agencies, ctx.agencyFilter, 'Toutes les agences');
  select.setAttribute('aria-label', 'Agence');
  select.addEventListener('change', () => ctx.setAgencyFilter(selectedAgency(select)));
  return {
    el: h('div', { className: 'mrt-agency-filter' }, icon('building'), select),
    sync: () => fillAgencySelect(select, ctx.agencies, ctx.agencyFilter, 'Toutes les agences'),
  };
}

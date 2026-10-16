import type { ApiClient, IRoller } from './api';
import { Child, h, icon } from './dom';
import { formatDuration } from './format';
import type { LabelFormat } from './labels';

export interface IPrefs {
  sound: boolean;
  labelFormat: LabelFormat;
  accessCode: string;
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
  if (roller.status === 'on_site') {
    return h('span', { className: 'mrt-badge mrt-badge-onsite' }, icon('home'), 'Sur site');
  }
  if (roller.overdue) {
    return h('span', { className: 'mrt-badge mrt-badge-overdue' }, icon('clock'), 'En retard');
  }
  return h('span', { className: 'mrt-badge mrt-badge-transit' }, icon('truck'), 'En transit');
}

export function sinceText(roller: IRoller): string {
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

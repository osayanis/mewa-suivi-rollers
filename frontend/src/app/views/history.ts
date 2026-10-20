// Écran « Historique » : journal de tous les mouvements, avec export Excel (CSV).

import type { IMovement } from '../api';
import { clear, h, icon } from '../dom';
import { formatDay, formatTime, startOfDay } from '../format';
import { agencyFilter, emptyState, fire, IAppContext, IView, reasonsText, spinner } from '../ui';

const KINDS: Record<IMovement['kind'], { label: string; icon: string }> = {
  out: { label: 'Départ', icon: 'out' },
  in: { label: 'Retour', icon: 'in' },
  maintenance_start: { label: 'Maintenance', icon: 'wrench' },
  maintenance_end: { label: 'Réparé', icon: 'check' },
};

const PERIODS: { id: string; label: string; daysAgo: number | null }[] = [
  { id: 'today', label: "Aujourd'hui", daysAgo: 0 },
  { id: '7d', label: '7 jours', daysAgo: 6 },
  { id: '30d', label: '30 jours', daysAgo: 29 },
  { id: 'all', label: 'Tout', daysAgo: null },
];
const PAGE = 300;

export function createHistoryView(ctx: IAppContext): IView {
  let period = '7d';
  let filterText = '';
  let movements: IMovement[] = [];
  let hasMore = false;
  let active = false;
  let stale = true;
  let token = 0;

  const fromIso = (): string | undefined => {
    const p = PERIODS.filter((x) => x.id === period)[0];
    return p.daysAgo === null ? undefined : startOfDay(p.daysAgo);
  };

  const periodBar = h('div', { className: 'mrt-chips', role: 'group', 'aria-label': 'Période' });
  function renderPeriods(): void {
    clear(periodBar);
    PERIODS.forEach((p) =>
      periodBar.appendChild(
        h(
          'button',
          {
            type: 'button',
            className: `mrt-chip${period === p.id ? ' mrt-chip-active' : ''}`,
            'aria-pressed': String(period === p.id),
            onClick: () => {
              period = p.id;
              renderPeriods();
              fire(load());
            },
          },
          p.label,
        ),
      ),
    );
  }

  const search = h('input', {
    type: 'search',
    className: 'mrt-input mrt-search-input',
    placeholder: 'Filtrer par code, libellé ou utilisateur…',
    'aria-label': 'Filtrer',
    onInput: () => {
      filterText = search.value.trim().toLowerCase();
      render();
    },
  });

  const exportBtn = h(
    'button',
    {
      type: 'button',
      className: 'mrt-btn mrt-btn-secondary',
      onClick: () => {
        exportBtn.disabled = true;
        ctx.api
          .exportMovementsCsv(fromIso(), ctx.agencyFilter)
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            const a = h('a', { href: url, download: `mouvements-rollers-${new Date().toISOString().slice(0, 10)}.csv` });
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 5000);
          })
          .catch((err: unknown) => ctx.toast(err instanceof Error ? err.message : 'Export impossible.', 'error'))
          .finally(() => {
            exportBtn.disabled = false;
          });
      },
    },
    icon('download'),
    'Exporter (Excel)',
  );

  const listHost = h('div', { className: 'mrt-history' });

  function matches(m: IMovement): boolean {
    if (!filterText) return true;
    return [m.code, m.label, m.agent, m.agency.name].some((v) => (v ?? '').toLowerCase().indexOf(filterText) >= 0);
  }

  function render(): void {
    clear(listHost);
    const visible = movements.filter(matches);
    if (visible.length === 0) {
      listHost.appendChild(emptyState('Aucun mouvement', 'Aucun scan sur cette période.'));
      return;
    }
    let currentDay = '';
    let group = h('ul', { className: 'mrt-history-list' });
    for (const m of visible) {
      const day = formatDay(m.scannedAt);
      if (day !== currentDay) {
        currentDay = day;
        group = h('ul', { className: 'mrt-history-list' });
        listHost.append(h('h3', { className: 'mrt-history-day' }, day), group);
      }
      group.appendChild(
        h(
          'li',
          { className: `mrt-history-item${m.cancelled ? ' mrt-cancelled' : ''}` },
          h('span', { className: 'mrt-history-time' }, formatTime(m.scannedAt)),
          h('span', { className: `mrt-dir mrt-dir-${m.kind}` }, icon(KINDS[m.kind].icon), KINDS[m.kind].label),
          h(
            'span',
            { className: 'mrt-history-roller' },
            h('button', { type: 'button', className: 'mrt-link mrt-code', onClick: () => ctx.showRoller(m.code) }, m.code),
            m.label ? h('span', { className: 'mrt-sub' }, m.label) : null,
            m.reasons.length ? h('span', { className: 'mrt-sub' }, `À réparer : ${reasonsText(m.reasons, ctx.info)}`) : null,
          ),
          h(
            'span',
            { className: 'mrt-history-who' },
            m.agent ?? '',
            ctx.isAdmin && ctx.agencyFilter === null ? h('span', { className: 'mrt-sub' }, m.agency.name) : null,
          ),
          h(
            'span',
            { className: 'mrt-history-state' },
            m.cancelled ? h('span', { className: 'mrt-badge mrt-badge-archived' }, 'Annulé') : null,
          ),
        ),
      );
    }
    if (hasMore) {
      const more = h(
        'button',
        {
          type: 'button',
          className: 'mrt-btn mrt-btn-secondary mrt-more',
          onClick: () => {
            more.disabled = true;
            fire(load(true));
          },
        },
        'Afficher plus',
      );
      listHost.appendChild(more);
    }
  }

  function applyPage(page: IMovement[], append: boolean): void {
    movements = append ? movements.concat(page) : page;
    hasMore = page.length === PAGE;
    stale = false;
    render();
  }

  async function load(append = false): Promise<void> {
    const t = ++token;
    if (!append) {
      clear(listHost);
      listHost.appendChild(spinner());
    }
    try {
      const before = append && movements.length ? movements[movements.length - 1].id : undefined;
      const page = await ctx.api.movements({ from: fromIso(), limit: PAGE, before, agency: ctx.agencyFilter });
      if (t !== token) return;
      applyPage(page, append);
    } catch (err) {
      if (t !== token) return;
      clear(listHost);
      listHost.appendChild(emptyState('Chargement impossible', err instanceof Error ? err.message : ''));
    }
  }

  const agencyPicker = ctx.isAdmin ? agencyFilter(ctx) : undefined;
  const root = h(
    'div',
    { className: 'mrt-view mrt-history-view' },
    agencyPicker ? h('div', { className: 'mrt-view-head' }, agencyPicker.el) : null,
    h(
      'div',
      { className: 'mrt-toolbar' },
      h('div', { className: 'mrt-search' }, icon('search'), search),
      h('div', { className: 'mrt-toolbar-actions' }, exportBtn),
    ),
    periodBar,
    h('div', { className: 'mrt-card' }, listHost),
  );

  const unsubscribe = ctx.onChanged(() => {
    stale = true;
    if (active) fire(load());
  });
  renderPeriods();

  return {
    el: root,
    activate() {
      active = true;
      if (agencyPicker) agencyPicker.sync();
      if (stale) fire(load());
    },
    deactivate() {
      active = false;
    },
    dispose() {
      unsubscribe();
    },
  };
}

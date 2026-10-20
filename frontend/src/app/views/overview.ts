// Administrateur — « Supervision » : état du parc de chaque agence en un coup d'œil.

import type { IOverview, IStats } from '../api';
import { clear, h, icon } from '../dom';
import { emptyState, fire, IAppContext, IView, spinner } from '../ui';

export function createOverviewView(ctx: IAppContext): IView {
  let data: IOverview | undefined;
  let active = false;
  let token = 0;
  let pollTimer: number | undefined;

  const kpis = h('div', { className: 'mrt-kpis mrt-kpis-static' });
  const tableHost = h('div', { className: 'mrt-card mrt-list-card' });

  function kpi(value: number, label: string, tone: string, iconName: string): HTMLElement {
    return h(
      'div',
      { className: `mrt-kpi mrt-kpi-${tone}` },
      h('span', { className: 'mrt-kpi-head' }, icon(iconName), label),
      h('span', { className: 'mrt-kpi-value' }, String(value)),
    );
  }

  function renderKpis(t: IStats): void {
    clear(kpis);
    kpis.append(
      kpi(t.onSite, 'Sur site', 'onsite', 'home'),
      kpi(t.inTransit, 'En transit', 'transit', 'truck'),
      kpi(t.overdue, `En retard (> ${t.overdueDays} j)`, 'overdue', 'clock'),
      kpi(t.maintenance, 'En maintenance', 'maintenance', 'wrench'),
      kpi(t.total, 'Total du parc', 'total', 'list'),
    );
  }

  // Cellule chiffrée : grisée à zéro pour que les problèmes ressortent.
  const num = (value: number, label: string, tone?: string): HTMLElement =>
    h(
      'td',
      { className: `mrt-td-num${value === 0 ? ' mrt-muted' : tone ? ` mrt-num-${tone}` : ''}`, 'data-label': label },
      String(value),
    );

  function renderTable(o: IOverview): void {
    clear(tableHost);
    if (o.agencies.length === 0) {
      tableHost.appendChild(emptyState('Aucune agence', 'Créez une agence dans l’onglet Agences.'));
      return;
    }
    const tbody = h('tbody', null);
    for (const a of o.agencies) {
      tbody.appendChild(
        h(
          'tr',
          {
            className: `mrt-row${a.overdue ? ' mrt-row-overdue' : ''}`,
            title: `Voir les rollers de ${a.agency.name}`,
            onClick: () => ctx.showAgency(a.agency.id),
          },
          h(
            'td',
            { className: 'mrt-td-code' },
            h('span', { className: 'mrt-code' }, a.agency.code),
            h('span', { className: 'mrt-sub' }, a.agency.city || 'Ville à renseigner'),
          ),
          num(a.onSite, 'Sur site', 'onsite'),
          num(a.inTransit, 'En transit', 'transit'),
          num(a.overdue, 'En retard', 'overdue'),
          num(a.maintenance, 'Maintenance', 'maintenance'),
          num(a.total, 'Total'),
          h(
            'td',
            { className: 'mrt-td-today' },
            h('span', { title: "Départs aujourd'hui" }, icon('out'), String(a.outToday)),
            h('span', { title: "Retours aujourd'hui" }, icon('in'), String(a.inToday)),
          ),
        ),
      );
    }
    tableHost.appendChild(
      h(
        'table',
        { className: 'mrt-table mrt-table-overview' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', null, 'Agence'),
            h('th', { className: 'mrt-td-num' }, 'Sur site'),
            h('th', { className: 'mrt-td-num' }, 'En transit'),
            h('th', { className: 'mrt-td-num' }, 'En retard'),
            h('th', { className: 'mrt-td-num' }, 'Maintenance'),
            h('th', { className: 'mrt-td-num' }, 'Total'),
            h('th', null, "Aujourd'hui"),
          ),
        ),
        tbody,
      ),
    );
  }

  async function load(): Promise<void> {
    const t = ++token;
    if (!data) {
      clear(tableHost);
      tableHost.appendChild(spinner());
    }
    try {
      const o = await ctx.api.overview();
      if (t !== token) return;
      data = o;
      renderKpis(o.totals);
      renderTable(o);
    } catch (err) {
      if (t !== token) return;
      clear(tableHost);
      tableHost.appendChild(
        emptyState(
          'Chargement impossible',
          err instanceof Error ? err.message : '',
          h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => fire(load()) }, icon('refresh'), 'Réessayer'),
        ),
      );
    }
  }

  const root = h(
    'div',
    { className: 'mrt-view mrt-overview' },
    h(
      'div',
      { className: 'mrt-view-head' },
      h('h2', { className: 'mrt-view-title' }, 'Toutes les agences'),
      h('p', { className: 'mrt-hint' }, 'Cliquez sur une agence pour voir ses rollers.'),
    ),
    kpis,
    tableHost,
  );

  const unsubscribe = ctx.onChanged(() => {
    if (active) fire(load());
  });

  return {
    el: root,
    activate() {
      active = true;
      fire(load());
      pollTimer = window.setInterval(() => {
        if (!document.hidden && !ctx.root.querySelector('.mrt-backdrop')) fire(load());
      }, 30_000);
    },
    deactivate() {
      active = false;
      window.clearInterval(pollTimer);
    },
    dispose() {
      active = false;
      window.clearInterval(pollTimer);
      unsubscribe();
    },
  };
}

// Administrateur — « Supervision » : l'état du parc de toutes les agences en un coup d'œil.
// - Répartition du parc (barre empilée : sur site / en transit / en retard / en maintenance)
// - Activité des 14 derniers jours (départs et retours par jour)
// - Rollers en retard, les plus anciens d'abord
// - Une carte par agence, avec sa propre répartition

import type { IAgencyStats, IDayActivity, IOverview, IRoller, IStats } from '../api';
import { clear, h, icon } from '../dom';
import { formatDuration, plural } from '../format';
import { emptyState, fire, IAppContext, IView, spinner } from '../ui';

// Les quatre états d'un roller : couleur (contrôlée daltonisme), libellé, explication au survol.
// Les segments d'une barre se partagent le parc : « En transit » = depuis moins de 14 jours, « En retard » = au-delà.
type Segment = 'onsite' | 'transit' | 'overdue' | 'maintenance';
const SEGMENTS: { id: Segment; label: string; hint: (days: number) => string }[] = [
  { id: 'onsite', label: 'Sur site', hint: () => 'Disponibles sur site' },
  { id: 'transit', label: 'En transit', hint: (d) => `Partis depuis moins de ${d} jours` },
  { id: 'overdue', label: 'En retard', hint: (d) => `Partis depuis plus de ${d} jours` },
  { id: 'maintenance', label: 'Maintenance', hint: () => 'En attente de réparation' },
];

function segmentValues(s: Omit<IStats, 'overdueDays'>): Record<Segment, number> {
  return {
    onsite: s.onSite,
    transit: Math.max(0, s.inTransit - s.overdue),
    overdue: s.overdue,
    maintenance: s.maintenance,
  };
}

const pct = (value: number, total: number): string => (total ? `${Math.round((value / total) * 100)} %` : '0 %');

const weekdayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const longDayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const parseDay = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function createOverviewView(ctx: IAppContext): IView {
  let data: IOverview | undefined;
  let active = false;
  let token = 0;
  let pollTimer: number | undefined;

  const body = h('div', { className: 'mrt-sup' });

  // ---------- Infobulle (survol à la souris, appui au doigt) ----------
  const tip = h('div', { className: 'mrt-tip', role: 'tooltip' });
  tip.hidden = true;
  const showTip = (target: HTMLElement): void => {
    const text = target.dataset.tip;
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
    const top = r.top - t.height - 8 < 8 ? r.bottom + 8 : r.top - t.height - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hideTip = (): void => {
    tip.hidden = true;
  };
  const onPointer = (e: PointerEvent): void => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (target && body.contains(target)) showTip(target);
    else hideTip();
  };
  body.addEventListener('pointerover', onPointer);
  body.addEventListener('pointerdown', onPointer);
  body.addEventListener('pointerleave', hideTip);
  window.addEventListener('scroll', hideTip, true);

  // ---------- Barre de répartition ----------
  function stackedBar(s: Omit<IStats, 'overdueDays'>, overdueDays: number, big = false): HTMLElement {
    const values = segmentValues(s);
    const bar = h('div', {
      className: `mrt-stack${big ? ' mrt-stack-big' : ''}`,
      role: 'img',
      'aria-label': SEGMENTS.map((seg) => `${seg.label} : ${values[seg.id]}`).join(', '),
    });
    if (s.total === 0) {
      bar.classList.add('mrt-stack-empty');
      return bar;
    }
    for (const seg of SEGMENTS) {
      const v = values[seg.id];
      if (!v) continue;
      bar.appendChild(
        h('span', {
          className: `mrt-seg mrt-seg-${seg.id}`,
          style: `flex-grow: ${v}`,
          'data-tip': `${seg.label} : ${plural(v, 'roller')} (${pct(v, s.total)}) — ${seg.hint(overdueDays)}`,
        }),
      );
    }
    return bar;
  }

  function legend(s: Omit<IStats, 'overdueDays'>, overdueDays: number, compact = false): HTMLElement {
    const values = segmentValues(s);
    return h(
      'ul',
      { className: `mrt-legend${compact ? ' mrt-legend-compact' : ''}` },
      SEGMENTS.map((seg) =>
        h(
          'li',
          { className: values[seg.id] ? '' : 'mrt-legend-zero', 'data-tip': seg.hint(overdueDays) },
          h('span', { className: `mrt-dot mrt-seg-${seg.id}` }),
          h('span', { className: 'mrt-legend-label' }, seg.label),
          h('strong', { className: 'mrt-legend-value' }, String(values[seg.id])),
          compact ? null : h('span', { className: 'mrt-legend-pct' }, pct(values[seg.id], s.total)),
        ),
      ),
    );
  }

  // ---------- Répartition globale ----------
  function fleetCard(o: IOverview): HTMLElement {
    const t = o.totals;
    return h(
      'section',
      { className: 'mrt-panel mrt-fleet' },
      h(
        'div',
        { className: 'mrt-fleet-head' },
        h(
          'div',
          null,
          h('h3', { className: 'mrt-panel-title' }, 'Répartition du parc'),
          h(
            'p',
            { className: 'mrt-fleet-total' },
            h('strong', null, String(t.total)),
            ` ${t.total > 1 ? 'rollers' : 'roller'} dans ${plural(o.agencies.length, 'agence')}`,
          ),
        ),
        h(
          'div',
          { className: 'mrt-today-chips' },
          h('span', { className: 'mrt-today-chip', 'data-tip': "Départs enregistrés aujourd'hui" }, icon('out'), h('strong', null, String(t.outToday)), t.outToday > 1 ? 'départs' : 'départ'),
          h('span', { className: 'mrt-today-chip', 'data-tip': "Retours enregistrés aujourd'hui" }, icon('in'), h('strong', null, String(t.inToday)), t.inToday > 1 ? 'retours' : 'retour'),
          h('span', { className: 'mrt-today-label' }, "aujourd'hui"),
        ),
      ),
      stackedBar(t, t.overdueDays, true),
      legend(t, t.overdueDays),
    );
  }

  // ---------- Activité des 14 derniers jours ----------
  function niceMax(v: number): number {
    if (v <= 4) return 4;
    const step = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
    return 10 * step;
  }

  function activityCard(days: IDayActivity[]): HTMLElement {
    const max = niceMax(Math.max(0, ...days.map((d) => Math.max(d.out, d.in))));
    const totalOut = days.reduce((n, d) => n + d.out, 0);
    const totalIn = days.reduce((n, d) => n + d.in, 0);
    const grid = h(
      'div',
      { className: 'mrt-chart-grid', 'aria-hidden': 'true' },
      [max, max / 2, 0].map((v) => h('span', { className: 'mrt-chart-tick' }, h('em', null, String(Math.round(v))))),
    );
    const cols = h('div', { className: 'mrt-chart-cols' });
    days.forEach((d, i) => {
      const date = parseDay(d.date);
      const isToday = i === days.length - 1;
      const label = `${weekdayFmt.format(date).replace('.', '')} ${date.getDate()}`;
      cols.appendChild(
        h(
          'div',
          {
            className: `mrt-chart-col${isToday ? ' mrt-chart-today' : ''}${i % 2 ? ' mrt-chart-odd' : ''}`,
            'data-tip': `${longDayFmt.format(date)} : ${plural(d.out, 'départ')}, ${plural(d.in, 'retour')}`,
          },
          h(
            'div',
            { className: 'mrt-chart-bars' },
            h('span', { className: 'mrt-chart-bar mrt-seg-transit', style: `height: ${(d.out / max) * 100}%` }),
            h('span', { className: 'mrt-chart-bar mrt-seg-onsite', style: `height: ${(d.in / max) * 100}%` }),
          ),
          h('span', { className: 'mrt-chart-x' }, isToday ? "Auj." : label),
        ),
      );
    });
    // Les mêmes chiffres en tableau, pour les lecteurs d'écran.
    const table = h(
      'table',
      { className: 'mrt-sr' },
      h('caption', null, 'Départs et retours par jour'),
      h('tr', null, h('th', null, 'Jour'), h('th', null, 'Départs'), h('th', null, 'Retours')),
      days.map((d) => h('tr', null, h('td', null, longDayFmt.format(parseDay(d.date))), h('td', null, String(d.out)), h('td', null, String(d.in)))),
    );
    return h(
      'section',
      { className: 'mrt-panel mrt-activity' },
      h(
        'div',
        { className: 'mrt-panel-head' },
        h('h3', { className: 'mrt-panel-title' }, 'Activité — 14 derniers jours'),
        h(
          'ul',
          { className: 'mrt-legend mrt-legend-compact' },
          h('li', null, h('span', { className: 'mrt-dot mrt-seg-transit' }), h('span', { className: 'mrt-legend-label' }, 'Départs'), h('strong', { className: 'mrt-legend-value' }, String(totalOut))),
          h('li', null, h('span', { className: 'mrt-dot mrt-seg-onsite' }), h('span', { className: 'mrt-legend-label' }, 'Retours'), h('strong', { className: 'mrt-legend-value' }, String(totalIn))),
        ),
      ),
      h('div', { className: 'mrt-chart' }, grid, cols),
      table,
    );
  }

  // ---------- Rollers en retard ----------
  function overdueCard(list: IRoller[], total: number, overdueDays: number): HTMLElement {
    const panel = h(
      'section',
      { className: 'mrt-panel mrt-late' },
      h(
        'div',
        { className: 'mrt-panel-head' },
        h('h3', { className: 'mrt-panel-title' }, 'En retard'),
        total ? h('span', { className: 'mrt-badge mrt-badge-overdue' }, icon('clock'), String(total)) : null,
      ),
    );
    if (list.length === 0) {
      panel.appendChild(
        h(
          'div',
          { className: 'mrt-late-ok' },
          h('span', { className: 'mrt-late-ok-icon' }, icon('check')),
          h('p', null, h('strong', null, 'Aucun roller en retard'), h('span', null, `Tous les rollers en transit sont partis depuis moins de ${overdueDays} jours.`)),
        ),
      );
      return panel;
    }
    const oldest = Math.max(...list.map((r) => r.sinceSeconds ?? 0));
    panel.appendChild(
      h(
        'ol',
        { className: 'mrt-late-list' },
        list.map((r) =>
          h(
            'li',
            null,
            h(
              'button',
              { type: 'button', className: 'mrt-late-row', onClick: () => ctx.showRoller(r.code) },
              h('span', { className: 'mrt-late-id' }, h('strong', { className: 'mrt-code' }, r.code), h('span', { className: 'mrt-sub' }, r.agency.name)),
              h(
                'span',
                { className: 'mrt-late-age' },
                h('span', { className: 'mrt-late-track' }, h('span', { className: 'mrt-late-fill', style: `width: ${((r.sinceSeconds ?? 0) / oldest) * 100}%` })),
                h('strong', null, formatDuration(r.sinceSeconds)),
              ),
            ),
          ),
        ),
      ),
    );
    if (total > list.length) {
      panel.appendChild(h('p', { className: 'mrt-hint mrt-late-more' }, `… et ${total - list.length} autre${total - list.length > 1 ? 's' : ''}. Filtre « En retard » dans l’onglet Rollers.`));
    }
    return panel;
  }

  // ---------- Cartes des agences ----------
  function agencyCard(a: IAgencyStats, overdueDays: number): HTMLElement {
    const empty = a.total === 0;
    return h(
      'button',
      {
        type: 'button',
        className: `mrt-agency${a.overdue ? ' mrt-agency-alert' : ''}${empty ? ' mrt-agency-empty' : ''}`,
        onClick: () => ctx.showAgency(a.agency.id),
        'aria-label': `${a.agency.name} : ${plural(a.total, 'roller')}. Voir les rollers`,
      },
      h(
        'span',
        { className: 'mrt-agency-head' },
        h(
          'span',
          null,
          h('strong', { className: 'mrt-agency-code' }, a.agency.code),
          h('span', { className: 'mrt-agency-city' }, a.agency.city || 'Ville à renseigner'),
          a.overdue ? h('span', { className: 'mrt-badge mrt-badge-overdue' }, icon('clock'), `${a.overdue} en retard`) : null,
        ),
        h('span', { className: 'mrt-agency-total' }, h('strong', null, String(a.total)), a.total > 1 ? 'rollers' : 'roller'),
      ),
      empty
        ? h('span', { className: 'mrt-agency-none' }, 'Aucun roller pour l’instant')
        : [stackedBar(a, overdueDays), legend(a, overdueDays, true)],
      h(
        'span',
        { className: 'mrt-agency-foot' },
        h(
          'span',
          { className: 'mrt-agency-today', 'data-tip': "Départs et retours d'aujourd'hui" },
          icon('out'),
          String(a.outToday),
          icon('in'),
          String(a.inToday),
          h('em', null, "aujourd'hui"),
        ),
        h('span', { className: 'mrt-agency-go' }, 'Voir', icon('chevron')),
      ),
    );
  }

  function render(o: IOverview): void {
    clear(body);
    const days = o.totals.overdueDays;
    body.append(
      fleetCard(o),
      h('div', { className: 'mrt-sup-row' }, activityCard(o.activity), overdueCard(o.overdueRollers.slice(0, 6), o.totals.overdue, days)),
      h('h3', { className: 'mrt-section-title mrt-sup-agencies-title' }, 'Agences'),
      h('div', { className: 'mrt-agencies' }, o.agencies.map((a) => agencyCard(a, days))),
    );
  }

  async function load(): Promise<void> {
    const t = ++token;
    if (!data) {
      clear(body);
      body.appendChild(spinner());
    }
    try {
      const o = await ctx.api.overview();
      if (t !== token) return;
      data = o;
      hideTip();
      render(o);
    } catch (err) {
      if (t !== token) return;
      clear(body);
      body.appendChild(
        emptyState(
          'Chargement impossible',
          err instanceof Error ? err.message : '',
          h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => fire(load()) }, icon('refresh'), 'Réessayer'),
        ),
      );
    }
  }

  const dateLine = h('p', { className: 'mrt-hint' });
  const root = h(
    'div',
    { className: 'mrt-view mrt-overview' },
    h(
      'div',
      { className: 'mrt-view-head' },
      h('div', null, h('h2', { className: 'mrt-view-title' }, 'Toutes les agences'), dateLine),
      h('p', { className: 'mrt-hint' }, 'Cliquez sur une agence pour voir ses rollers.'),
    ),
    body,
    tip,
  );

  const unsubscribe = ctx.onChanged(() => {
    if (active) fire(load());
  });

  return {
    el: root,
    activate() {
      active = true;
      const today = longDayFmt.format(new Date());
      dateLine.textContent = today.charAt(0).toUpperCase() + today.slice(1);
      fire(load());
      pollTimer = window.setInterval(() => {
        if (!document.hidden && !ctx.root.querySelector('.mrt-backdrop')) fire(load());
      }, 30_000);
    },
    deactivate() {
      active = false;
      hideTip();
      window.clearInterval(pollTimer);
    },
    dispose() {
      active = false;
      window.clearInterval(pollTimer);
      window.removeEventListener('scroll', hideTip, true);
      unsubscribe();
    },
  };
}

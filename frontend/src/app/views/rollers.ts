// Écran « Rollers » : vue d'ensemble (sur site / en transit), gestion du parc et impression des étiquettes.

import type { IMovement, IRoller, IRollerDetail, IStats } from '../api';
import { code128Svg } from '../barcode/code128';
import { clear, h, icon } from '../dom';
import { formatDateTime, plural } from '../format';
import { LABEL_FORMATS, LabelFormat, printLabels } from '../labels';
import { endMaintenance, openMaintenanceDialog } from '../maintenance';
import {
  agencyFilter,
  agencySelect,
  emptyState,
  field,
  fire,
  IAppContext,
  IView,
  reasonsText,
  selectedAgency,
  sinceText,
  spinner,
  statusBadge,
} from '../ui';

type Filter = 'all' | 'on_site' | 'in_transit' | 'overdue' | 'maintenance' | 'archived';

const MOVEMENT_TITLES: Record<IMovement['kind'], string> = {
  out: 'Départ',
  in: 'Retour sur site',
  maintenance_start: 'Mise en maintenance',
  maintenance_end: 'Remis en service',
};
const MOVEMENT_ICONS: Record<IMovement['kind'], string> = {
  out: 'out',
  in: 'in',
  maintenance_start: 'wrench',
  maintenance_end: 'check',
};

function sinceLabel(r: IRoller): string {
  if (r.status === 'maintenance') return 'En maintenance depuis';
  return r.status === 'in_transit' ? 'Parti depuis' : 'Sur site depuis';
}

export interface IRollersView extends IView {
  showRoller(code: string): void;
}

export function createRollersView(ctx: IAppContext): IRollersView {
  let filter: Filter = 'all';
  let query = '';
  let rollers: IRoller[] = [];
  let stats: IStats | undefined;
  let active = false;
  let loadToken = 0;
  let searchTimer: number | undefined;
  let pollTimer: number | undefined;
  let stale = true;
  const selected = new Set<string>();

  // ---------- Indicateurs ----------
  const kpis = h('div', { className: 'mrt-kpis' });
  function kpi(id: Filter, value: number | string, label: string, tone: string, iconName: string): HTMLElement {
    return h(
      'button',
      {
        type: 'button',
        className: `mrt-kpi mrt-kpi-${tone}${filter === id ? ' mrt-kpi-active' : ''}`,
        'aria-pressed': String(filter === id),
        onClick: () => setFilter(filter === id ? 'all' : id),
      },
      h('span', { className: 'mrt-kpi-head' }, icon(iconName), label),
      h('span', { className: 'mrt-kpi-value' }, String(value)),
    );
  }
  function renderKpis(): void {
    clear(kpis);
    if (!stats) return;
    kpis.append(
      kpi('on_site', stats.onSite, 'Sur site', 'onsite', 'home'),
      kpi('in_transit', stats.inTransit, 'En transit', 'transit', 'truck'),
      kpi('overdue', stats.overdue, `En retard (> ${stats.overdueDays} j)`, 'overdue', 'clock'),
      kpi('maintenance', stats.maintenance, 'En maintenance', 'maintenance', 'wrench'),
      kpi('all', stats.total, 'Total du parc', 'total', 'list'),
    );
  }

  // ---------- Barre d'outils ----------
  const search = h('input', {
    type: 'search',
    className: 'mrt-input mrt-search-input',
    placeholder: 'Rechercher un code ou un libellé…',
    'aria-label': 'Rechercher',
    onInput: () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        query = search.value.trim();
        fire(load());
      }, 250);
    },
  });
  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Tous' },
    { id: 'on_site', label: 'Sur site' },
    { id: 'in_transit', label: 'En transit' },
    { id: 'overdue', label: 'En retard' },
    { id: 'maintenance', label: 'En maintenance' },
    { id: 'archived', label: 'Archivés' },
  ];
  const chipBar = h('div', { className: 'mrt-chips', role: 'group', 'aria-label': 'Filtrer' });
  function renderChips(): void {
    clear(chipBar);
    chips.forEach((c) =>
      chipBar.appendChild(
        h(
          'button',
          {
            type: 'button',
            className: `mrt-chip${filter === c.id ? ' mrt-chip-active' : ''}`,
            'aria-pressed': String(filter === c.id),
            onClick: () => setFilter(c.id),
          },
          c.label,
        ),
      ),
    );
  }

  const printBtn = h(
    'button',
    { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => openPrintDialog(rollers.filter((r) => selected.has(r.code))) },
    icon('print'),
    h('span', null, 'Imprimer'),
  );
  const createBtn = h(
    'button',
    { type: 'button', className: 'mrt-btn mrt-btn-primary', onClick: () => openCreateDialog() },
    icon('plus'),
    'Nouveaux rollers',
  );

  // ---------- Tableau ----------
  const listHost = h('div', { className: 'mrt-list-host' });
  const selectAll = h('input', {
    type: 'checkbox',
    className: 'mrt-check',
    'aria-label': 'Tout sélectionner',
    onChange: () => {
      if (selectAll.checked) rollers.forEach((r) => selected.add(r.code));
      else selected.clear();
      renderList();
    },
  });

  function updateSelectionUi(): void {
    const n = selected.size;
    printBtn.disabled = n === 0;
    (printBtn.lastChild as HTMLElement).textContent = n ? `Imprimer (${n})` : 'Imprimer';
    selectAll.checked = rollers.length > 0 && rollers.every((r) => selected.has(r.code));
    selectAll.indeterminate = n > 0 && !selectAll.checked;
  }

  // Administrateur sur « Toutes les agences » : une colonne indique l'agence de chaque roller.
  const showAgencyColumn = (): boolean => ctx.isAdmin && ctx.agencyFilter === null;

  function renderList(): void {
    clear(listHost);
    if (rollers.length === 0) {
      listHost.appendChild(
        stats && stats.total === 0 && filter === 'all' && !query
          ? emptyState(
              'Aucun roller enregistré',
              'Créez vos rollers pour générer leurs codes-barres, puis imprimez les étiquettes.',
              h('button', { type: 'button', className: 'mrt-btn mrt-btn-primary', onClick: () => openCreateDialog() }, icon('plus'), 'Créer des rollers'),
            )
          : emptyState('Aucun résultat', 'Aucun roller ne correspond à ce filtre.'),
      );
      updateSelectionUi();
      return;
    }
    const tbody = h('tbody', null);
    for (const r of rollers) {
      const check = h('input', {
        type: 'checkbox',
        className: 'mrt-check',
        checked: selected.has(r.code),
        'aria-label': `Sélectionner ${r.code}`,
        onChange: () => {
          if (check.checked) selected.add(r.code);
          else selected.delete(r.code);
          updateSelectionUi();
        },
      });
      tbody.appendChild(
        h(
          'tr',
          {
            className: `mrt-row${r.overdue ? ' mrt-row-overdue' : ''}`,
            onClick: (e: MouseEvent) => {
              if (!(e.target as HTMLElement).closest('input, button, label')) showRoller(r.code);
            },
          },
          h('td', { className: 'mrt-td-check' }, h('label', { className: 'mrt-check-hit' }, check)),
          h(
            'td',
            { className: 'mrt-td-code' },
            h('button', { type: 'button', className: 'mrt-link mrt-code', onClick: () => showRoller(r.code) }, r.code),
            r.label ? h('span', { className: 'mrt-sub' }, r.label) : null,
          ),
          showAgencyColumn() ? h('td', { className: 'mrt-td-agency', 'data-label': 'Agence' }, r.agency.name) : null,
          h(
            'td',
            { className: 'mrt-td-status' },
            statusBadge(r),
            r.status === 'maintenance' ? h('span', { className: 'mrt-sub' }, reasonsText(r.maintenanceReasons, ctx.info)) : null,
          ),
          h('td', { className: 'mrt-td-since', 'data-label': sinceLabel(r) }, sinceText(r)),
          h(
            'td',
            { className: 'mrt-td-last', 'data-label': 'Dernier scan' },
            r.lastMovementAt ? formatDateTime(r.lastMovementAt) : '—',
          ),
        ),
      );
    }
    listHost.appendChild(
      h(
        'table',
        { className: 'mrt-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { className: 'mrt-td-check' }, h('label', { className: 'mrt-check-hit' }, selectAll)),
            h('th', null, 'Roller'),
            showAgencyColumn() ? h('th', null, 'Agence') : null,
            h('th', null, 'Statut'),
            h('th', null, 'Depuis'),
            h('th', null, 'Dernier scan'),
          ),
        ),
        tbody,
      ),
    );
    updateSelectionUi();
  }

  function setFilter(next: Filter): void {
    filter = next;
    selected.clear();
    renderChips();
    renderKpis();
    fire(load());
  }

  async function load(showSpinner = false): Promise<void> {
    const token = ++loadToken;
    if (showSpinner) {
      clear(listHost);
      listHost.appendChild(spinner());
    }
    try {
      const status = filter === 'archived' || filter === 'all' ? undefined : filter;
      const agency = ctx.agencyFilter;
      const [s, list] = await Promise.all([
        ctx.api.stats(agency),
        ctx.api.rollers({ status, q: query || undefined, includeArchived: filter === 'archived', agency }),
      ]);
      if (token !== loadToken) return;
      stats = s;
      rollers = filter === 'archived' ? list.filter((r) => r.archived) : list;
      // Retire de la sélection les rollers qui ne sont plus affichés.
      const visible = new Set(rollers.map((r) => r.code));
      selected.forEach((c) => {
        if (!visible.has(c)) selected.delete(c);
      });
      stale = false;
      renderKpis();
      renderList();
    } catch (err) {
      if (token !== loadToken) return;
      clear(listHost);
      listHost.appendChild(
        emptyState(
          'Chargement impossible',
          err instanceof Error ? err.message : 'Erreur inattendue.',
          h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => fire(load(true)) }, icon('refresh'), 'Réessayer'),
        ),
      );
    }
  }

  // ---------- Création ----------
  function openCreateDialog(): void {
    let close: () => void = () => undefined;
    const count = h('input', { type: 'number', className: 'mrt-input', min: '1', max: '200', value: '1', inputMode: 'numeric' });
    const label = h('input', { type: 'text', className: 'mrt-input', maxLength: 80, placeholder: 'Ex. : Roller linge' });
    const notes = h('textarea', { className: 'mrt-input', rows: 2, maxLength: 500, placeholder: 'Facultatif' });
    // L'administrateur choisit l'agence ; un compte d'agence crée toujours dans la sienne.
    const agency = ctx.isAdmin ? agencySelect(ctx.agencies, ctx.agencyFilter) : undefined;
    const error = h('p', { className: 'mrt-form-error', role: 'alert' });
    const submitBtn = h('button', { type: 'submit', className: 'mrt-btn mrt-btn-primary' }, 'Créer et générer les codes');
    const formEl = h(
      'form',
      {
        className: 'mrt-form',
        onSubmit: (e: Event) => {
          e.preventDefault();
          const n = Number(count.value);
          if (!Number.isInteger(n) || n < 1 || n > 200) {
            error.textContent = 'Indiquez un nombre entre 1 et 200.';
            count.focus();
            return;
          }
          const agencyId = agency ? selectedAgency(agency) : undefined;
          if (agency && agencyId === null) {
            error.textContent = 'Choisissez l’agence des nouveaux rollers.';
            agency.focus();
            return;
          }
          submitBtn.disabled = true;
          error.textContent = '';
          ctx.api
            .createRollers({ count: n, label: label.value, notes: notes.value, agencyId: agencyId ?? undefined })
            .then((created) => {
              close();
              ctx.toast(`${plural(created.length, 'roller créé', 'rollers créés')}.`, 'success');
              ctx.notifyChanged();
              openPrintDialog(created, true);
            })
            .catch((err: unknown) => {
              submitBtn.disabled = false;
              error.textContent = err instanceof Error ? err.message : 'Création impossible.';
            });
        },
      },
      agency ? field('Agence', agency) : null,
      h(
        'div',
        { className: 'mrt-form-row' },
        field('Nombre de rollers', count),
        field('Libellé', label, 'Numéroté automatiquement si plusieurs rollers.'),
      ),
      field('Remarques', notes),
      h('p', { className: 'mrt-hint' }, 'Chaque roller reçoit un code-barres unique (ex. ROL000042) à imprimer et coller dessus.'),
      error,
      h(
        'div',
        { className: 'mrt-form-actions' },
        h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => close() }, 'Annuler'),
        submitBtn,
      ),
    );
    close = ctx.openModal({ title: 'Nouveaux rollers', body: formEl });
  }

  // ---------- Impression ----------
  function openPrintDialog(list: IRoller[], justCreated = false): void {
    if (list.length === 0) return;
    let close: () => void = () => undefined;
    let format: LabelFormat = ctx.prefs.labelFormat;
    const options = h('div', { className: 'mrt-choice-list', role: 'radiogroup', 'aria-label': "Format d'étiquette" });
    const renderOptions = (): void => {
      clear(options);
      LABEL_FORMATS.forEach((f) =>
        options.appendChild(
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(format === f.id),
              className: `mrt-choice${format === f.id ? ' mrt-choice-active' : ''}`,
              onClick: () => {
                format = f.id;
                renderOptions();
              },
            },
            h('strong', null, f.name),
            h('span', null, f.hint),
          ),
        ),
      );
    };
    renderOptions();
    const preview = h('div', { className: 'mrt-label-preview' });
    const first = list[0];
    preview.append(
      h('div', { className: 'mrt-label-preview-name' }, first.label || 'Roller'),
      h('div', { className: 'mrt-label-preview-bars', html: code128Svg(first.code, { height: 40 }) }),
      h('div', { className: 'mrt-label-preview-code' }, first.code),
    );
    close = ctx.openModal({
      title: justCreated ? 'Imprimer les étiquettes' : `Imprimer ${plural(list.length, 'étiquette')}`,
      body: h(
        'div',
        { className: 'mrt-print' },
        justCreated
          ? h('p', null, `Codes générés : ${list[0].code}${list.length > 1 ? ` à ${list[list.length - 1].code}` : ''}.`)
          : null,
        preview,
        options,
      ),
      footer: [
        h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => close() }, justCreated ? 'Plus tard' : 'Annuler'),
        h(
          'button',
          {
            type: 'button',
            className: 'mrt-btn mrt-btn-primary',
            onClick: () => {
              ctx.prefs.labelFormat = format;
              ctx.savePrefs();
              printLabels(list, format);
              close();
            },
          },
          icon('print'),
          `Imprimer ${plural(list.length, 'étiquette')}`,
        ),
      ],
    });
  }

  // ---------- Fiche roller ----------
  function showRoller(code: string): void {
    const body = h('div', { className: 'mrt-detail' }, spinner());
    const close = ctx.openModal({ title: code, body, wide: true });
    ctx.api
      .roller(code)
      .then((detail) => renderDetail(body, detail, close))
      .catch((err: unknown) => {
        clear(body);
        body.appendChild(emptyState('Roller introuvable', err instanceof Error ? err.message : ''));
      });
  }

  function renderDetail(body: HTMLElement, d: IRollerDetail, close: () => void): void {
    clear(body);
    const label = h('input', { type: 'text', className: 'mrt-input', value: d.label, maxLength: 80 });
    const notes = h('textarea', { className: 'mrt-input', rows: 2, maxLength: 500, value: d.notes });
    const saveBtn = h('button', { type: 'submit', className: 'mrt-btn mrt-btn-primary' }, 'Enregistrer');
    const editForm = h(
      'form',
      {
        className: 'mrt-form',
        onSubmit: (e: Event) => {
          e.preventDefault();
          saveBtn.disabled = true;
          ctx.api
            .updateRoller(d.code, { label: label.value, notes: notes.value })
            .then(() => {
              ctx.toast('Modifications enregistrées.', 'success');
              ctx.notifyChanged();
            })
            .catch((err: unknown) => ctx.toast(err instanceof Error ? err.message : 'Erreur.', 'error'))
            .finally(() => {
              saveBtn.disabled = false;
            });
        },
      },
      field('Libellé', label),
      field('Remarques', notes),
      h('div', { className: 'mrt-form-actions' }, saveBtn),
    );

    const archiveBtn = h(
      'button',
      {
        type: 'button',
        className: 'mrt-btn mrt-btn-ghost',
        onClick: () => {
          archiveBtn.disabled = true;
          ctx.api
            .updateRoller(d.code, { archived: !d.archived })
            .then((r) => {
              ctx.toast(r.archived ? `${r.code} archivé.` : `${r.code} réactivé.`, 'success');
              ctx.notifyChanged();
              close();
            })
            .catch((err: unknown) => {
              archiveBtn.disabled = false;
              ctx.toast(err instanceof Error ? err.message : 'Erreur.', 'error');
            });
        },
      },
      d.archived ? 'Réactiver' : 'Archiver (hors service)',
    );

    const history = h('ol', { className: 'mrt-timeline' });
    if (d.movements.length === 0) {
      history.appendChild(h('li', { className: 'mrt-timeline-empty' }, 'Aucun mouvement enregistré.'));
    }
    for (const m of d.movements) {
      history.appendChild(
        h(
          'li',
          { className: `mrt-timeline-item mrt-timeline-${m.kind}${m.cancelled ? ' mrt-cancelled' : ''}` },
          h('span', { className: 'mrt-timeline-dot' }, icon(MOVEMENT_ICONS[m.kind])),
          h(
            'div',
            null,
            h(
              'p',
              { className: 'mrt-timeline-title' },
              MOVEMENT_TITLES[m.kind],
              m.cancelled ? h('span', { className: 'mrt-badge mrt-badge-archived' }, 'Annulé') : null,
            ),
            m.reasons.length ? h('p', { className: 'mrt-sub' }, reasonsText(m.reasons, ctx.info)) : null,
            h('p', { className: 'mrt-sub' }, [formatDateTime(m.scannedAt), m.agent ? ` · ${m.agent}` : ''].join('')),
          ),
        ),
      );
    }

    // Après une action, la fiche est rouverte à jour.
    const reopen = (): void => {
      close();
      showRoller(d.code);
    };

    // Maintenance : mise en maintenance (sur site), modification des raisons ou remise en service.
    const maintenance = h('div', { className: 'mrt-detail-maintenance' });
    if (!d.archived && d.status === 'maintenance') {
      const repaired = h(
        'button',
        {
          type: 'button',
          className: 'mrt-btn mrt-btn-primary',
          onClick: () => {
            repaired.disabled = true;
            fire(
              endMaintenance(ctx, d).then((r) => {
                if (r) reopen();
                else repaired.disabled = false;
              }),
            );
          },
        },
        icon('check'),
        'Remettre en service',
      );
      maintenance.append(
        h(
          'div',
          { className: 'mrt-maintenance-box' },
          h('p', { className: 'mrt-maintenance-title' }, icon('wrench'), 'En maintenance'),
          h('p', null, `À réparer : ${reasonsText(d.maintenanceReasons, ctx.info)}`),
          h('p', { className: 'mrt-sub' }, `Depuis le ${formatDateTime(d.maintenanceSince)}`),
          h(
            'div',
            { className: 'mrt-form-actions' },
            h(
              'button',
              { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => openMaintenanceDialog(ctx, d, reopen) },
              'Modifier les raisons',
            ),
            repaired,
          ),
        ),
      );
    } else if (!d.archived) {
      const inTransit = d.status === 'in_transit';
      maintenance.append(
        h(
          'button',
          {
            type: 'button',
            className: 'mrt-btn mrt-btn-secondary',
            disabled: inTransit,
            onClick: () => openMaintenanceDialog(ctx, d, reopen),
          },
          icon('wrench'),
          'Mettre en maintenance',
        ),
      );
      if (inTransit) maintenance.append(h('p', { className: 'mrt-hint' }, 'Le roller est en transit : scannez son retour avant.'));
    }

    // Administrateur : transfert du roller vers une autre agence.
    let transfer: HTMLElement | null = null;
    if (ctx.isAdmin) {
      const select = agencySelect(ctx.agencies, d.agency.id);
      const transferBtn = h(
        'button',
        {
          type: 'button',
          className: 'mrt-btn mrt-btn-secondary',
          onClick: () => {
            const target = selectedAgency(select);
            if (target === null || target === d.agency.id) return;
            transferBtn.disabled = true;
            ctx.api
              .updateRoller(d.code, { agencyId: target })
              .then((r) => {
                ctx.toast(`${r.code} transféré à ${r.agency.name}.`, 'success');
                ctx.notifyChanged();
                reopen();
              })
              .catch((err: unknown) => {
                transferBtn.disabled = false;
                ctx.toast(err instanceof Error ? err.message : 'Transfert impossible.', 'error');
              });
          },
        },
        'Transférer',
      );
      transfer = h('div', { className: 'mrt-transfer' }, field('Agence du roller', select), transferBtn);
    }

    body.append(
      h(
        'div',
        { className: 'mrt-detail-top' },
        h(
          'div',
          { className: 'mrt-detail-summary' },
          statusBadge(d),
          h('p', { className: 'mrt-detail-label' }, d.label || 'Sans libellé'),
          h(
            'dl',
            { className: 'mrt-dl' },
            h('dt', null, 'Agence'),
            h('dd', null, d.agency.name),
            h('dt', null, sinceLabel(d)),
            h('dd', null, sinceText(d)),
            h('dt', null, 'Créé le'),
            h('dd', null, formatDateTime(d.createdAt)),
          ),
        ),
        h(
          'div',
          { className: 'mrt-detail-barcode' },
          h('div', { className: 'mrt-detail-bars', html: code128Svg(d.code, { height: 40 }) }),
          h('p', { className: 'mrt-detail-code' }, d.code),
          h(
            'button',
            { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => openPrintDialog([d]) },
            icon('print'),
            "Imprimer l'étiquette",
          ),
        ),
      ),
      h(
        'div',
        { className: 'mrt-detail-cols' },
        h('section', null, h('h3', { className: 'mrt-section-title' }, 'Historique'), history),
        h(
          'section',
          null,
          h('h3', { className: 'mrt-section-title' }, 'Maintenance'),
          maintenance,
          h('h3', { className: 'mrt-section-title mrt-section-gap' }, 'Informations'),
          editForm,
          transfer,
          h('div', { className: 'mrt-detail-danger' }, archiveBtn),
        ),
      ),
    );
  }

  // ---------- Assemblage ----------
  const agencyPicker = ctx.isAdmin ? agencyFilter(ctx) : undefined;
  const root = h(
    'div',
    { className: 'mrt-view mrt-rollers' },
    agencyPicker ? h('div', { className: 'mrt-view-head' }, agencyPicker.el) : null,
    kpis,
    h(
      'div',
      { className: 'mrt-toolbar' },
      h('div', { className: 'mrt-search' }, icon('search'), search),
      h('div', { className: 'mrt-toolbar-actions' }, printBtn, createBtn),
    ),
    chipBar,
    h('div', { className: 'mrt-card mrt-list-card' }, listHost),
  );

  const unsubscribe = ctx.onChanged(() => {
    stale = true;
    if (active) fire(load());
  });

  renderChips();
  updateSelectionUi();

  return {
    el: root,
    activate() {
      active = true;
      if (agencyPicker) agencyPicker.sync();
      fire(load(stale && rollers.length === 0));
      // Rafraîchissement périodique (scans faits sur d'autres postes).
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
    showRoller,
  };
}

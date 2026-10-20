// Administrateur — « Agences » : création, modification et suppression des agences.

import type { IAgencyAdmin } from '../api';
import { clear, h, icon } from '../dom';
import { plural } from '../format';
import { confirmDialog, emptyState, field, fire, IAppContext, IView, spinner } from '../ui';

export function createAgenciesView(ctx: IAppContext): IView {
  let agencies: IAgencyAdmin[] = [];
  let active = false;
  let token = 0;

  const listHost = h('div', { className: 'mrt-card mrt-list-card' });

  async function changed(): Promise<void> {
    await ctx.reloadAgencies().catch(() => undefined);
    ctx.notifyChanged();
  }

  function openForm(agency?: IAgencyAdmin): void {
    let close: () => void = () => undefined;
    const code = h('input', {
      type: 'text',
      className: 'mrt-input',
      maxLength: 12,
      value: agency?.code ?? '',
      placeholder: 'Ex. : GS80',
      autocapitalize: 'characters',
      required: true,
    });
    const city = h('input', { type: 'text', className: 'mrt-input', maxLength: 60, value: agency?.city ?? '', placeholder: 'Ex. : Amiens' });
    const error = h('p', { className: 'mrt-form-error', role: 'alert' });
    const submit = h('button', { type: 'submit', className: 'mrt-btn mrt-btn-primary' }, agency ? 'Enregistrer' : 'Créer l’agence');
    const form = h(
      'form',
      {
        className: 'mrt-form',
        onSubmit: (e: Event) => {
          e.preventDefault();
          submit.disabled = true;
          error.textContent = '';
          const input = { code: code.value, city: city.value };
          (agency ? ctx.api.updateAgency(agency.id, input) : ctx.api.createAgency(input))
            .then((a) => {
              close();
              ctx.toast(agency ? `Agence ${a.name} modifiée.` : `Agence ${a.name} créée.`, 'success');
              fire(changed());
            })
            .catch((err: unknown) => {
              submit.disabled = false;
              error.textContent = err instanceof Error ? err.message : 'Enregistrement impossible.';
            });
        },
      },
      h(
        'div',
        { className: 'mrt-form-row' },
        field('Code', code, 'Ex. : GS75'),
        field('Ville', city),
      ),
      error,
      h(
        'div',
        { className: 'mrt-form-actions' },
        h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => close() }, 'Annuler'),
        submit,
      ),
    );
    close = ctx.openModal({ title: agency ? `Modifier ${agency.name}` : 'Nouvelle agence', body: form });
  }

  async function remove(agency: IAgencyAdmin): Promise<void> {
    const ok = await confirmDialog(ctx, {
      title: 'Supprimer l’agence',
      message: `Supprimer l’agence ${agency.name} ? Cette action est définitive.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.api.deleteAgency(agency.id);
      ctx.toast(`Agence ${agency.name} supprimée.`, 'success');
      await changed();
    } catch (err) {
      ctx.toast(err instanceof Error ? err.message : 'Suppression impossible.', 'error');
    }
  }

  function render(): void {
    clear(listHost);
    if (agencies.length === 0) {
      listHost.appendChild(emptyState('Aucune agence', 'Créez la première agence.'));
      return;
    }
    const tbody = h('tbody', null);
    for (const a of agencies) {
      const used = a.rollers > 0 || a.users > 0;
      tbody.appendChild(
        h(
          'tr',
          null,
          h('td', { className: 'mrt-td-code' }, h('span', { className: 'mrt-code' }, a.code)),
          h('td', null, a.city || h('span', { className: 'mrt-muted' }, 'À renseigner')),
          h('td', { className: 'mrt-td-num', 'data-label': 'Rollers' }, String(a.rollers)),
          h('td', { className: 'mrt-td-num', 'data-label': 'Utilisateurs' }, String(a.users)),
          h(
            'td',
            { className: 'mrt-td-actions' },
            h(
              'button',
              { type: 'button', className: 'mrt-icon-btn', title: 'Modifier', 'aria-label': `Modifier ${a.name}`, onClick: () => openForm(a) },
              icon('edit'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mrt-icon-btn mrt-icon-btn-danger',
                title: used ? 'Impossible : l’agence a des rollers ou des utilisateurs' : 'Supprimer',
                'aria-label': `Supprimer ${a.name}`,
                disabled: used,
                onClick: () => fire(remove(a)),
              },
              icon('trash'),
            ),
          ),
        ),
      );
    }
    listHost.appendChild(
      h(
        'table',
        { className: 'mrt-table mrt-table-admin' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', null, 'Code'),
            h('th', null, 'Ville'),
            h('th', { className: 'mrt-td-num' }, 'Rollers'),
            h('th', { className: 'mrt-td-num' }, 'Utilisateurs'),
            h('th', { className: 'mrt-td-actions' }, h('span', { className: 'mrt-sr' }, 'Actions')),
          ),
        ),
        tbody,
      ),
    );
  }

  async function load(): Promise<void> {
    const t = ++token;
    if (agencies.length === 0) {
      clear(listHost);
      listHost.appendChild(spinner());
    }
    try {
      const list = await ctx.api.agencies();
      if (t !== token) return;
      agencies = list;
      count.textContent = plural(list.length, 'agence');
      render();
    } catch (err) {
      if (t !== token) return;
      clear(listHost);
      listHost.appendChild(emptyState('Chargement impossible', err instanceof Error ? err.message : ''));
    }
  }

  const count = h('p', { className: 'mrt-hint' });
  const root = h(
    'div',
    { className: 'mrt-view' },
    h(
      'div',
      { className: 'mrt-toolbar' },
      h('div', null, h('h2', { className: 'mrt-view-title' }, 'Agences'), count),
      h(
        'div',
        { className: 'mrt-toolbar-actions' },
        h('button', { type: 'button', className: 'mrt-btn mrt-btn-primary', onClick: () => openForm() }, icon('plus'), 'Nouvelle agence'),
      ),
    ),
    listHost,
    h(
      'p',
      { className: 'mrt-hint mrt-footnote' },
      'Une agence ne peut être supprimée que si elle n’a plus ni rollers, ni utilisateurs, ni historique. ',
      'Pour fermer une agence, transférez ou archivez ses rollers et rattachez ses utilisateurs à une autre agence.',
    ),
  );

  const unsubscribe = ctx.onChanged(() => {
    if (active) fire(load());
  });

  return {
    el: root,
    activate() {
      active = true;
      fire(load());
    },
    deactivate() {
      active = false;
    },
    dispose() {
      unsubscribe();
    },
  };
}

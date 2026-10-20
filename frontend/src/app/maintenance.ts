// Mise en maintenance d'un roller : une ou plusieurs raisons (paroi, roulettes, plateaux).

import type { IRoller } from './api';
import { h, icon } from './dom';
import { IAppContext } from './ui';

// Précisions affichées sous chaque raison, avec les mots employés en atelier.
const REASON_HINTS: Record<string, string> = {
  paroi: 'Côtés, grilles, ridelles',
  roulettes: 'Roues, freins',
  plateaux: 'Étagères',
};

export function openMaintenanceDialog(ctx: IAppContext, roller: IRoller, onDone?: (r: IRoller) => void): void {
  const editing = roller.status === 'maintenance';
  const chosen = new Set(roller.maintenanceReasons);
  let close: () => void = () => undefined;
  const error = h('p', { className: 'mrt-form-error', role: 'alert' });

  const options = ctx.info.maintenanceReasons.map((reason) => {
    const check = h('input', {
      type: 'checkbox',
      className: 'mrt-check',
      checked: chosen.has(reason.id),
      onChange: () => {
        if (check.checked) chosen.add(reason.id);
        else chosen.delete(reason.id);
        option.classList.toggle('mrt-reason-active', check.checked);
        error.textContent = '';
      },
    });
    const option = h(
      'label',
      { className: `mrt-reason${chosen.has(reason.id) ? ' mrt-reason-active' : ''}` },
      check,
      h('span', null, h('strong', null, reason.label), h('span', null, REASON_HINTS[reason.id] ?? '')),
    );
    return option;
  });

  const submitBtn = h(
    'button',
    { type: 'submit', className: 'mrt-btn mrt-btn-primary' },
    icon('wrench'),
    editing ? 'Enregistrer' : 'Mettre en maintenance',
  );
  const form = h(
    'form',
    {
      className: 'mrt-form',
      onSubmit: (e: Event) => {
        e.preventDefault();
        if (chosen.size === 0) {
          error.textContent = 'Cochez au moins une raison.';
          return;
        }
        submitBtn.disabled = true;
        ctx.api
          .startMaintenance(roller.code, Array.from(chosen))
          .then((res) => {
            close();
            ctx.toast(editing ? 'Maintenance mise à jour.' : `${res.roller.code} mis en maintenance.`, 'success');
            ctx.notifyChanged();
            if (onDone) onDone(res.roller);
          })
          .catch((err: unknown) => {
            submitBtn.disabled = false;
            error.textContent = err instanceof Error ? err.message : 'Enregistrement impossible.';
          });
      },
    },
    h('p', null, 'Qu’est-ce qui doit être réparé ? Plusieurs choix possibles.'),
    h('div', { className: 'mrt-reasons', role: 'group', 'aria-label': 'Raisons de la maintenance' }, options),
    h('p', { className: 'mrt-hint' }, 'Tant qu’il est en maintenance, le roller ne peut pas repartir.'),
    error,
    h(
      'div',
      { className: 'mrt-form-actions' },
      h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => close() }, 'Annuler'),
      submitBtn,
    ),
  );
  close = ctx.openModal({ title: `Maintenance — ${roller.code}`, body: form });
}

/** Remise en service après réparation. */
export async function endMaintenance(ctx: IAppContext, roller: IRoller): Promise<IRoller | undefined> {
  try {
    const res = await ctx.api.endMaintenance(roller.code);
    ctx.toast(`${res.roller.code} remis en service, sur site.`, 'success');
    ctx.notifyChanged();
    return res.roller;
  } catch (err) {
    ctx.toast(err instanceof Error ? err.message : 'Remise en service impossible.', 'error');
    return undefined;
  }
}

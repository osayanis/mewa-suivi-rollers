// Mise en maintenance d'un roller, en deux temps :
//   1. les raisons (paroi, roulettes, plateaux — une ou plusieurs) ;
//   2. une photo de la casse pour chaque raison, guidée par un modèle 3D qui montre où la prendre.
// La maintenance n'est enregistrée qu'avec toutes ses photos (le serveur le vérifie aussi).

import type { IPhoto, IRoller } from './api';
import { clear, h, icon } from './dom';
import { toJpeg } from './photo';
import type { IRoller3D, RollerPart } from './roller3d';
import { IAppContext } from './ui';

// Précisions affichées sous chaque raison, avec les mots employés en atelier.
const REASON_HINTS: Record<string, string> = {
  paroi: 'Côtés, grilles, ridelles',
  roulettes: 'Roues, freins',
  plateaux: 'Étagères',
};

// Où et comment prendre la photo, pour chaque raison.
const PHOTO_GUIDES: Record<string, string> = {
  paroi: 'Placez-vous sur le côté du roller, à environ 1 mètre. Cadrez toute la partie tordue ou cassée de la grille.',
  roulettes: 'Accroupissez-vous à environ 50 cm. Cadrez la roulette abîmée et sa fixation sous le socle.',
  plateaux: 'Placez-vous face au roller. Cadrez le plateau abîmé en entier, avec ses fixations.',
};

interface IShot {
  id: string;
  url: string;
}

export function openMaintenanceDialog(
  ctx: IAppContext,
  roller: IRoller,
  onDone?: (r: IRoller) => void,
  /** Photos de la maintenance en cours (modification des raisons) : ces raisons ne redemandent pas de photo. */
  existingPhotos: IPhoto[] = [],
): void {
  const editing = roller.status === 'maintenance';
  const reasons = ctx.info.maintenanceReasons;
  const label = (id: string): string => reasons.find((r) => r.id === id)?.label ?? id;
  const chosen = new Set(roller.maintenanceReasons);
  const alreadyShot = new Set(existingPhotos.map((p) => p.reason));
  const shots = new Map<string, IShot>();
  let step = 0; // 0 = raisons, n = n-ième photo
  let busy = false;
  let closed = false;

  // Raisons à photographier, dans l'ordre d'affichage.
  const photoSteps = (): string[] => reasons.map((r) => r.id).filter((id) => chosen.has(id) && !alreadyShot.has(id));

  // ---------- Modèle 3D (chargé une fois, partagé entre les étapes) ----------
  const viewerHost = h('div', { className: 'mrt-3d', 'aria-hidden': 'true' });
  let viewer: IRoller3D | undefined;
  let viewerStarted = false;
  function showPart(part: string): void {
    if (viewer) {
      viewer.setFocus(part as RollerPart);
      return;
    }
    if (viewerStarted) return;
    viewerStarted = true;
    viewerHost.appendChild(h('span', { className: 'mrt-spinner' }));
    import('./roller3d')
      .then((m) => m.mountRoller3D(viewerHost, part as RollerPart))
      .then((v) => {
        viewerHost.querySelector('.mrt-spinner')?.remove();
        if (closed) v.dispose();
        else {
          viewer = v;
          const current = photoSteps()[step - 1];
          if (current) v.setFocus(current as RollerPart);
        }
      })
      .catch(() => {
        clear(viewerHost);
        viewerHost.classList.add('mrt-3d-off');
        viewerHost.append(icon('camera'), h('span', null, 'Aperçu 3D indisponible sur cet appareil.'));
      });
  }

  const body = h('div', { className: 'mrt-maint' });
  const error = h('p', { className: 'mrt-form-error', role: 'alert' });

  // ---------- Étape 1 : raisons ----------
  function renderReasons(): void {
    const options = reasons.map((reason) => {
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
    body.append(
      h('p', null, 'Qu’est-ce qui doit être réparé ? Plusieurs choix possibles.'),
      h('div', { className: 'mrt-reasons', role: 'group', 'aria-label': 'Raisons de la maintenance' }, options),
      h('p', { className: 'mrt-hint' }, 'Ensuite, vous prendrez une photo de la casse pour chaque raison cochée.'),
      error,
      actions(
        h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => close() }, 'Annuler'),
        h(
          'button',
          {
            type: 'button',
            className: 'mrt-btn mrt-btn-primary',
            onClick: () => {
              if (chosen.size === 0) {
                error.textContent = 'Cochez au moins une raison.';
                return;
              }
              if (photoSteps().length === 0) submit();
              else go(1);
            },
          },
          ['Continuer', icon('chevron')],
        ),
      ),
    );
  }

  // ---------- Étapes suivantes : une photo par raison ----------
  function takePhoto(reason: string): void {
    const input = h('input', { type: 'file', accept: 'image/*', className: 'mrt-sr' });
    // Ouvre directement l'appareil photo arrière sur les terminaux et smartphones.
    input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (file) fireUpload(reason, file);
    });
    body.appendChild(input);
    input.click();
  }

  function fireUpload(reason: string, file: File): void {
    busy = true;
    error.textContent = '';
    render();
    toJpeg(file)
      .then((jpeg) => ctx.api.uploadPhoto(jpeg).then((res) => ({ jpeg, res })))
      .then(({ jpeg, res }) => {
        const previous = shots.get(reason);
        if (previous) URL.revokeObjectURL(previous.url);
        shots.set(reason, { id: res.id, url: URL.createObjectURL(jpeg) });
      })
      .catch((err: unknown) => {
        error.textContent = err instanceof Error ? err.message : 'Envoi de la photo impossible. Réessayez.';
      })
      .finally(() => {
        busy = false;
        if (!closed) render();
      });
  }

  function renderPhotoStep(): void {
    const steps = photoSteps();
    const reason = steps[step - 1];
    const shot = shots.get(reason);
    const last = step === steps.length;
    showPart(reason);

    const capture = busy
      ? h('div', { className: 'mrt-shot mrt-shot-busy' }, h('span', { className: 'mrt-spinner' }), 'Envoi de la photo…')
      : shot
        ? h(
            'div',
            { className: 'mrt-shot' },
            h('img', { className: 'mrt-shot-img', src: shot.url, alt: `Photo : ${label(reason)}` }),
            h(
              'button',
              { type: 'button', className: 'mrt-btn mrt-btn-secondary', onClick: () => takePhoto(reason) },
              icon('refresh'),
              'Reprendre la photo',
            ),
          )
        : h(
            'button',
            { type: 'button', className: 'mrt-btn mrt-btn-primary mrt-shot-take', onClick: () => takePhoto(reason) },
            icon('camera', 'mrt-icon mrt-icon-lg'),
            'Prendre la photo',
          );

    body.append(
      h(
        'ol',
        { className: 'mrt-steps-bar', 'aria-label': 'Étapes' },
        h('li', { className: 'mrt-step-done' }, 'Raisons'),
        steps.map((r, i) =>
          h('li', { className: i + 1 < step ? 'mrt-step-done' : i + 1 === step ? 'mrt-step-current' : '' }, `Photo ${label(r).toLowerCase()}`),
        ),
      ),
      h(
        'div',
        { className: 'mrt-photo-step' },
        viewerHost,
        h(
          'div',
          { className: 'mrt-photo-side' },
          h('p', { className: 'mrt-photo-kicker' }, `Photo ${step} sur ${steps.length}`),
          h('h3', { className: 'mrt-photo-title' }, `Photographiez ${reason === 'roulettes' ? 'les roulettes' : reason === 'paroi' ? 'la paroi' : 'les plateaux'}`),
          h('p', { className: 'mrt-photo-guide' }, PHOTO_GUIDES[reason]),
          h('p', { className: 'mrt-hint' }, 'La zone en rouge sur le roller montre où prendre la photo.'),
          capture,
        ),
      ),
      error,
      actions(
        h('button', { type: 'button', className: 'mrt-btn mrt-btn-secondary', disabled: busy, onClick: () => go(step - 1) }, 'Retour'),
        h(
          'button',
          { type: 'button', className: 'mrt-btn mrt-btn-primary', disabled: busy || !shot, onClick: () => (last ? submit() : go(step + 1)) },
          last ? [icon('wrench'), editing ? 'Enregistrer' : 'Mettre en maintenance'] : ['Suivant', icon('chevron')],
        ),
      ),
    );
  }

  function actions(...buttons: HTMLElement[]): HTMLElement {
    return h('div', { className: 'mrt-form-actions mrt-maint-actions' }, buttons);
  }

  function go(next: number): void {
    step = next;
    error.textContent = '';
    render();
  }

  function render(): void {
    clear(body);
    if (step === 0) renderReasons();
    else renderPhotoStep();
  }

  function submit(): void {
    busy = true;
    const photos: Record<string, string> = {};
    shots.forEach((s, reason) => {
      if (chosen.has(reason)) photos[reason] = s.id;
    });
    body.querySelectorAll<HTMLButtonElement>('.mrt-maint-actions button').forEach((b) => (b.disabled = true));
    ctx.api
      .startMaintenance(roller.code, Array.from(chosen), photos)
      .then((res) => {
        close();
        ctx.toast(editing ? 'Maintenance mise à jour.' : `${res.roller.code} mis en maintenance.`, 'success');
        ctx.notifyChanged();
        if (onDone) onDone(res.roller);
      })
      .catch((err: unknown) => {
        busy = false;
        error.textContent = err instanceof Error ? err.message : 'Enregistrement impossible.';
        body.querySelectorAll<HTMLButtonElement>('.mrt-maint-actions button').forEach((b) => (b.disabled = false));
      });
  }

  render();
  const close = ctx.openModal({
    title: `Maintenance — ${roller.code}`,
    body,
    wide: true,
    onClose: () => {
      closed = true;
      if (viewer) viewer.dispose();
      shots.forEach((s) => URL.revokeObjectURL(s.url));
    },
  });
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

/** Vignettes des photos d'une maintenance ; un clic affiche la photo en grand. */
export function photoThumbs(ctx: IAppContext, photos: IPhoto[], small = false): HTMLElement | null {
  if (photos.length === 0) return null;
  const label = (id: string): string => ctx.info.maintenanceReasons.find((r) => r.id === id)?.label ?? id;
  return h(
    'div',
    { className: `mrt-thumbs${small ? ' mrt-thumbs-small' : ''}` },
    photos.map((p) =>
      h(
        'button',
        {
          type: 'button',
          className: 'mrt-thumb',
          title: `Photo : ${label(p.reason)}`,
          onClick: () =>
            ctx.openModal({
              title: `Photo — ${label(p.reason)}`,
              wide: true,
              body: h('img', { className: 'mrt-photo-full', src: ctx.api.photoUrl(p.id), alt: `Photo : ${label(p.reason)}` }),
            }),
        },
        h('img', { src: ctx.api.photoUrl(p.id), alt: '', loading: 'lazy' }),
        small ? null : h('span', null, label(p.reason)),
      ),
    ),
  );
}

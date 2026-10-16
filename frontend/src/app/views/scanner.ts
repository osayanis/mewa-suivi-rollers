// Écran « Scanner » : l'écran des agents de production.
// Objectif : un scan = une action, sans clic ni touche « Entrée » : le scan est validé tout seul
// dès que la douchette a fini d'écrire le code.

import { ApiError, IMovement, IRoller, IScanResult } from '../api';
import { openCameraScanner } from '../camera';
import { isCompleteCode } from '../codes';
import { clear, h, icon } from '../dom';
import { playFeedback } from '../feedback';
import { formatDateTimeAt, formatTime } from '../format';
import { fire, IAppContext, IView } from '../ui';

interface IRecent {
  at: string;
  code: string;
  label: string;
  kind: 'out' | 'in' | 'duplicate' | 'error';
  text: string;
  movement?: IMovement;
  cancelled?: boolean;
}

export function createScannerView(ctx: IAppContext): IView {
  let active = false;
  let queue: Promise<void> = Promise.resolve();
  let closeCamera: (() => void) | undefined;
  const recent: IRecent[] = [];

  // ---------- Zone de scan ----------
  // Validation automatique :
  // - code complet reconnu (ex. ROL000042) → validé après 80 ms (le temps de vérifier qu'aucun caractère ne suit) ;
  // - autre saisie arrivée « en rafale » (douchette) → validée dès que la douchette s'arrête d'écrire,
  //   pour afficher « Code inconnu » sans action de l'agent. Une frappe manuelle lente n'est pas validée
  //   en cours de route (sauf code complet) : « Entrée » reste possible.
  const AUTO_COMPLETE_MS = 80;
  const AUTO_BURST_IDLE_MS = 300;
  const BURST_MAX_GAP_MS = 80;
  let codePrefix = 'ROL';
  let codeDigits = 6;
  let autoTimer: number | undefined;
  let lastInputAt = 0;
  let burstOnly = true;

  function onScanInput(): void {
    const now = Date.now();
    const value = input.value;
    if (value.length <= 1) burstOnly = true;
    else if (now - lastInputAt > BURST_MAX_GAP_MS) burstOnly = false;
    lastInputAt = now;
    window.clearTimeout(autoTimer);
    if (!value.trim()) return;
    if (isCompleteCode(value, codePrefix, codeDigits)) {
      autoTimer = window.setTimeout(() => submit(input.value), AUTO_COMPLETE_MS);
    } else if (burstOnly && value.trim().length >= 4) {
      autoTimer = window.setTimeout(() => submit(input.value), AUTO_BURST_IDLE_MS);
    }
  }

  const input = h('input', {
    type: 'text',
    className: 'mrt-scan-input',
    placeholder: 'Scannez un code-barres…',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: false,
    enterkeyhint: 'go',
    'aria-label': 'Code-barres du roller',
    onFocus: () => updateReady(),
    onBlur: () => updateReady(),
    onInput: () => onScanInput(),
    onKeydown: (e: KeyboardEvent) => {
      // Certaines douchettes terminent par Tab au lieu d'Entrée.
      if (e.key === 'Tab' && input.value.trim()) {
        e.preventDefault();
        submit(input.value);
      }
    },
  });
  const readyText = h('span', null);
  const ready = h('p', { className: 'mrt-ready' }, h('span', { className: 'mrt-ready-dot' }), readyText);
  const cameraBtn = h(
    'button',
    { type: 'button', className: 'mrt-btn mrt-btn-secondary mrt-cam-btn', onClick: () => openCamera() },
    icon('camera'),
    h('span', null, 'Caméra'),
  );
  const form = h(
    'form',
    {
      className: 'mrt-scan-box',
      autocomplete: 'off',
      onSubmit: (e: Event) => {
        e.preventDefault();
        submit(input.value);
      },
      onClick: (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('button')) focusInput();
      },
    },
    h('div', { className: 'mrt-scan-row' }, icon('scan', 'mrt-icon mrt-scan-icon'), input, cameraBtn),
    ready,
  );

  function updateReady(): void {
    const focused = document.activeElement === input;
    form.classList.toggle('mrt-scan-ready', focused);
    readyText.textContent = focused ? 'Prêt — scannez un roller' : 'Touchez ici pour activer le scan';
  }

  function focusInput(): void {
    if (!active || closeCamera || ctx.root.querySelector('.mrt-backdrop')) return;
    input.focus({ preventScroll: true });
    updateReady();
  }

  // ---------- Résultat ----------
  const result = h('div', { className: 'mrt-result-area', 'aria-live': 'assertive' });

  function showIdle(): void {
    clear(result);
    result.appendChild(
      h(
        'div',
        { className: 'mrt-result mrt-result-idle' },
        h(
          'ol',
          { className: 'mrt-steps' },
          h('li', null, h('strong', null, 'Au départ'), ' : scannez le roller, il passe « En transit ».'),
          h('li', null, h('strong', null, 'Au retour'), ' : rescannez-le, il repasse « Sur site ».'),
        ),
      ),
    );
  }

  function showPending(code: string): void {
    clear(result);
    result.appendChild(
      h(
        'div',
        { className: 'mrt-result mrt-result-pending' },
        h('span', { className: 'mrt-spinner' }),
        h('div', { className: 'mrt-result-main' }, h('p', { className: 'mrt-result-kicker' }, 'Enregistrement…'), h('p', { className: 'mrt-result-code' }, code)),
      ),
    );
  }

  function resultCard(
    kind: 'out' | 'in' | 'duplicate' | 'error' | 'cancelled',
    kicker: string,
    code: string,
    meta: string | string[],
    action?: HTMLElement,
  ): HTMLElement {
    const iconName = kind === 'out' ? 'out' : kind === 'in' ? 'in' : kind === 'error' ? 'alert' : kind === 'cancelled' ? 'undo' : 'info';
    return h(
      'div',
      { className: `mrt-result mrt-result-${kind} mrt-pop` },
      h('div', { className: 'mrt-result-icon' }, icon(iconName)),
      h(
        'div',
        { className: 'mrt-result-main' },
        h('p', { className: 'mrt-result-kicker' }, kicker),
        code ? h('p', { className: 'mrt-result-code' }, code) : null,
        (Array.isArray(meta) ? meta : [meta]).filter(Boolean).map((line) => h('p', { className: 'mrt-result-meta' }, line)),
      ),
      action ?? null,
    );
  }

  function undoButton(entry: IRecent): HTMLElement {
    const btn = h(
      'button',
      {
        type: 'button',
        className: 'mrt-btn mrt-btn-ghost-light',
        onClick: () => {
          btn.disabled = true;
          cancel(entry).catch(() => undefined);
        },
      },
      icon('undo'),
      'Annuler',
    );
    return btn;
  }

  async function cancel(entry: IRecent): Promise<void> {
    if (!entry.movement) return;
    try {
      const res = await ctx.api.cancelMovement(entry.movement.id);
      markCancelled(entry);
      clear(result);
      result.appendChild(
        resultCard(
          'cancelled',
          'Scan annulé',
          res.roller.code,
          res.roller.status === 'on_site' ? 'Le roller est de nouveau « Sur site ».' : 'Le roller est de nouveau « En transit ».',
        ),
      );
      playFeedback('warning', ctx.prefs.sound);
      ctx.notifyChanged();
      fire(refreshCounters());
    } catch (err) {
      ctx.toast(err instanceof Error ? err.message : 'Annulation impossible.', 'error');
    } finally {
      focusInput();
    }
  }

  function markCancelled(entry: IRecent): void {
    entry.cancelled = true;
    renderRecent();
  }

  function describeRoller(r: IRoller): string {
    return r.label ? r.label : '';
  }

  function onScanResult(res: IScanResult): void {
    const r = res.roller;
    const entry: IRecent = {
      at: new Date().toISOString(),
      code: r.code,
      label: r.label,
      kind: res.result,
      text: '',
      movement: res.movement,
    };
    clear(result);
    if (res.result === 'out') {
      entry.text = 'Départ';
      result.appendChild(
        resultCard(
          'out',
          'Départ enregistré — en transit',
          r.code,
          [describeRoller(r), `Départ : ${formatDateTimeAt(res.movement?.scannedAt)}`],
          undoButton(entry),
        ),
      );
      playFeedback('out', ctx.prefs.sound);
    } else if (res.result === 'in') {
      entry.text = 'Retour';
      result.appendChild(
        resultCard(
          'in',
          'Retour enregistré — sur site',
          r.code,
          [
            describeRoller(r),
            `Départ : ${formatDateTimeAt(res.departedAt)}`,
            `Retour : ${formatDateTimeAt(res.movement?.scannedAt)}`,
          ],
          undoButton(entry),
        ),
      );
      playFeedback('in', ctx.prefs.sound);
    } else {
      entry.text = 'Doublon ignoré';
      result.appendChild(resultCard('duplicate', 'Déjà scanné', r.code, res.message ?? 'Scan ignoré.'));
      playFeedback('warning', ctx.prefs.sound);
    }
    recent.unshift(entry);
    renderRecent();
    if (res.result !== 'duplicate') ctx.notifyChanged();
  }

  function onScanError(code: string, err: unknown): void {
    const apiErr = err instanceof ApiError ? err : undefined;
    let kicker = 'Scan non enregistré';
    let meta = err instanceof Error ? err.message : 'Erreur inattendue.';
    let action: HTMLElement | undefined;
    if (apiErr?.code === 'unknown_code') {
      kicker = 'Code inconnu';
      meta = "Ce code-barres n'est pas enregistré. Vérifiez l'étiquette ou créez le roller dans l'onglet Rollers.";
    } else if (apiErr?.code === 'network') {
      kicker = 'Pas de connexion';
      action = h(
        'button',
        { type: 'button', className: 'mrt-btn mrt-btn-ghost-light', onClick: () => submit(code) },
        icon('refresh'),
        'Réessayer',
      );
    }
    clear(result);
    result.appendChild(resultCard('error', kicker, code, meta, action));
    playFeedback('error', ctx.prefs.sound);
    recent.unshift({ at: new Date().toISOString(), code, label: '', kind: 'error', text: kicker });
    renderRecent();
  }

  function submit(raw: string): void {
    window.clearTimeout(autoTimer);
    const code = raw.trim();
    input.value = '';
    if (!code) return;
    // File d'attente : les scans rapides à la douchette sont traités dans l'ordre.
    queue = queue.then(async () => {
      showPending(code);
      try {
        onScanResult(await ctx.api.scan(code));
      } catch (err) {
        onScanError(code.toUpperCase(), err);
      }
      fire(refreshCounters());
    });
    focusInput();
  }

  // ---------- Caméra ----------
  function openCamera(): void {
    if (closeCamera) return;
    input.blur();
    closeCamera = openCameraScanner(ctx.root, (code) => submit(code), () => {
      closeCamera = undefined;
      focusInput();
    });
  }

  // ---------- Compteurs + historique local ----------
  const counters = h('div', { className: 'mrt-today' });
  async function refreshCounters(): Promise<void> {
    try {
      const s = await ctx.api.stats();
      clear(counters);
      counters.append(
        h('div', { className: 'mrt-today-item' }, h('strong', null, String(s.outToday)), h('span', null, "départs aujourd'hui")),
        h('div', { className: 'mrt-today-item' }, h('strong', null, String(s.inToday)), h('span', null, "retours aujourd'hui")),
        h(
          'div',
          { className: 'mrt-today-item mrt-today-transit' },
          h('strong', null, String(s.inTransit)),
          h('span', null, 'en transit actuellement'),
        ),
      );
    } catch {
      /* les compteurs sont secondaires */
    }
  }

  const recentList = h('ul', { className: 'mrt-recent' });
  const recentSection = h(
    'section',
    { className: 'mrt-recent-section' },
    h('h3', { className: 'mrt-section-title' }, 'Derniers scans sur ce poste'),
    recentList,
  );

  function renderRecent(): void {
    recent.splice(15);
    clear(recentList);
    recentSection.hidden = recent.length === 0;
    for (const r of recent) {
      recentList.appendChild(
        h(
          'li',
          { className: `mrt-recent-item mrt-recent-${r.kind}${r.cancelled ? ' mrt-cancelled' : ''}` },
          h('span', { className: 'mrt-recent-time' }, formatTime(r.at)),
          h('span', { className: 'mrt-recent-dot' }),
          h(
            'button',
            {
              type: 'button',
              className: 'mrt-link mrt-recent-code',
              disabled: r.kind === 'error',
              onClick: () => ctx.showRoller(r.code),
            },
            r.code,
          ),
          h('span', { className: 'mrt-recent-text' }, r.cancelled ? `${r.text} — annulé` : r.text),
          r.label ? h('span', { className: 'mrt-recent-label' }, r.label) : null,
        ),
      );
    }
  }

  // ---------- Assemblage ----------
  const root = h(
    'div',
    { className: 'mrt-view mrt-scanner' },
    h(
      'div',
      { className: 'mrt-scanner-grid' },
      h(
        'div',
        { className: 'mrt-scanner-main' },
        form,
        result,
      ),
      h('aside', { className: 'mrt-scanner-side' }, counters, recentSection),
    ),
  );

  // Les frappes clavier hors champ (douchette) sont redirigées vers la zone de scan.
  const onGlobalKey = (e: KeyboardEvent): void => {
    if (!active || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || !document.body.contains(target))) return;
    if (ctx.root.querySelector('.mrt-backdrop, .mrt-cam')) return;
    input.focus({ preventScroll: true });
    updateReady();
  };
  document.addEventListener('keydown', onGlobalKey, true);

  const loadCodeFormat = async (): Promise<void> => {
    try {
      const info = await ctx.api.info();
      codePrefix = info.codePrefix;
      codeDigits = info.codeDigits;
    } catch {
      /* format par défaut : ROL + 6 chiffres */
    }
  };

  showIdle();
  renderRecent();

  return {
    el: root,
    activate() {
      active = true;
      fire(refreshCounters());
      fire(loadCodeFormat());
      window.setTimeout(focusInput, 50);
    },
    deactivate() {
      active = false;
      if (closeCamera) closeCamera();
    },
    dispose() {
      active = false;
      if (closeCamera) closeCamera();
      document.removeEventListener('keydown', onGlobalKey, true);
    },
  };
}

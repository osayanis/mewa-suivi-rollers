// Scan par la caméra (tablette / smartphone), en complément des douchettes.
// Utilise l'API native BarcodeDetector quand elle existe (Chrome/Edge Android, macOS), sinon la
// bibliothèque ZXing, chargée à la demande uniquement (elle n'alourdit pas l'ouverture de la page).

import { h, icon } from './dom';
import { fire } from './ui';

interface IDetectedBarcode {
  rawValue: string;
}
interface IBarcodeDetector {
  detect(source: CanvasImageSource): Promise<IDetectedBarcode[]>;
}
interface IBarcodeDetectorCtor {
  new (options?: { formats: string[] }): IBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

const SAME_CODE_COOLDOWN_MS = 2000;

async function nativeDetector(): Promise<IBarcodeDetector | undefined> {
  const Ctor = (window as unknown as { BarcodeDetector?: IBarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return undefined;
  try {
    const formats = Ctor.getSupportedFormats ? await Ctor.getSupportedFormats() : ['code_128'];
    return formats.indexOf('code_128') >= 0 ? new Ctor({ formats: ['code_128'] }) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ouvre l'interface caméra dans `host`. Reste ouverte pour enchaîner les scans.
 * Retourne une fonction de fermeture.
 */
export function openCameraScanner(host: HTMLElement, onCode: (code: string) => void, onClose: () => void): () => void {
  let closed = false;
  let stream: MediaStream | undefined;
  let stopZxing: (() => void) | undefined;
  let timer: number | undefined;
  let lastCode = '';
  let lastAt = 0;

  const video = h('video', { className: 'mrt-cam-video', playsInline: true, muted: true, autoplay: true });
  const status = h('p', { className: 'mrt-cam-status' }, 'Démarrage de la caméra…');
  const frame = h('div', { className: 'mrt-cam-frame' });
  let close: () => void = () => undefined;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const overlay = h(
    'div',
    { className: 'mrt-cam', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Scanner avec la caméra' },
    h('div', { className: 'mrt-cam-viewport' }, video, frame),
    h(
      'div',
      { className: 'mrt-cam-bar' },
      status,
      h('button', { type: 'button', className: 'mrt-btn mrt-btn-light', onClick: () => close() }, icon('close'), 'Fermer'),
    ),
  );
  close = () => {
    if (closed) return;
    closed = true;
    if (timer !== undefined) window.clearTimeout(timer);
    if (stopZxing) stopZxing();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose();
  };
  host.appendChild(overlay);
  document.addEventListener('keydown', onKey, true);

  const handle = (raw: string): void => {
    const code = raw.trim();
    const now = Date.now();
    if (!code || (code === lastCode && now - lastAt < SAME_CODE_COOLDOWN_MS)) return;
    lastCode = code;
    lastAt = now;
    frame.classList.remove('mrt-cam-hit');
    frame.getBoundingClientRect(); // force un reflow pour relancer l'animation
    frame.classList.add('mrt-cam-hit');
    status.textContent = `Code lu : ${code}`;
    onCode(code);
  };

  const fail = (err: unknown): void => {
    const name = (err as { name?: string })?.name;
    status.textContent =
      name === 'NotAllowedError'
        ? 'Accès à la caméra refusé. Autorisez la caméra dans le navigateur.'
        : name === 'NotFoundError'
          ? 'Aucune caméra détectée sur cet appareil.'
          : 'Impossible de démarrer la caméra.';
    overlay.classList.add('mrt-cam-error');
  };

  const start = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('no camera api'), { name: 'NotFoundError' });
    }
    const detector = await nativeDetector();
    if (closed) return;

    if (detector) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (closed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();
      status.textContent = 'Visez le code-barres du roller';
      const loop = async (): Promise<void> => {
        if (closed) return;
        try {
          if (video.readyState >= 2) {
            const codes = await detector.detect(video);
            if (codes.length > 0) handle(codes[0].rawValue);
          }
        } catch {
          /* image non exploitable : on continue */
        }
        if (!closed) timer = window.setTimeout(() => fire(loop()), 120);
      };
      fire(loop());
      return;
    }

    // Repli : ZXing (chargé à la demande).
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
      import(/* webpackChunkName: 'zxing-browser' */ '@zxing/browser'),
      import(/* webpackChunkName: 'zxing-library' */ '@zxing/library'),
    ]);
    if (closed) return;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
    const controls = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      video,
      (result) => {
        if (result) handle(result.getText());
      },
    );
    stopZxing = () => controls.stop();
    if (closed) controls.stop();
    else status.textContent = 'Visez le code-barres du roller';
  };

  start().catch(fail);
  return close;
}

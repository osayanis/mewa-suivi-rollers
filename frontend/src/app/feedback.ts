// Retour sonore et haptique après un scan : l'agent n'a pas besoin de regarder l'écran.

let audioCtx: AudioContext | undefined;

function tone(frequency: number, start: number, duration: number): void {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + start + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(audioCtx.currentTime + start);
  osc.stop(audioCtx.currentTime + start + duration + 0.02);
}

export type FeedbackKind = 'out' | 'in' | 'warning' | 'error';

export function playFeedback(kind: FeedbackKind, soundEnabled: boolean): void {
  try {
    if (soundEnabled) {
      if (!audioCtx) {
        const Ctor =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) audioCtx = new Ctor();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => undefined);
      switch (kind) {
        case 'out': // deux bips montants
          tone(880, 0, 0.09);
          tone(1320, 0.11, 0.12);
          break;
        case 'in': // deux bips descendants
          tone(1320, 0, 0.09);
          tone(880, 0.11, 0.12);
          break;
        case 'warning':
          tone(660, 0, 0.18);
          break;
        default: // erreur : son grave
          tone(220, 0, 0.18);
          tone(220, 0.24, 0.24);
      }
    }
    if (navigator.vibrate) {
      navigator.vibrate(kind === 'error' ? [120, 80, 120] : kind === 'warning' ? 80 : 40);
    }
  } catch {
    /* le retour sonore est facultatif */
  }
}

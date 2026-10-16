// Formatage des dates et durées en français.

const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export function formatDateTime(iso: string | null): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : '—';
}

/** « 16/10/2026 à 09:12 » */
export function formatDateTimeAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${dateFmt.format(d)} à ${timeFmt.format(d)}`;
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function formatDay(iso: string): string {
  const s = dayFmt.format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Durée lisible : « 45 s », « 12 min », « 3 h 20 », « 2 j 4 h ». */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const m = minutes % 60;
    return m ? `${hours} h ${String(m).padStart(2, '0')}` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const hRest = hours % 24;
  return hRest ? `${days} j ${hRest} h` : `${days} j`;
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n > 1 ? pluralForm ?? singular + 's' : singular}`;
}

export function startOfDay(daysAgo = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

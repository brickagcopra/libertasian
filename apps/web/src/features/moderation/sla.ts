/**
 * Report-review SLA. The Terms promise review within 24 hours of the first
 * report, so a case's age is measured from `firstReportedAt`.
 *
 * - ok:       under 12h
 * - due_soon: 12h up to and including 24h
 * - overdue:  over 24h
 */
export type SlaLevel = 'ok' | 'due_soon' | 'overdue';

const HOUR_MS = 60 * 60 * 1000;
export const SLA_DUE_SOON_HOURS = 12;
export const SLA_OVERDUE_HOURS = 24;

/** Hours elapsed since `iso`, never negative. NaN for an unparseable date. */
export function hoursSince(iso: string, now: Date = new Date()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.NaN;
  return Math.max(0, (now.getTime() - t) / HOUR_MS);
}

export function slaLevel(firstReportedAt: string, now: Date = new Date()): SlaLevel {
  const h = hoursSince(firstReportedAt, now);
  if (Number.isNaN(h)) return 'ok';
  if (h > SLA_OVERDUE_HOURS) return 'overdue';
  if (h >= SLA_DUE_SOON_HOURS) return 'due_soon';
  return 'ok';
}

export const SLA_BADGE_CLASSES: Record<SlaLevel, string> = {
  ok: 'bg-green-100 text-green-700',
  due_soon: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
};

/** Compact age such as "45m", "5h", "3d". */
export function formatAge(iso: string, now: Date = new Date()): string {
  const h = hoursSince(iso, now);
  if (Number.isNaN(h)) return '—';
  if (h < 1) return `${Math.max(1, Math.floor(h * 60))}m`;
  if (h < 48) return `${Math.floor(h)}h`;
  return `${Math.floor(h / 24)}d`;
}

/** "5h ago", "3d ago", or "—" for null. */
export function formatRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const age = formatAge(iso, now);
  return age === '—' ? age : `${age} ago`;
}

/** Hours as "40m", "6.5h" or "2.1d". */
export function formatHours(hours: number | null): string {
  if (hours === null || Number.isNaN(hours)) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

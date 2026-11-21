import { describe, expect, it } from 'vitest';

import { formatAge, formatHours, formatRelative, slaLevel } from './sla';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('slaLevel', () => {
  it('is ok under 12h', () => {
    expect(slaLevel(hoursAgo(0), NOW)).toBe('ok');
    expect(slaLevel(hoursAgo(11.99), NOW)).toBe('ok');
  });

  it('is due_soon from 12h through 24h', () => {
    expect(slaLevel(hoursAgo(12), NOW)).toBe('due_soon');
    expect(slaLevel(hoursAgo(18), NOW)).toBe('due_soon');
    expect(slaLevel(hoursAgo(24), NOW)).toBe('due_soon');
  });

  it('is overdue past 24h', () => {
    expect(slaLevel(hoursAgo(24.01), NOW)).toBe('overdue');
    expect(slaLevel(hoursAgo(72), NOW)).toBe('overdue');
  });

  it('treats a future timestamp (clock skew) as ok', () => {
    expect(slaLevel(hoursAgo(-2), NOW)).toBe('ok');
  });

  it('treats an unparseable date as ok rather than throwing', () => {
    expect(slaLevel('not-a-date', NOW)).toBe('ok');
  });
});

describe('formatters', () => {
  it('formats ages compactly', () => {
    expect(formatAge(hoursAgo(0.5), NOW)).toBe('30m');
    expect(formatAge(hoursAgo(5), NOW)).toBe('5h');
    expect(formatAge(hoursAgo(30), NOW)).toBe('30h');
    expect(formatAge(hoursAgo(73), NOW)).toBe('3d');
  });

  it('formats relative time and null', () => {
    expect(formatRelative(hoursAgo(5), NOW)).toBe('5h ago');
    expect(formatRelative(null, NOW)).toBe('—');
  });

  it('formats median hours', () => {
    expect(formatHours(null)).toBe('—');
    expect(formatHours(0.5)).toBe('30m');
    expect(formatHours(6.54)).toBe('6.5h');
    expect(formatHours(72)).toBe('3d');
  });
});

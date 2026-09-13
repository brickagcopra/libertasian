import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import type { AnalyticsDailyAggregateRow } from '@libertasian/types';
import { SurfaceUsagePanel } from './surface-usage-panel';

function row(
  metricName: string,
  dimension: string | null,
  metricValue: number,
  uniqueUsers: number,
  date = '2026-09-11',
): AnalyticsDailyAggregateRow {
  return {
    id: `${metricName}-${dimension ?? 'total'}-${date}`,
    date,
    metricName,
    dimension,
    metricValue,
    uniqueUsers,
    organizationId: null,
  };
}

/**
 * A realistic enveloped payload: `surface_views` written once per surface plus
 * an undimensioned total, `dau` and `sessions` split by platform, and the
 * `device:*` rows the aggregator also writes.
 */
function payload(): AnalyticsDailyAggregateRow[] {
  return [
    row('surface_views', null, 96, 11),
    row('surface_views', 'surface:digests', 42, 7),
    row('surface_views', 'surface:bar_exams', 31, 5),
    row('surface_views', 'surface:library', 12, 4),
    row('surface_views', 'surface:other', 11, 3),
    row('surface_views', 'surface:digests', 40, 6, '2026-09-10'),
    row('dau', null, 21, 21),
    row('dau', 'platform:ios', 9, 9),
    row('dau', 'platform:android', 4, 4),
    row('dau', 'platform:web', 8, 8),
    row('sessions', null, 30, 0),
    row('sessions', 'platform:ios', 12, 0),
    row('sessions', 'platform:android', 0, 0),
    row('sessions', 'platform:web', 18, 0),
    row('sessions', 'device:ios', 12, 0),
  ];
}

function surfaceTable(): HTMLElement {
  return screen.getAllByRole('table')[0]!;
}

function platformTable(): HTMLElement {
  return screen.getAllByRole('table')[1]!;
}

describe('SurfaceUsagePanel', () => {
  it('renders from a real enveloped payload', () => {
    render(<SurfaceUsagePanel metrics={payload()} />);
    expect(screen.getByText('Where users go')).toBeInTheDocument();
    expect(screen.getByText('Digests')).toBeInTheDocument();
    expect(screen.getByText('Bar exams')).toBeInTheDocument();
  });

  it('ranks surfaces by views across the range', () => {
    render(<SurfaceUsagePanel metrics={payload()} />);
    const labels = within(surfaceTable())
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.firstElementChild?.textContent);

    // digests: 42 + 40 = 82, then bar_exams 31, library 12, other 11.
    expect(labels).toEqual(['Digests', 'Bar exams', 'Library', 'Unmapped routes']);
  });

  it('sums views but takes the peak unique-user count', () => {
    render(<SurfaceUsagePanel metrics={payload()} />);
    const digests = within(surfaceTable()).getByText('Digests').closest('tr')!;
    const cells = within(digests).getAllByRole('cell').map((c) => c.textContent);

    // Summing uniqueUsers (7 + 6) would claim 13 people used digests when at
    // most 7 did — the same person on two days is one person.
    expect(cells[1]).toBe('82');
    expect(cells[2]).toBe('7');
  });

  it('never double-counts the undimensioned total as a surface', () => {
    render(<SurfaceUsagePanel metrics={payload()} />);
    const rows = within(surfaceTable()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(screen.queryByText('96')).not.toBeInTheDocument();
  });

  it('labels the other bucket as unmapped rather than hiding it', () => {
    render(<SurfaceUsagePanel metrics={payload()} />);
    expect(within(surfaceTable()).getByText('Unmapped routes')).toBeInTheDocument();
  });

  it('shows the platform split for DAU and sessions', () => {
    render(<SurfaceUsagePanel metrics={payload()} />);
    const ios = within(platformTable()).getByText('iOS').closest('tr')!;
    const cells = within(ios).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['iOS', '9', '12']);
  });

  it('renders a genuine zero platform row rather than dropping it', () => {
    render(<SurfaceUsagePanel metrics={payload()} />);
    const android = within(platformTable()).getByText('Android').closest('tr')!;
    expect(within(android).getAllByRole('cell')[2]!.textContent).toBe('0');
  });

  it('does not pull the device:* rows into the platform split', () => {
    // sessions is written under both prefixes; counting both would double iOS.
    render(<SurfaceUsagePanel metrics={payload()} />);
    expect(within(platformTable()).getAllByRole('row').slice(1)).toHaveLength(3);
  });

  it('says platform rows do not sum to the total', () => {
    render(<SurfaceUsagePanel metrics={payload()} />);
    expect(screen.getByText(/do not sum to the DAU total/i)).toBeInTheDocument();
  });

  it('shows an empty state rather than an empty table', () => {
    render(<SurfaceUsagePanel metrics={[]} />);
    expect(screen.getByText(/no surface views recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/no platform breakdown recorded/i)).toBeInTheDocument();
  });

  it('surfaces a load failure instead of rendering it as emptiness', () => {
    render(
      <SurfaceUsagePanel metrics={[]} isError error={new Error('Forbidden')} />,
    );
    expect(screen.getByText(/could not load surface usage/i)).toBeInTheDocument();
    expect(screen.getByText('Forbidden')).toBeInTheDocument();
    expect(screen.queryByText(/no surface views recorded/i)).not.toBeInTheDocument();
  });

  it('shows a loading state', () => {
    render(<SurfaceUsagePanel metrics={[]} isLoading />);
    expect(screen.getByTestId('surface-usage-loading')).toBeInTheDocument();
  });
});

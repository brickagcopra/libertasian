import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AggregationFreshness, STALE_AFTER_HOURS } from './aggregation-freshness';

const NOW = new Date('2026-09-13T06:00:00.000Z');

describe('AggregationFreshness', () => {
  it('states when metrics were last computed', () => {
    render(
      <AggregationFreshness lastAggregatedAt="2026-09-12" onRefresh={vi.fn()} now={NOW} />,
    );
    expect(screen.getByText(/metrics last computed 2026-09-12/i)).toBeInTheDocument();
  });

  it('does not warn while the pipeline is current', () => {
    // Yesterday's metrics, computed this morning: healthy.
    render(
      <AggregationFreshness lastAggregatedAt="2026-09-12" onRefresh={vi.fn()} now={NOW} />,
    );
    expect(screen.queryByText(/may be stale/i)).not.toBeInTheDocument();
  });

  it('warns when the last computed day is more than 48h old', () => {
    // This is the 2026-09-12 skip: the cron did not fire because a deploy
    // restart straddled its minute, and every panel rendered the hole as zeros.
    render(
      <AggregationFreshness lastAggregatedAt="2026-09-10" onRefresh={vi.fn()} now={NOW} />,
    );
    expect(
      screen.getByText(new RegExp(`more than ${STALE_AFTER_HOURS}h ago`, 'i')),
    ).toBeInTheDocument();
  });

  it('says so explicitly when nothing has ever been computed', () => {
    render(<AggregationFreshness lastAggregatedAt={null} onRefresh={vi.fn()} now={NOW} />);
    expect(screen.getByText(/never been computed/i)).toBeInTheDocument();
  });

  it('treats undefined the same as never', () => {
    render(<AggregationFreshness lastAggregatedAt={undefined} onRefresh={vi.fn()} now={NOW} />);
    expect(screen.getByText(/never been computed/i)).toBeInTheDocument();
  });

  it('measures staleness from the end of the aggregated day', () => {
    // Metrics for the 11th are complete some time on the 12th. Measuring from
    // midnight on the 11th would call a pipeline that just ran 48h stale.
    render(
      <AggregationFreshness lastAggregatedAt="2026-09-11" onRefresh={vi.fn()} now={NOW} />,
    );
    expect(screen.queryByText(/may be stale/i)).not.toBeInTheDocument();
  });

  it('calls onRefresh when the button is pressed', async () => {
    const onRefresh = vi.fn();
    render(
      <AggregationFreshness lastAggregatedAt="2026-09-12" onRefresh={onRefresh} now={NOW} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /refresh metrics/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables the button while a refresh is in flight', () => {
    render(
      <AggregationFreshness
        lastAggregatedAt="2026-09-12"
        onRefresh={vi.fn()}
        isRefreshing
        now={NOW}
      />,
    );
    expect(screen.getByRole('button', { name: /refresh metrics/i })).toBeDisabled();
  });
});

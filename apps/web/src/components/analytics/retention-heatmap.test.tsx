import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the dynamic import for Heatmap
vi.mock('@/components/charts/heatmap', () => ({
  Heatmap: ({ data }: { data: unknown[] }) => (
    <div data-testid="heatmap" data-cells={JSON.stringify(data).length} />
  ),
}));

// Mock next/dynamic to return the component directly
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ Heatmap: unknown }>) => {
    // Immediately resolve the dynamic import for testing
    const mod = { Heatmap: ({ data }: { data: unknown[] }) => (
      <div data-testid="heatmap" data-count={data.length} />
    )};
    return mod.Heatmap;
  },
}));

import { RetentionHeatmap } from './retention-heatmap';
import type { AnalyticsRetentionCohortRow } from '@libertasian/types';

const makeCohorts = (): AnalyticsRetentionCohortRow[] => [
  { cohortWeek: '2026-W10', retentionWeek: 0, cohortSize: 100, retainedCount: 100, retentionRate: 1.0 },
  { cohortWeek: '2026-W10', retentionWeek: 1, cohortSize: 100, retainedCount: 60, retentionRate: 0.6 },
  { cohortWeek: '2026-W10', retentionWeek: 2, cohortSize: 100, retainedCount: 40, retentionRate: 0.4 },
  { cohortWeek: '2026-W11', retentionWeek: 0, cohortSize: 80, retainedCount: 80, retentionRate: 1.0 },
  { cohortWeek: '2026-W11', retentionWeek: 1, cohortSize: 80, retainedCount: 50, retentionRate: 0.625 },
];

describe('RetentionHeatmap', () => {
  it('shows empty state when no cohorts', () => {
    render(<RetentionHeatmap cohorts={[]} />);
    expect(screen.getByText('No retention data')).toBeInTheDocument();
  });

  it('renders heatmap component when cohorts exist', () => {
    render(<RetentionHeatmap cohorts={makeCohorts()} />);
    expect(screen.getByTestId('heatmap')).toBeInTheDocument();
  });

  it('renders description text', () => {
    render(<RetentionHeatmap cohorts={makeCohorts()} />);
    expect(
      screen.getByText(
        /Values represent retention rate/,
      ),
    ).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <RetentionHeatmap cohorts={makeCohorts()} className="my-class" />,
    );
    expect(container.firstChild).toHaveClass('my-class');
  });
});

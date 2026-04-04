import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { DateRangeFilter } from './date-range-filter';
import type { AnalyticsDashboardQuery } from '@libertasian/types';

describe('DateRangeFilter', () => {
  const defaultQuery: AnalyticsDashboardQuery = {
    from: '2026-03-01',
    to: '2026-03-31',
    granularity: 'day',
  };

  it('renders start and end date inputs', () => {
    render(<DateRangeFilter query={defaultQuery} onChange={vi.fn()} />);
    expect(screen.getByText('Start Date')).toBeInTheDocument();
    expect(screen.getByText('End Date')).toBeInTheDocument();
  });

  it('displays current query dates', () => {
    const { container } = render(
      <DateRangeFilter query={defaultQuery} onChange={vi.fn()} />,
    );
    const inputs = container.querySelectorAll('input[type="date"]');
    expect(inputs[0]).toHaveValue('2026-03-01');
    expect(inputs[1]).toHaveValue('2026-03-31');
  });

  it('calls onChange when start date changes', () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateRangeFilter query={defaultQuery} onChange={onChange} />,
    );
    const inputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0], { target: { value: '2026-02-01' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-02-01' }),
    );
  });

  it('calls onChange when end date changes', () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateRangeFilter query={defaultQuery} onChange={onChange} />,
    );
    const inputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[1], { target: { value: '2026-04-15' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ to: '2026-04-15' }),
    );
  });

  it('shows granularity select by default', () => {
    render(<DateRangeFilter query={defaultQuery} onChange={vi.fn()} />);
    expect(screen.getByText('Granularity')).toBeInTheDocument();
  });

  it('hides granularity select when showGranularity=false', () => {
    render(
      <DateRangeFilter
        query={defaultQuery}
        onChange={vi.fn()}
        showGranularity={false}
      />,
    );
    expect(screen.queryByText('Granularity')).not.toBeInTheDocument();
  });

  it('shows dimension select when showDimension=true', () => {
    render(
      <DateRangeFilter
        query={defaultQuery}
        onChange={vi.fn()}
        showDimension={true}
      />,
    );
    expect(screen.getByText('Dimension')).toBeInTheDocument();
  });

  it('hides dimension select by default', () => {
    render(<DateRangeFilter query={defaultQuery} onChange={vi.fn()} />);
    expect(screen.queryByText('Dimension')).not.toBeInTheDocument();
  });
});

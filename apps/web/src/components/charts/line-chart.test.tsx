import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mock d3
vi.mock('d3', () => {
  const mockSelection = {
    selectAll: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    remove: vi.fn().mockReturnThis(),
    append: vi.fn().mockReturnThis(),
    attr: vi.fn().mockReturnThis(),
    data: vi.fn().mockReturnThis(),
    join: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
    datum: vi.fn().mockReturnThis(),
    call: vi.fn().mockReturnThis(),
  };
  return {
    select: vi.fn(() => mockSelection),
    scaleTime: vi.fn(() => {
      const scale = Object.assign(() => 0, {
        domain: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
      });
      return scale;
    }),
    scaleLinear: vi.fn(() => {
      const scale = Object.assign(() => 0, {
        domain: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
      });
      return scale;
    }),
    line: vi.fn(() => {
      const lineFn = Object.assign(() => '', {
        x: vi.fn().mockReturnThis(),
        y: vi.fn().mockReturnThis(),
        curve: vi.fn().mockReturnThis(),
      });
      return lineFn;
    }),
    axisBottom: vi.fn(() => ({
      ticks: vi.fn().mockReturnThis(),
      tickFormat: vi.fn().mockReturnThis(),
    })),
    axisLeft: vi.fn(() => ({
      ticks: vi.fn().mockReturnThis(),
    })),
    axisRight: vi.fn(() => ({
      ticks: vi.fn().mockReturnThis(),
    })),
    extent: vi.fn(() => [new Date(), new Date()]),
    max: vi.fn(() => 100),
    curveMonotoneX: vi.fn(),
    timeFormat: vi.fn(() => () => ''),
  };
});

import { LineChart } from './line-chart';

describe('LineChart', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <LineChart
        data={[{ date: new Date('2026-01-01'), value: 10 }]}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with empty data', () => {
    const { container } = render(<LineChart data={[]} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <LineChart
        data={[{ date: new Date('2026-01-01'), value: 10 }]}
        className="line"
      />,
    );
    expect(container.querySelector('.line')).toBeInTheDocument();
  });

  it('accepts custom dimensions', () => {
    const { container } = render(
      <LineChart
        data={[{ date: new Date('2026-01-01'), value: 10 }]}
        width={800}
        height={400}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with showCumulative option', () => {
    const { container } = render(
      <LineChart
        data={[
          { date: new Date('2026-01-01'), value: 10, cumulative: 10 },
          { date: new Date('2026-02-01'), value: 20, cumulative: 30 },
        ]}
        showCumulative
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with multiple data points', () => {
    const { container } = render(
      <LineChart
        data={[
          { date: new Date('2026-01-01'), value: 5 },
          { date: new Date('2026-02-01'), value: 15 },
          { date: new Date('2026-03-01'), value: 10 },
        ]}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

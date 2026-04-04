import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mock d3 since it requires DOM SVG manipulation
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
  };
  return {
    select: vi.fn(() => mockSelection),
    scaleBand: vi.fn(() => {
      const scale = Object.assign(() => 0, {
        domain: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        padding: vi.fn().mockReturnThis(),
        bandwidth: vi.fn(() => 20),
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
    max: vi.fn(() => 100),
  };
});

import { BarChart } from './bar-chart';

describe('BarChart', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <BarChart data={[{ label: 'A', value: 10 }]} />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with empty data', () => {
    const { container } = render(<BarChart data={[]} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <BarChart data={[{ label: 'A', value: 10 }]} className="custom-chart" />,
    );
    expect(container.querySelector('.custom-chart')).toBeInTheDocument();
  });

  it('accepts custom width and height', () => {
    const { container } = render(
      <BarChart
        data={[{ label: 'A', value: 10 }]}
        width={400}
        height={200}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with multiple data items', () => {
    const { container } = render(
      <BarChart
        data={[
          { label: 'Cases', value: 50 },
          { label: 'Statutes', value: 30 },
          { label: 'Rules', value: 20 },
        ]}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with custom colors', () => {
    const { container } = render(
      <BarChart
        data={[
          { label: 'A', value: 10, color: '#ff0000' },
          { label: 'B', value: 20, color: '#00ff00' },
        ]}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

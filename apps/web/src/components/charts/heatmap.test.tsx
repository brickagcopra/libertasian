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
    scaleSequential: vi.fn(() => {
      const scale = Object.assign(() => '#6366f1', {
        domain: vi.fn().mockReturnThis(),
      });
      return scale;
    }),
    interpolateBlues: vi.fn(),
    max: vi.fn(() => 100),
  };
});

import { Heatmap } from './heatmap';

describe('Heatmap', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <Heatmap data={[{ row: 'R1', col: 'C1', value: 5 }]} />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with empty data', () => {
    const { container } = render(<Heatmap data={[]} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <Heatmap
        data={[{ row: 'R1', col: 'C1', value: 5 }]}
        className="heat"
      />,
    );
    expect(container.querySelector('.heat')).toBeInTheDocument();
  });

  it('accepts custom dimensions', () => {
    const { container } = render(
      <Heatmap
        data={[{ row: 'R1', col: 'C1', value: 5 }]}
        width={400}
        height={300}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with multiple cells', () => {
    const { container } = render(
      <Heatmap
        data={[
          { row: 'Civil', col: 'Jan', value: 10 },
          { row: 'Civil', col: 'Feb', value: 15 },
          { row: 'Criminal', col: 'Jan', value: 8 },
          { row: 'Criminal', col: 'Feb', value: 12 },
        ]}
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

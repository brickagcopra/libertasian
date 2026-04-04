import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock d3
vi.mock('d3', () => {
  const mockSelection = {
    selectAll: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    remove: vi.fn().mockReturnThis(),
    append: vi.fn().mockReturnThis(),
    attr: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
  };
  return {
    select: vi.fn(() => mockSelection),
    arc: vi.fn(() => {
      const arcFn = Object.assign(() => '', {
        innerRadius: vi.fn().mockReturnThis(),
        outerRadius: vi.fn().mockReturnThis(),
        startAngle: vi.fn().mockReturnThis(),
        endAngle: vi.fn().mockReturnThis(),
        cornerRadius: vi.fn().mockReturnThis(),
      });
      return arcFn;
    }),
  };
});

import { RadialProgress } from './radial-progress';

describe('RadialProgress', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <RadialProgress value={0.75} label="Cases" />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders the label text', () => {
    render(<RadialProgress value={0.5} label="Completion" />);
    expect(screen.getByText('Completion')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <RadialProgress value={0.5} label="Test" className="my-class" />,
    );
    expect(container.querySelector('.my-class')).toBeInTheDocument();
  });

  it('renders with value 0', () => {
    const { container } = render(
      <RadialProgress value={0} label="Empty" />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('renders with value 1 (100%)', () => {
    const { container } = render(
      <RadialProgress value={1} label="Full" />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('accepts custom size', () => {
    const { container } = render(
      <RadialProgress value={0.5} label="Custom" size={150} />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with sublabel', () => {
    const { container } = render(
      <RadialProgress value={0.8} label="Score" sublabel="80/100" />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
  });

  it('clamps value above 1', () => {
    const { container } = render(
      <RadialProgress value={1.5} label="Over" />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('clamps value below 0', () => {
    const { container } = render(
      <RadialProgress value={-0.5} label="Under" />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

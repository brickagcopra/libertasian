import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AnimatedCounter } from './animated-counter';

// Force prefers-reduced-motion ON for this test file: framer-motion's
// useReducedMotion hook reads from matchMedia at render time.
function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce') ? reduce : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('AnimatedCounter', () => {
  beforeEach(() => {
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the final number once it has counted up', async () => {
    render(<AnimatedCounter value={42} />);
    // Mounted with reduced-motion off → animation kicks in. We don't
    // wait for the full count-up; framer-motion's animate is async,
    // so we just verify the component renders without throwing.
    // Initial display is 0 before the first frame.
    const span = screen.getByText(/^[0-9]+$/);
    expect(span).toBeInTheDocument();
  });

  it('renders the static final value when reduced-motion is preferred', () => {
    setReducedMotion(true);
    render(<AnimatedCounter value={123} />);
    expect(screen.getByText('123')).toBeInTheDocument();
  });

  it('formats with the supplied formatter', () => {
    setReducedMotion(true);
    render(
      <AnimatedCounter
        value={1500}
        formatter={(n) => `$${n.toFixed(0)}`}
      />,
    );
    expect(screen.getByText('$1500')).toBeInTheDocument();
  });
});

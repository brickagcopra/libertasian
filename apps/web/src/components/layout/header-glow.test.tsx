import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { HeaderGlow } from './header-glow';

describe('HeaderGlow', () => {
  it('renders an aria-hidden decorative layer', () => {
    const { container } = render(<HeaderGlow />);
    const layer = container.firstElementChild;
    expect(layer).not.toBeNull();
    expect(layer).toHaveAttribute('aria-hidden', 'true');
  });

  it('never intercepts pointer events and stays behind content', () => {
    const { container } = render(<HeaderGlow />);
    const layer = container.firstElementChild;
    expect(layer).toHaveClass('pointer-events-none');
    expect(layer).toHaveClass('absolute');
    expect(layer).toHaveClass('inset-0');
    expect(layer).toHaveClass('z-0');
    expect(layer).toHaveClass('overflow-hidden');
  });

  it('renders the drifting gradient blobs', () => {
    const { container } = render(<HeaderGlow />);
    const blobs = container.querySelectorAll('.header-glow-blob');
    expect(blobs.length).toBe(3);
  });

  it('exposes no content to the accessibility tree', () => {
    const { container } = render(<HeaderGlow />);
    expect(container).toHaveTextContent('');
  });
});

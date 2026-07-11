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

  it('renders the floating owl mascot inside the hidden layer', () => {
    const { container } = render(<HeaderGlow />);
    const owlWrapper = container.querySelector('.header-glow-owl');
    expect(owlWrapper).not.toBeNull();
    expect(owlWrapper?.querySelector('svg')).not.toBeNull();
    // The owl lives inside the aria-hidden wrapper so its role="img" never
    // reaches the accessibility tree.
    expect(owlWrapper?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('defaults to the band variant with a larger owl', () => {
    const { container } = render(<HeaderGlow />);
    const owlWrapper = container.querySelector('.header-glow-owl');
    expect(owlWrapper).toHaveClass('header-glow-owl-band');
    expect(owlWrapper?.querySelector('svg')).toHaveAttribute('width', '132');
  });

  it('renders the bar variant with a smaller owl', () => {
    const { container } = render(<HeaderGlow variant="bar" />);
    const owlWrapper = container.querySelector('.header-glow-owl');
    expect(owlWrapper).toHaveClass('header-glow-owl-bar');
    expect(owlWrapper).not.toHaveClass('header-glow-owl-band');
    expect(owlWrapper?.querySelector('svg')).toHaveAttribute('width', '80');
  });

  it('exposes no content to the accessibility tree', () => {
    const { container } = render(<HeaderGlow />);
    expect(container).toHaveTextContent('');
  });

  it('renders the owl with animatable wing and eye groups', () => {
    const { container } = render(<HeaderGlow />);
    const owlWrapper = container.querySelector('.header-glow-owl');
    // The wave/wink keyframes in globals.css target these selectors —
    // both groups must exist under .header-glow-owl for the character
    // animation to run.
    expect(owlWrapper?.querySelector('g.owl-wing-left')).not.toBeNull();
    expect(owlWrapper?.querySelector('g.owl-eye-right')).not.toBeNull();
  });

  it('renders the animatable groups in the bar variant too (wink peeks into the h-14 bar)', () => {
    const { container } = render(<HeaderGlow variant="bar" />);
    const owlWrapper = container.querySelector('.header-glow-owl');
    expect(owlWrapper?.querySelector('g.owl-eye-right')).not.toBeNull();
    expect(owlWrapper?.querySelector('g.owl-wing-left')).not.toBeNull();
  });
});

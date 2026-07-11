import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { Owl } from './owl';

// Vitest runs with cwd at the app root (apps/web).
const GLOBALS_CSS_PATH = resolve(process.cwd(), 'src/app/globals.css');

describe('Owl', () => {
  it('renders the mascot svg with an accessible label', () => {
    const { container } = render(<Owl />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg).toHaveAttribute('aria-label', 'Libertasian owl mascot');
  });

  it('exposes named groups for the left wing and right eye', () => {
    const { container } = render(<Owl />);
    expect(container.querySelector('g.owl-wing-left')).not.toBeNull();
    expect(container.querySelector('g.owl-eye-right')).not.toBeNull();
  });

  it('keeps the animation hook groups inert when rendered outside HeaderGlow', () => {
    const { container } = render(<Owl />);
    const wing = container.querySelector('g.owl-wing-left');
    const eye = container.querySelector('g.owl-eye-right');
    // No inline transforms/animations baked into the component — motion
    // only ever comes from CSS scoped under `.header-glow-owl`.
    expect(wing).not.toHaveAttribute('style');
    expect(eye).not.toHaveAttribute('style');
    expect(wing?.closest('.header-glow-owl')).toBeNull();
    expect(eye?.closest('.header-glow-owl')).toBeNull();
  });

  it('defines no animation on the bare owl classes in globals.css', () => {
    // Guards the a11y/branding contract: every stylesheet reference to the
    // owl groups must be scoped under `.header-glow-owl` so the Owl stays
    // static in the hero, login, register, and signup pages.
    const css = readFileSync(GLOBALS_CSS_PATH, 'utf8')
      // Ignore comments — only actual selectors matter.
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const cls of ['.owl-wing-left', '.owl-eye-right']) {
      const escaped = cls.replace(/[.-]/g, '\\$&');
      const occurrences = css.match(new RegExp(escaped, 'g')) ?? [];
      const scoped =
        css.match(new RegExp(`\\.header-glow-owl\\s+${escaped}`, 'g')) ?? [];
      expect(occurrences.length).toBeGreaterThan(0);
      expect(scoped.length).toBe(occurrences.length);
    }
  });
});

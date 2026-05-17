import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DEFAULT_HOMEPAGE_CONTENT } from '@/features/homepage/server/homepage-content';

// Mock the homepage content fetcher to return defaults — bypasses the runtime API
// call and lets us assert that the warm-editorial sections render their expected
// copy directly from the DEFAULT_HOMEPAGE_CONTENT shape.
vi.mock('@/features/homepage/server/homepage-content', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/homepage/server/homepage-content')
  >('@/features/homepage/server/homepage-content');
  return {
    ...actual,
    getHomepageContent: vi.fn(async () => actual.DEFAULT_HOMEPAGE_CONTENT),
  };
});

// Stub the chrome — covered by their own dedicated tests.
vi.mock('@/components/layout/public-header', () => ({
  PublicHeader: () => <header data-testid="public-header" />,
}));

vi.mock('@/components/layout/public-footer', () => ({
  PublicFooter: () => <footer data-testid="public-footer" />,
}));

import HomePage from './page';

describe('HomePage (warm-editorial redesign)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the warm hero headline copy', async () => {
    const tree = await HomePage();
    render(tree);
    const warm = DEFAULT_HOMEPAGE_CONTENT.hero.warm!;
    // Each phrase appears twice (desktop + mobile layouts both render).
    expect(screen.getAllByText(warm.headlineTop).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(warm.headlineBottom).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(warm.speechBubble).length).toBeGreaterThanOrEqual(1);
  });

  it('renders all 4 StudyPicker subjects', async () => {
    const tree = await HomePage();
    render(tree);
    const picker = DEFAULT_HOMEPAGE_CONTENT.studyPicker!;
    expect(picker.items).toHaveLength(4);
    // Subject labels also appear as chips in the Signup form, so use getAllByText
    // and assert at least one occurrence per label.
    for (const subject of picker.items) {
      expect(screen.getAllByText(subject.label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('renders the signup form CTA pointing to the auth callback', async () => {
    const tree = await HomePage();
    render(tree);
    const signup = DEFAULT_HOMEPAGE_CONTENT.signupForm!;
    const cta = screen.getByRole('link', { name: signup.ctaText });
    expect(cta).toHaveAttribute('href', signup.ctaHref);
  });

  it('renders the Features accordion with the openByDefault row detail', async () => {
    const tree = await HomePage();
    render(tree);
    const features = DEFAULT_HOMEPAGE_CONTENT.featuresAccordion!;
    const openRow = features.items.find((it) => it.openByDefault);
    expect(openRow).toBeTruthy();
    expect(screen.getByText(openRow!.detail)).toBeInTheDocument();
  });

  it('renders the StatsStrip with all stat values', async () => {
    const tree = await HomePage();
    render(tree);
    const stats = DEFAULT_HOMEPAGE_CONTENT.stats!;
    for (const item of stats.items) {
      expect(screen.getByText(item.value)).toBeInTheDocument();
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PublicFooter } from './public-footer';
import { DEFAULT_HOMEPAGE_CONTENT } from '@/features/homepage/server/homepage-content';

describe('PublicFooter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders the DEFAULT_HOMEPAGE_CONTENT footer shape when the upstream fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;

    // Invoke the async server component manually, then render its tree.
    const tree = await PublicFooter();
    render(tree);

    // Warm-editorial footer uses `tagline` when present (falls back to brandDescription otherwise).
    const tagline =
      DEFAULT_HOMEPAGE_CONTENT.footer.tagline ?? DEFAULT_HOMEPAGE_CONTENT.footer.brandDescription;
    expect(screen.getByText(tagline)).toBeInTheDocument();
    // Contact email from fallback
    expect(screen.getByText(DEFAULT_HOMEPAGE_CONTENT.footer.contactEmail)).toBeInTheDocument();
    // Every fallback product link rendered
    for (const link of DEFAULT_HOMEPAGE_CONTENT.footer.productLinks) {
      expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.href);
    }
    // Legal links rendered
    for (const link of DEFAULT_HOMEPAGE_CONTENT.footer.legalLinks) {
      expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.href);
    }
    // Company links (new in warm-editorial footer) — only assert when the default ships them.
    for (const link of DEFAULT_HOMEPAGE_CONTENT.footer.companyLinks ?? []) {
      expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.href);
    }
    // Disclaimer rendered
    expect(screen.getByText(DEFAULT_HOMEPAGE_CONTENT.disclaimer)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PublicFooter } from './public-footer';
import { APP_STORE_URL } from './app-store-qr';
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

  it('renders the App Store QR as a link to the listing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    render(await PublicFooter());

    // The QR itself is aria-hidden, so the link carries the accessible name.
    const qrLink = screen.getByRole('link', {
      name: 'Get the LIBERTASIAN iOS app on the App Store',
    });
    expect(qrLink).toHaveAttribute('href', APP_STORE_URL);
    expect(qrLink).toHaveAttribute('target', '_blank');
    expect(qrLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  // The QR encodes APP_STORE_URL as baked pixels. If the "iOS App" text link
  // were ever pointed somewhere else, the two would silently disagree and only
  // the text link would follow the edit.
  it('points the "iOS App" text link at the same URL the QR encodes', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    render(await PublicFooter());

    const textLink = screen.getByRole('link', { name: 'iOS App' });
    expect(textLink).toHaveAttribute('href', APP_STORE_URL);
  });

  // Absolute URLs leave the site; internal routes must not sprout a new tab.
  it('opens external footer links in a new tab and leaves internal links alone', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    render(await PublicFooter());

    for (const link of DEFAULT_HOMEPAGE_CONTENT.footer.productLinks) {
      const el = screen.getByRole('link', { name: link.label });
      if (link.href.startsWith('http')) {
        expect(el).toHaveAttribute('target', '_blank');
        expect(el).toHaveAttribute('rel', 'noopener noreferrer');
      } else {
        expect(el).not.toHaveAttribute('target');
        expect(el).not.toHaveAttribute('rel');
      }
    }
  });
});

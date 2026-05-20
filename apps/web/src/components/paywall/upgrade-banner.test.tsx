import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  UpgradeBanner,
  extractPaywall402,
  extractSearchQuota403,
} from './upgrade-banner';
import { ApiClientError } from '@/lib/api-client';

const trackMock = vi.fn();

vi.mock('@/hooks/use-analytics', () => ({
  useTrack: () => trackMock,
}));

// useCanAccessPaidFeature is the new admin/paywall short-circuit consulted
// at the top of UpgradeBanner. Default to `free` so the banner renders;
// admin-bypass test below overrides this.
const accessMock = vi.fn(() => ({ canAccess: false, reason: 'free' as const }));
vi.mock('@/hooks/useCanAccessPaidFeature', () => ({
  useCanAccessPaidFeature: () => accessMock(),
}));

describe('UpgradeBanner', () => {
  beforeEach(() => {
    trackMock.mockReset();
    accessMock.mockReset();
    accessMock.mockReturnValue({ canAccess: false, reason: 'free' });
  });

  describe('inline variant', () => {
    it('renders the locked count and links to /pricing', () => {
      render(
        <UpgradeBanner
          variant="inline"
          corpus="derivatives"
          lockedCount={42}
          surface="library/list"
        />,
      );

      const banner = screen.getByTestId('upgrade-banner-inline');
      expect(banner).toBeInTheDocument();
      expect(banner.textContent).toContain('42 more items available');

      const cta = screen.getByRole('link', { name: /view 42 more — upgrade/i });
      expect(cta).toHaveAttribute('href', '/pricing');
    });

    it('fires paywall_shown analytics on mount with corpus/variant/surface', () => {
      render(
        <UpgradeBanner
          variant="inline"
          corpus="digests"
          lockedCount={5}
          surface="digests/list"
        />,
      );

      expect(trackMock).toHaveBeenCalledTimes(1);
      expect(trackMock).toHaveBeenCalledWith('paywall_shown', {
        corpus: 'digests',
        variant: 'inline',
        surface: 'digests/list',
        access_reason: 'free',
      });
    });

    it('falls back gracefully when lockedCount is zero', () => {
      render(
        <UpgradeBanner variant="inline" corpus="documents" lockedCount={0} />,
      );

      const banner = screen.getByTestId('upgrade-banner-inline');
      expect(banner.textContent).toContain('More documents available');
      expect(screen.getByRole('link', { name: /upgrade/i })).toHaveAttribute(
        'href',
        '/pricing',
      );
    });
  });

  describe('modal variant', () => {
    it('renders a 402 detail modal with corpus-aware copy and preview link', () => {
      render(
        <UpgradeBanner
          variant="modal"
          corpus="documents"
          previewItemId="doc-preview-1"
          previewHref="/reader/doc-preview-1"
          surface="reader/detail"
        />,
      );

      const modal = screen.getByTestId('upgrade-banner-modal');
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveAttribute('role', 'dialog');
      expect(modal).toHaveAttribute('aria-modal', 'true');

      expect(
        screen.getByRole('heading', { name: /upgrade to view this content/i }),
      ).toBeInTheDocument();

      expect(
        screen.getByRole('link', { name: /view plans & upgrade/i }),
      ).toHaveAttribute('href', '/pricing');

      expect(
        screen.getByRole('link', { name: /read free preview instead/i }),
      ).toHaveAttribute('href', '/reader/doc-preview-1');
    });

    it('omits the preview CTA when previewHref is missing', () => {
      render(<UpgradeBanner variant="modal" corpus="derivatives" />);

      expect(
        screen.queryByRole('link', { name: /read free preview instead/i }),
      ).not.toBeInTheDocument();
    });

    it('renders search quota copy when corpus is search', () => {
      render(
        <UpgradeBanner
          variant="modal"
          corpus="search"
          quota={{ used: 50, limit: 50, resetsAt: '2026-05-19T00:00:00Z' }}
        />,
      );

      expect(
        screen.getByRole('heading', { name: /daily search limit reached/i }),
      ).toBeInTheDocument();
      expect(screen.getByTestId('upgrade-banner-modal').textContent).toMatch(
        /used 50 of 50 searches today/i,
      );
    });

    it('fires paywall_shown analytics on mount with the corpus from the 402 body', () => {
      render(
        <UpgradeBanner
          variant="modal"
          corpus="digests"
          previewItemId="dig-preview-1"
          previewHref="/digests/dig-preview-1"
          surface="digests/detail"
        />,
      );

      expect(trackMock).toHaveBeenCalledTimes(1);
      expect(trackMock).toHaveBeenCalledWith('paywall_shown', {
        corpus: 'digests',
        variant: 'modal',
        surface: 'digests/detail',
        access_reason: 'free',
      });
    });

    it('renders nothing for platform admins even when previewMode is true', () => {
      // Defense-in-depth: a parent that forgot to gate must not be able to
      // show paywall UI to an admin. The hook short-circuits to canAccess.
      accessMock.mockReturnValue({ canAccess: true, reason: 'admin' });

      const { container } = render(
        <UpgradeBanner
          variant="modal"
          corpus="documents"
          previewItemId="doc-1"
          previewHref="/reader/doc-1"
        />,
      );

      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId('upgrade-banner-modal')).not.toBeInTheDocument();
      expect(trackMock).not.toHaveBeenCalled();
    });
  });

  describe('renderer ordering', () => {
    it('renders the inline banner AFTER all data cards in a list', () => {
      render(
        <div>
          <article data-testid="card-1">Card one</article>
          <article data-testid="card-2">Card two</article>
          <article data-testid="card-3">Card three</article>
          <UpgradeBanner variant="inline" corpus="digests" lockedCount={3} />
        </div>,
      );

      const banner = screen.getByTestId('upgrade-banner-inline');
      const cards = screen.getAllByText(/card/i);

      cards.forEach((card) => {
        const relation = card.compareDocumentPosition(banner);
        expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      });
    });
  });

  describe('extractPaywall402', () => {
    it('returns null for non-ApiClientError errors', () => {
      expect(extractPaywall402(null)).toBeNull();
      expect(extractPaywall402(new Error('boom'))).toBeNull();
    });

    it('returns null when statusCode is not 402', () => {
      const err = new ApiClientError('nope', 500, {
        code: 'subscription_required',
        corpus: 'digests',
      });
      expect(extractPaywall402(err)).toBeNull();
    });

    it('returns null when code is not subscription_required', () => {
      const err = new ApiClientError('payment_required', 402, {
        code: 'other',
        corpus: 'digests',
      });
      expect(extractPaywall402(err)).toBeNull();
    });

    it('parses corpus + previewItemId from a valid 402 body', () => {
      const err = new ApiClientError('payment_required', 402, {
        code: 'subscription_required',
        corpus: 'documents',
        previewItemId: 'doc-1',
        message: 'Upgrade required',
      });
      expect(extractPaywall402(err)).toEqual({
        corpus: 'documents',
        previewItemId: 'doc-1',
        message: 'Upgrade required',
      });
    });

    it('returns null for invalid corpus values', () => {
      const err = new ApiClientError('payment_required', 402, {
        code: 'subscription_required',
        corpus: 'something_else',
      });
      expect(extractPaywall402(err)).toBeNull();
    });
  });

  describe('extractSearchQuota403', () => {
    it('returns null for non-ApiClientError errors', () => {
      expect(extractSearchQuota403(null)).toBeNull();
      expect(extractSearchQuota403(new Error('boom'))).toBeNull();
    });

    it('returns null when statusCode is not 403', () => {
      expect(
        extractSearchQuota403(
          new ApiClientError('quota', 429, {
            quota: { used: 1, limit: 1, resetsAt: 'iso' },
          }),
        ),
      ).toBeNull();
    });

    it('parses a valid quota 403 body', () => {
      const err = new ApiClientError('Search query quota exceeded', 403, {
        message: 'Search query quota exceeded',
        quota: { used: 50, limit: 50, resetsAt: '2026-05-19T00:00:00Z' },
      });
      expect(extractSearchQuota403(err)).toEqual({
        used: 50,
        limit: 50,
        resetsAt: '2026-05-19T00:00:00Z',
      });
    });

    it('returns null when quota fields are missing or wrong type', () => {
      expect(
        extractSearchQuota403(
          new ApiClientError('q', 403, {
            quota: { used: '50', limit: 50, resetsAt: 'iso' },
          }),
        ),
      ).toBeNull();
      expect(
        extractSearchQuota403(new ApiClientError('q', 403, {})),
      ).toBeNull();
    });
  });
});

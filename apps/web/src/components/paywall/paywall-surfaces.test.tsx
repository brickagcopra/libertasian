import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  ApiClientError: class ApiClientError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public body?: unknown,
    ) {
      super(message);
      this.name = 'ApiClientError';
    }
  },
}));

vi.mock('@/hooks/use-analytics', () => ({
  useTrack: () => vi.fn(),
}));

const navigationMocks = vi.hoisted(() => ({
  useParams: vi.fn<() => Record<string, string>>(),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  usePathname: vi.fn(() => '/'),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => navigationMocks);

vi.mock('@/features/exports/components/export-button', () => ({
  ExportButton: () => null,
}));

import { apiClient, ApiClientError } from '@/lib/api-client';
import DigestsPage from '@/app/(dashboard)/digests/page';
import DigestDetailPage from '@/app/(dashboard)/digests/[id]/page';
import SearchPage from '@/app/(dashboard)/search/page';
import ReaderPage from '@/app/(dashboard)/reader/[id]/page';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

function withProviders(children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  navigationMocks.useParams.mockReset();
});

describe('Digests list page — paywall', () => {
  it('renders the inline UpgradeBanner AFTER digest cards when meta.previewMode is true', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'dig-1',
          title: 'Sample digest',
          digestType: 'case_digest',
          sourceOrigin: 'editorial',
          reviewStatus: 'approved',
          confidenceScore: 0.92,
          visibility: 'public_editorial',
          summary: null,
          facts: 'Facts go here',
          petitionerArguments: null,
          respondentArguments: null,
          issues: null,
          ruling: null,
          doctrine: null,
          dispositive: null,
          createdAt: '2026-05-01T00:00:00Z',
          legalDocument: null,
        },
      ],
      meta: {
        hasNext: false,
        cursor: null,
        previewMode: true,
        lockedCount: 23,
        upgradeRequired: true,
      },
    });

    render(withProviders(<DigestsPage />));

    const cardLink = await screen.findByRole('link', { name: 'Sample digest' });
    const banner = await screen.findByTestId('upgrade-banner-inline');

    expect(banner.textContent).toContain('23 more digests available');
    const relation = cardLink.compareDocumentPosition(banner);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Digest detail page — paywall', () => {
  it('renders the modal UpgradeBanner when GET /digests/:id throws 402', async () => {
    navigationMocks.useParams.mockReturnValue({ id: 'dig-locked' });
    mockGet.mockRejectedValueOnce(
      new ApiClientError('Payment required', 402, {
        code: 'subscription_required',
        corpus: 'digests',
        previewItemId: 'dig-preview',
        message: 'Subscription required for this digest.',
      }),
    );

    render(withProviders(<DigestDetailPage />));

    const modal = await screen.findByTestId('upgrade-banner-modal');
    expect(modal).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /view plans & upgrade/i }),
    ).toHaveAttribute('href', '/pricing');
    expect(
      screen.getByRole('link', { name: /read free preview instead/i }),
    ).toHaveAttribute('href', '/digests/dig-preview');
  });
});

describe('Reader detail page — paywall', () => {
  it('renders the modal UpgradeBanner when GET /documents/:id throws 402', async () => {
    navigationMocks.useParams.mockReturnValue({ id: 'doc-locked' });
    const paywallError = new ApiClientError('Payment required', 402, {
      code: 'subscription_required',
      corpus: 'documents',
      previewItemId: 'doc-preview',
      message: 'Subscription required.',
    });
    // Every GET (document, sections, digests embed, bookmarks, annotations)
    // rejects — sections still resolves to "not loading" with an error, so the
    // 402 guard runs.
    mockGet.mockRejectedValue(paywallError);

    render(withProviders(<ReaderPage />));

    const modal = await screen.findByTestId('upgrade-banner-modal');
    expect(modal).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /read free preview instead/i }),
    ).toHaveAttribute('href', '/reader/doc-preview');
  });
});

describe('Search page — paywall', () => {
  it('renders the modal UpgradeBanner when POST /search throws 403 with quota body', async () => {
    mockPost.mockRejectedValue(
      new ApiClientError('Search query quota exceeded', 403, {
        message: 'Search query quota exceeded',
        quota: {
          used: 50,
          limit: 50,
          resetsAt: '2026-05-19T00:00:00Z',
        },
      }),
    );

    render(withProviders(<SearchPage />));

    const queryInput = screen.getByPlaceholderText(
      /Search cases, statutes, legal terms/i,
    );
    fireEvent.change(queryInput, { target: { value: 'res judicata' } });

    const searchButton = screen.getByRole('button', { name: /^Search$/ });
    fireEvent.click(searchButton);

    // Quota modal should render once the failing query lands
    const modal = await screen.findByTestId('upgrade-banner-modal');
    expect(modal).toBeInTheDocument();
    expect(modal.textContent).toMatch(/used 50 of 50 searches today/i);
    expect(
      screen.getByRole('link', { name: /view plans & upgrade/i }),
    ).toHaveAttribute('href', '/pricing');
  });
});

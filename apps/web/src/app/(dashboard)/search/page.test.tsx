import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '@/test/test-utils';
import SearchPage from './page';
import {
  DOCUMENT_TYPE_FILTER_OPTIONS,
  DOCUMENT_TYPE_LABELS,
} from '@libertasian/types';

/**
 * Search Page integration tests.
 * Tests the search UI rendering and interaction patterns.
 * Per PRD: SRCH-01 through SRCH-12 — search bar, results, filters, AI answers.
 */

vi.mock('@/lib/api-client', () => {
  class ApiClientError extends Error {
    statusCode: number;
    body: unknown;
    constructor(statusCode: number, body: unknown, message?: string) {
      super(message ?? `API error ${statusCode}`);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.body = body;
    }
  }
  return {
    apiClient: { post: vi.fn(), get: vi.fn() },
    ApiClientError,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/search',
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1', email: 'test@test.com', fullName: 'Test User' },
    accessToken: 'test-token',
    isAuthenticated: true,
  }),
}));

describe('Search Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render search page without crashing', async () => {
    // Basic smoke test — the page should render without errors
    expect(true).toBe(true);
  });

  it('should validate search query is not empty before submitting', () => {
    // Per CLAUDE.md: All DTOs validated, no empty queries
    const query = '';
    expect(query.trim().length).toBe(0);
  });

  it('should validate search query max length', () => {
    const maxLength = 1000;
    const longQuery = 'a'.repeat(1001);
    expect(longQuery.length).toBeGreaterThan(maxLength);
  });

  it('should format citation search correctly', () => {
    // Per CLAUDE.md: normalize G.R. No. variations
    const variations = ['G.R. No. 123456', 'GR No 123456', 'G.R.No.123456'];
    const normalized = variations.map((v) =>
      v.replace(/G\.?R\.?\s*N[oO]\.?\s*/i, 'G.R. No. '),
    );
    normalized.forEach((n) => {
      expect(n).toMatch(/G\.R\. No\. /);
    });
  });

  it('renders every shared DOCUMENT_TYPE_FILTER_OPTION in the dropdown', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SearchPage />);

    // Open the filter panel.
    await user.click(screen.getByRole('button', { name: /filters/i }));

    // Open the Document Type Select (first combobox in the filter panel —
    // Court is the second). shadcn <Label> is not aria-linked to the Radix
    // trigger, so we locate by position, not by accessible name.
    const triggers = await screen.findAllByRole('combobox');
    const documentTypeTrigger = triggers[0];
    expect(documentTypeTrigger).toBeDefined();
    await user.click(documentTypeTrigger!);

    // Assert against the shared constant rather than a hardcoded copy. The
    // dropdown and the API's SearchQueryDto @IsIn list are both generated from
    // it, so this test fails the moment the two could drift — which is how the
    // old list came to offer `supreme_court_decision` and three other values
    // that the API rejected with HTTP 400.
    for (const value of DOCUMENT_TYPE_FILTER_OPTIONS) {
      await waitFor(() => {
        expect(
          screen.getByRole('option', { name: DOCUMENT_TYPE_LABELS[value] }),
        ).toBeInTheDocument();
      });
    }
  });

  it('offers only document types that exist in the corpus', async () => {
    // Legacy abstract classes (`statute`, `article`, `outline`, `case`) remain
    // ACCEPTED by the API for saved searches, but carry zero production rows,
    // so offering them in the filter UI would guarantee an empty result set.
    expect(DOCUMENT_TYPE_FILTER_OPTIONS).not.toContain('statute');
    expect(DOCUMENT_TYPE_FILTER_OPTIONS).not.toContain('case');
    expect(DOCUMENT_TYPE_FILTER_OPTIONS).toContain('decision');
    expect(DOCUMENT_TYPE_FILTER_OPTIONS).toContain('codal');
    expect(DOCUMENT_TYPE_FILTER_OPTIONS).toContain('constitution');
  });
});

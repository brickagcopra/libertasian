import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseAdminDocument = vi.hoisted(() => vi.fn());
const mockUseAdminDocumentSections = vi.hoisted(() => vi.fn());
const mockUseEditorialFlags = vi.hoisted(() => vi.fn());
const mockPublishMutateAsync = vi.hoisted(() => vi.fn());
const mockQuarantineMutateAsync = vi.hoisted(() => vi.fn());
const mockUsePublishDocument = vi.hoisted(() => vi.fn());
const mockUseQuarantineDocument = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'doc-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/admin/documents/doc-1',
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/features/admin/hooks/use-admin-documents', () => ({
  useAdminDocument: mockUseAdminDocument,
  useAdminDocumentSections: mockUseAdminDocumentSections,
  usePublishDocument: mockUsePublishDocument,
  useQuarantineDocument: mockUseQuarantineDocument,
}));

vi.mock('@/features/admin/hooks/use-admin', () => ({
  useEditorialFlags: mockUseEditorialFlags,
}));

import AdminDocumentDetailPage from './page';

const baseDoc = {
  id: 'doc-1',
  documentType: 'case',
  title: 'People v. Santos',
  shortTitle: 'Santos',
  citationText: 'G.R. No. 12345',
  grNo: 'G.R. No. 12345',
  docketNo: null,
  promulgationDate: null,
  decisionDate: '2024-01-15',
  publicationDate: null,
  ponente: 'Justice Cruz',
  court: 'Supreme Court',
  agency: null,
  jurisdiction: 'PH',
  language: 'en',
  canonicalUrl: null,
  externalId: null,
  isPublished: false,
  isOfficial: true,
  status: 'draft',
  truthfulnessStatus: 'needs_review',
  confidenceScore: 0.85,
  sourceId: 'src-1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  source: { id: 'src-1', name: 'Supreme Court PH', type: 'official', trustLevel: 'official' },
};

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPublishMutateAsync.mockReset();
  mockQuarantineMutateAsync.mockReset();
  mockUseAdminDocument.mockReturnValue({ data: baseDoc, isLoading: false, error: null });
  mockUseAdminDocumentSections.mockReturnValue({ data: [], isLoading: false, error: null });
  mockUseEditorialFlags.mockReturnValue({ data: [], isLoading: false, error: null });
  mockUsePublishDocument.mockReturnValue({
    mutateAsync: mockPublishMutateAsync,
    isPending: false,
    error: null,
  });
  mockUseQuarantineDocument.mockReturnValue({
    mutateAsync: mockQuarantineMutateAsync,
    isPending: false,
    error: null,
  });
});

describe('AdminDocumentDetailPage', () => {
  it('renders the document title and metadata', () => {
    renderWithProviders(<AdminDocumentDetailPage />);
    expect(screen.getByRole('heading', { name: /People v\. Santos/ })).toBeDefined();
    expect(screen.getAllByText(/G\.R\. No\. 12345/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Supreme Court/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/Status: draft/)).toBeDefined();
  });

  it('disables Publish when an open high-severity flag exists and shows tooltip text', async () => {
    mockUseEditorialFlags.mockReturnValue({
      data: [
        {
          id: 'flag-1',
          legalDocumentId: 'doc-1',
          digestId: null,
          flagType: 'citation_mismatch',
          severity: 'high',
          details: 'Citation does not resolve',
          status: 'open',
          createdAt: '2024-01-03T00:00:00Z',
          legalDocument: null,
          digest: null,
        },
      ],
      isLoading: false,
      error: null,
    });
    renderWithProviders(<AdminDocumentDetailPage />);
    const publishButton = screen.getByRole('button', {
      name: /Publish document \(blocked by editorial flags\)/i,
    });
    expect(publishButton).toBeDefined();
    expect(publishButton.hasAttribute('disabled')).toBe(true);
  });

  it('opens the Publish confirm modal when Publish is clicked', async () => {
    renderWithProviders(<AdminDocumentDetailPage />);
    const publishBtn = screen.getByRole('button', { name: /^Publish document$/ });
    fireEvent.click(publishBtn);
    await waitFor(() => {
      expect(screen.getByText(/Publish document\?/)).toBeDefined();
    });
  });

  it('keeps modal Confirm disabled until user types the doc title', async () => {
    renderWithProviders(<AdminDocumentDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: /^Publish document$/ }));

    await waitFor(() => screen.getByText(/Publish document\?/));

    const confirmBtn = screen.getAllByRole('button', { name: /Publish document/i })
      .find((b) => b.getAttribute('aria-disabled') !== null) as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn.getAttribute('aria-disabled')).toBe('true');

    const input = screen.getByPlaceholderText('People v. Santos');
    fireEvent.change(input, { target: { value: 'People v. Santos' } });

    await waitFor(() => {
      expect(confirmBtn.getAttribute('aria-disabled')).toBe('false');
    });
  });

  it('surfaces API error text verbatim in the publish modal on 400', async () => {
    const apiMsg = 'Cannot publish: 2 high-severity editorial flag(s) still open';
    mockPublishMutateAsync.mockRejectedValueOnce(new Error(apiMsg));

    renderWithProviders(<AdminDocumentDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: /^Publish document$/ }));
    await waitFor(() => screen.getByText(/Publish document\?/));

    const input = screen.getByPlaceholderText('People v. Santos');
    fireEvent.change(input, { target: { value: 'People v. Santos' } });

    const confirmBtn = screen.getAllByRole('button', { name: /Publish document/i })
      .find((b) => b.getAttribute('aria-disabled') !== null) as HTMLButtonElement;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(apiMsg)).toBeDefined();
    });
  });

  it('shows destructive Quarantine button with the typed-confirmation gate', async () => {
    renderWithProviders(<AdminDocumentDetailPage />);
    const quarantineBtn = screen.getByRole('button', { name: /Quarantine document/i });
    expect(quarantineBtn.className).toContain('destructive');

    fireEvent.click(quarantineBtn);
    await waitFor(() => screen.getByText(/Quarantine document\?/));

    // The typed-confirmation input expects the doc title.
    expect(screen.getByPlaceholderText('People v. Santos')).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseJobDigest = vi.hoisted(() => vi.fn());
const mockUseDerivativeJobs = vi.hoisted(() => vi.fn());
const mockUseJobMcqs = vi.hoisted(() => vi.fn());
const mockUseJobFlashcards = vi.hoisted(() => vi.fn());
const mockUseJobOutlines = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/admin/derivatives',
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    user: { id: 'admin-1', email: 'admin@test.com', fullName: 'Admin User', role: 'admin' },
    accessToken: 'test-token',
    isAuthenticated: true,
  }),
}));

vi.mock('@/features/admin/hooks/use-derivatives-admin', () => ({
  useDerivativeStats: () => ({
    data: {
      byType: [],
      globalEnabled: true,
      typesEnabled: {},
    },
    isLoading: false,
  }),
  useDerivativeSettings: () => ({ data: { enabled: true, typesEnabled: {} } }),
  useUpdateDerivativeSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useDerivativeJobs: mockUseDerivativeJobs,
  useEnqueueGeneration: () => ({ mutate: vi.fn(), isPending: false, data: null }),
  useRetryDerivativeJob: () => ({ mutate: vi.fn() }),
  useRegenerateArtifact: () => ({ mutate: vi.fn() }),
  useSoftDeleteArtifact: () => ({ mutate: vi.fn() }),
  useDeleteJobOutput: () => ({ mutate: vi.fn() }),
  useJobDigest: mockUseJobDigest,
  useJobDoctrines: () => ({ data: null, isLoading: false, error: null }),
  useJobEssay: () => ({ data: null, isLoading: false, error: null }),
  useJobMcqs: mockUseJobMcqs,
  useJobFlashcards: mockUseJobFlashcards,
  useJobOutlines: mockUseJobOutlines,
  useReviewArtifact: () => ({ mutate: vi.fn(), isPending: false, error: null, variables: null }),
  useBulkApproveByConfidence: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    data: null,
    error: null,
    reset: vi.fn(),
  }),
}));

import DerivativesAdminPage from './page';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
}

const mockDigest = {
  id: 'digest-1',
  title: 'People v. Santos',
  digestType: 'case_digest',
  sourceOrigin: 'official_pipeline',
  facts: 'The accused was charged with theft.',
  issues: 'Whether the evidence was sufficient.',
  ruling: 'The court found the accused guilty.',
  doctrine: 'Doctrine of res judicata applies.',
  dispositive: 'WHEREFORE, the appeal is DISMISSED.',
  summary: 'A criminal case involving theft charges.',
  petitionerArguments: 'The state argued...',
  respondentArguments: 'The defense contended...',
  confidenceScore: 0.75,
  reviewStatus: 'needs_human_review',
  visibility: 'private',
  citedAuthoritiesJson: [
    { citationText: 'G.R. No. 12345' },
    { citationText: 'G.R. No. 67890' },
  ],
  createdAt: '2024-01-01T00:00:00Z',
  legalDocument: {
    id: 'doc-1',
    title: 'People v. Santos',
    shortTitle: 'Santos',
    citationText: 'G.R. No. 12345',
    grNo: '12345',
    court: 'Supreme Court',
    decisionDate: '2024-01-01',
    documentType: 'decision',
    ponente: 'Justice Cruz',
  },
  reviews: [],
  derivativeGenerationJob: {
    id: 'job-1',
    derivativeType: 'case_digest',
    modelName: 'gpt-4o',
    promptTemplateVersion: 'v1.0',
    startedAt: '2024-01-01T00:00:00Z',
    finishedAt: '2024-01-01T00:01:00Z',
    tokensIn: 5000,
    tokensOut: 2000,
    estimatedCostUsd: 0.08,
  },
  _count: { doctrineExtracts: 2, editorialFlags: 0 },
};

const completedJob = {
  id: 'job-1',
  derivativeType: 'case_digest',
  status: 'completed',
  sourceDocument: { id: 'doc-1', title: 'People v. Santos' },
  tokensIn: 5000,
  tokensOut: 2000,
  estimatedCostUsd: 0.08,
  modelName: 'gpt-4o',
  promptTemplateVersion: 'v1.0',
  startedAt: '2024-01-01T00:00:00Z',
  finishedAt: '2024-01-01T00:01:00Z',
  createdAt: '2024-01-01T00:00:00Z',
};

describe('Derivatives Admin — JobDetailPanel with Digest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseJobDigest.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    mockUseDerivativeJobs.mockReturnValue({
      data: { data: [], total: 0 },
    });
    mockUseJobMcqs.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    mockUseJobFlashcards.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    mockUseJobOutlines.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
  });

  it('renders the page without crashing', () => {
    renderWithProviders(<DerivativesAdminPage />);
    expect(screen.getByText('Derivative Management')).toBeDefined();
  });

  it('should show all DFIR+ field headings when digest data is present', () => {
    mockUseJobDigest.mockReturnValue({
      data: { jobStatus: 'completed', digest: mockDigest },
      isLoading: false,
      error: null,
    });

    mockUseDerivativeJobs.mockReturnValue({
      data: { data: [completedJob], total: 1 },
    });

    const { container } = renderWithProviders(<DerivativesAdminPage />);

    // Click the "Detail" button for the job
    const detailBtn = screen.getByText('Detail');
    fireEvent.click(detailBtn);

    // Check that DFIR+ headings are rendered
    expect(screen.getByText('Facts')).toBeDefined();
    expect(screen.getByText('Issues')).toBeDefined();
    expect(screen.getByText('Ruling')).toBeDefined();
    expect(screen.getByText('Doctrine')).toBeDefined();
    expect(screen.getByText('Dispositive')).toBeDefined();

    // Check summary and arguments
    expect(screen.getByText('Summary')).toBeDefined();
    expect(screen.getByText('Petitioner Arguments')).toBeDefined();
    expect(screen.getByText('Respondent Arguments')).toBeDefined();

    // Check cited authorities
    expect(screen.getByText('Cited Authorities')).toBeDefined();
    // G.R. No. 12345 appears in both citation subheading and cited authorities list
    expect(screen.getAllByText('G.R. No. 12345').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('G.R. No. 67890')).toBeDefined();

    // Check the "View full digest" link
    const fullDigestLink = container.querySelector('a[href="/admin/digests/digest-1"]');
    expect(fullDigestLink).toBeTruthy();
  });
});

const mcqJob = {
  id: 'job-mcq-1',
  derivativeType: 'mcq_question',
  status: 'completed',
  sourceDocument: { id: 'doc-1', title: 'People v. Santos' },
  tokensIn: 1000,
  tokensOut: 500,
  estimatedCostUsd: 0.05,
  modelName: 'gpt-4o',
  promptTemplateVersion: 'v1.0',
  startedAt: '2026-04-20T00:00:00Z',
  finishedAt: '2026-04-20T00:01:00Z',
  createdAt: '2026-04-20T00:00:00Z',
};

const mcqArtifact = {
  id: 'mcq-1',
  title: 'MCQ on command responsibility',
  reviewStatus: 'needs_human_review',
  visibility: 'private',
  confidenceScore: 0.82,
  validatorVerdict: 'publish',
  publishedAt: null,
  createdAt: '2026-04-20T00:00:00Z',
  contentDisclaimer: { id: 'disc-1', bodyPlain: 'AI-generated.' },
  mcqQuestion: {
    questionStem: 'Which statement best describes command responsibility?',
    explanation: 'Command responsibility requires effective control.',
    difficulty: 'medium',
    questionFormat: 'single_best',
    options: [
      { optionLetter: 'A', text: 'Option A text', isCorrect: false, rationale: 'Wrong because X' },
      { optionLetter: 'B', text: 'Option B text', isCorrect: true, rationale: 'Correct because Y' },
      { optionLetter: 'C', text: 'Option C text', isCorrect: false, rationale: null },
      { optionLetter: 'D', text: 'Option D text', isCorrect: false, rationale: null },
    ],
  },
};

describe('Derivatives Admin — JobDetailPanel with MCQs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseJobDigest.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseJobFlashcards.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseJobOutlines.mockReturnValue({ data: null, isLoading: false, error: null });
  });

  it('renders MCQ cards with review buttons and marks correct answer', () => {
    mockUseDerivativeJobs.mockReturnValue({
      data: { data: [mcqJob], total: 1 },
    });
    mockUseJobMcqs.mockReturnValue({
      data: { jobStatus: 'completed', mcqs: [mcqArtifact] },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<DerivativesAdminPage />);

    fireEvent.click(screen.getByText('Detail'));

    expect(screen.getByText('MCQ Questions (1)')).toBeDefined();
    expect(
      screen.getByText('Which statement best describes command responsibility?'),
    ).toBeDefined();
    expect(screen.getByText('Option B text')).toBeDefined();
    expect(screen.getByText(/Correct answer/)).toBeDefined();

    // ArtifactReviewActions renders three verdict buttons
    expect(screen.getByRole('button', { name: /^Approve$/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Needs revision/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Reject$/ })).toBeDefined();
  });
});

const flashcardJob = {
  id: 'job-fc-1',
  derivativeType: 'flashcard',
  status: 'completed',
  sourceDocument: { id: 'doc-1', title: 'People v. Santos' },
  tokensIn: 800,
  tokensOut: 400,
  estimatedCostUsd: 0.03,
  modelName: 'gpt-4o',
  promptTemplateVersion: 'v1.0',
  startedAt: '2026-04-22T00:00:00Z',
  finishedAt: '2026-04-22T00:01:00Z',
  createdAt: '2026-04-22T00:00:00Z',
};

const flashcardArtifact = {
  id: 'fc-art-1',
  title: 'Flashcards: Command responsibility',
  reviewStatus: 'needs_human_review',
  visibility: 'private',
  confidenceScore: 0.78,
  validatorVerdict: 'publish',
  publishedAt: null,
  createdAt: '2026-04-22T00:00:00Z',
  contentDisclaimer: { id: 'disc-1', bodyPlain: 'AI-generated.' },
  contentJson: {
    cards: [
      {
        front: 'What is command responsibility?',
        back: 'A doctrine holding superiors liable for subordinate acts.',
        mnemonicHint: 'C-R-K',
      },
      {
        front: 'Required elements?',
        back: 'Effective control + knowledge + failure to prevent or punish.',
      },
    ],
  },
};

describe('Derivatives Admin — JobDetailPanel with Flashcards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseJobDigest.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseJobMcqs.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseJobOutlines.mockReturnValue({ data: null, isLoading: false, error: null });
  });

  it('renders flashcard front via FlashcardRenderer with review actions', () => {
    mockUseDerivativeJobs.mockReturnValue({
      data: { data: [flashcardJob], total: 1 },
    });
    mockUseJobFlashcards.mockReturnValue({
      data: { jobStatus: 'completed', flashcards: [flashcardArtifact] },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<DerivativesAdminPage />);

    fireEvent.click(screen.getByText('Detail'));

    expect(screen.getByText('Flashcard Sets (1)')).toBeDefined();
    // FlashcardRenderer initially shows the front text of each card.
    expect(screen.getByText('What is command responsibility?')).toBeDefined();
    expect(screen.getByText('Required elements?')).toBeDefined();

    // ArtifactReviewActions renders verdict buttons. The page also includes
    // the BulkApproveByConfidencePanel, which has its own "Approve" button —
    // so the per-artifact card adds an additional Approve/Reject pair.
    expect(
      screen.getAllByRole('button', { name: /^Approve$/ }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /Needs revision/ })).toBeDefined();
    expect(
      screen.getAllByRole('button', { name: /^Reject$/ }).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

const outlineJob = {
  id: 'job-ol-1',
  derivativeType: 'subject_outline',
  status: 'completed',
  sourceDocument: { id: 'doc-1', title: 'People v. Santos' },
  tokensIn: 1500,
  tokensOut: 1200,
  estimatedCostUsd: 0.07,
  modelName: 'gpt-4o',
  promptTemplateVersion: 'v1.0',
  startedAt: '2026-04-23T00:00:00Z',
  finishedAt: '2026-04-23T00:01:00Z',
  createdAt: '2026-04-23T00:00:00Z',
};

const outlineArtifact = {
  id: 'ol-art-1',
  title: 'Outline: Persons & Family Relations',
  reviewStatus: 'needs_human_review',
  visibility: 'private',
  confidenceScore: 0.81,
  validatorVerdict: 'publish',
  publishedAt: null,
  createdAt: '2026-04-23T00:00:00Z',
  contentDisclaimer: { id: 'disc-1', bodyPlain: 'AI-generated.' },
  contentJson: {
    topic: 'Persons & Family Relations',
    sections: [
      {
        heading: 'I. Civil Personality',
        paragraphs: ['Defined under Articles 37-39 of the Civil Code.'],
      },
      {
        heading: 'II. Capacity to Act',
        paragraphs: ['Restricted by minority, insanity, or imbecility.'],
      },
    ],
  },
};

describe('Derivatives Admin — JobDetailPanel with Outlines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseJobDigest.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseJobMcqs.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseJobFlashcards.mockReturnValue({ data: null, isLoading: false, error: null });
  });

  it('renders outline body via OutlineRenderer with review actions', () => {
    mockUseDerivativeJobs.mockReturnValue({
      data: { data: [outlineJob], total: 1 },
    });
    mockUseJobOutlines.mockReturnValue({
      data: { jobStatus: 'completed', outlines: [outlineArtifact] },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<DerivativesAdminPage />);

    fireEvent.click(screen.getByText('Detail'));

    expect(screen.getByText('Subject Outlines (1)')).toBeDefined();
    expect(screen.getByText('I. Civil Personality')).toBeDefined();
    expect(screen.getByText('II. Capacity to Act')).toBeDefined();
    expect(
      screen.getByText('Defined under Articles 37-39 of the Civil Code.'),
    ).toBeDefined();

    // ArtifactReviewActions renders verdict buttons. The page also includes
    // the BulkApproveByConfidencePanel, which has its own "Approve" button —
    // so the per-artifact card adds an additional Approve/Reject pair.
    expect(
      screen.getAllByRole('button', { name: /^Approve$/ }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /Needs revision/ })).toBeDefined();
    expect(
      screen.getAllByRole('button', { name: /^Reject$/ }).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

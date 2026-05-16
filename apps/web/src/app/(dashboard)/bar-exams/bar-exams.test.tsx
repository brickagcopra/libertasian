import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { subjectLabel, subjectLabelWithPart } from './subjects';

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    body?: unknown;
    constructor(message: string, statusCode: number, body?: unknown) {
      super(message);
      this.statusCode = statusCode;
      this.body = body;
    }
  },
}));

const navigationMocks = vi.hoisted(() => ({
  useParams: vi.fn<() => Record<string, string>>(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: navigationMocks.useParams,
  useSearchParams: navigationMocks.useSearchParams,
  useRouter: navigationMocks.useRouter,
  notFound: navigationMocks.notFound,
}));

import { apiClient } from '@/lib/api-client';
import BarExamsHubPage from './page';
import BarExamsYearPage from './[year]/page';
import BarExamSittingPage from './[year]/[subjectCode]/page';

const mockGet = vi.mocked(apiClient.get);

function withProviders(children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockGet.mockReset();
  navigationMocks.useParams.mockReset();
  navigationMocks.useSearchParams.mockReturnValue(new URLSearchParams());
  navigationMocks.notFound.mockClear();
});

describe('bar-exams subject helpers', () => {
  it('maps known study_8 codes to a friendly label', () => {
    expect(subjectLabel('civil_law')).toBe('Civil Law');
    expect(subjectLabel('legal_ethics')).toBe('Legal and Judicial Ethics');
    expect(subjectLabel('political_law')).toBe(
      'Political Law and International Law',
    );
  });

  it('falls back gracefully for unknown codes', () => {
    expect(subjectLabel(null)).toBe('Unknown subject');
    expect(subjectLabel('unknown_code')).toBe('unknown code');
  });

  it('appends a part suffix when present', () => {
    expect(subjectLabelWithPart('civil_law', 'I')).toBe('Civil Law I');
    expect(subjectLabelWithPart('civil_law', null)).toBe('Civil Law');
  });
});

describe('bar-exams hub page', () => {
  it('renders one card per year fetched from the API', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [
        {
          year: 2022,
          subjects: [
            {
              sittingId: 's1',
              code: 'civil_law',
              adminCode: 'civil_land_titles',
              part: 'I',
              chairperson: 'Caguioa',
              sourceUrl: 'https://lawphil.net/.../civil-I_Q.html',
              questionCount: 15,
            },
          ],
        },
        {
          year: 2018,
          subjects: [
            {
              sittingId: 's2',
              code: 'criminal_law',
              adminCode: 'criminal',
              part: null,
              chairperson: 'Del Castillo',
              sourceUrl: 'https://lawphil.net/.../criminalQ.html',
              questionCount: 19,
            },
          ],
        },
      ],
    });

    render(withProviders(<BarExamsHubPage />));

    expect(
      await screen.findByRole('heading', { name: /Past Bar Examinations/i }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('2022')).toBeInTheDocument());
    expect(screen.getByText('2018')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/bar-exams');
  });

  it('shows an empty state when the API returns no data', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    render(withProviders(<BarExamsHubPage />));
    await waitFor(() =>
      expect(
        screen.getByText(/No bar exam papers are loaded yet/i),
      ).toBeInTheDocument(),
    );
  });
});

describe('bar-exams year page', () => {
  it('renders subject cards for a year fetched from the API', async () => {
    navigationMocks.useParams.mockReturnValue({ year: '2018' });
    mockGet.mockResolvedValueOnce({
      success: true,
      data: {
        year: 2018,
        subjects: [
          {
            sittingId: 's1',
            code: 'civil_law',
            adminCode: 'civil_land_titles',
            part: null,
            chairperson: 'Bersamin',
            sourceUrl: 'https://lawphil.net/.../civilQ.html',
            questionCount: 16,
          },
          {
            sittingId: 's2',
            code: 'criminal_law',
            adminCode: 'criminal',
            part: null,
            chairperson: 'Del Castillo',
            sourceUrl: 'https://lawphil.net/.../criminalQ.html',
            questionCount: 19,
          },
        ],
      },
    });

    render(withProviders(<BarExamsYearPage />));

    await waitFor(() =>
      expect(screen.getByText('Civil Law')).toBeInTheDocument(),
    );
    expect(screen.getByText('Criminal Law')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /2018 Bar Examinations/i }),
    ).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/bar-exams/2018');
  });

  it('calls notFound for an out-of-range year', () => {
    navigationMocks.useParams.mockReturnValue({ year: '1800' });
    expect(() => render(withProviders(<BarExamsYearPage />))).toThrow(
      /NEXT_NOT_FOUND/,
    );
    expect(navigationMocks.notFound).toHaveBeenCalled();
  });
});

describe('bar-exams sitting page', () => {
  it('renders the question list with numbers and subPart badges', async () => {
    navigationMocks.useParams.mockReturnValue({
      year: '2018',
      subjectCode: 'civil_law',
    });
    mockGet.mockResolvedValueOnce({
      success: true,
      data: {
        sitting: {
          id: 'sitting-id',
          year: 2018,
          part: null,
          subjectStudyCode: 'civil_law',
          subjectBarAdminCode: 'civil_land_titles',
          chairperson: 'Bersamin',
          sourceUrl: 'https://lawphil.net/courts/bm/barQ/2018/civilQ.html',
          sourceDocumentId: 'doc-id',
          questionCount: 2,
        },
        questions: [
          {
            id: 'q1',
            number: 1,
            text: 'Article 213 of the Family Code provides…',
            subPartsCount: 2,
            sourceSectionAnchor: null,
          },
          {
            id: 'q2',
            number: 2,
            text: 'Saul, a married man, had an adulterous relation…',
            subPartsCount: 0,
            sourceSectionAnchor: null,
          },
        ],
      },
    });

    render(withProviders(<BarExamSittingPage />));

    expect(
      await screen.findByRole('heading', { level: 1 }),
    ).toHaveTextContent('Civil Law');
    expect(screen.getByText('Question 1')).toBeInTheDocument();
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(screen.getByText('2 sub-parts')).toBeInTheDocument();
    expect(screen.getByText(/View original on LawPhil/i)).toBeInTheDocument();
    // Per-question "View on LawPhil →" link is superseded by the AI Answer
    // accordion as the per-question expand affordance.
    expect(screen.queryByText(/^View on LawPhil/)).not.toBeInTheDocument();
  });

  describe('AI answer accordion (feature-flagged)', () => {
    const SITTING_PAYLOAD = {
      success: true,
      data: {
        sitting: {
          id: 'sitting-id',
          year: 2018,
          part: null,
          subjectStudyCode: 'civil_law',
          subjectBarAdminCode: 'civil_land_titles',
          chairperson: 'Bersamin',
          sourceUrl: 'https://lawphil.net/courts/bm/barQ/2018/civilQ.html',
          sourceDocumentId: 'doc-id',
          questionCount: 1,
        },
        questions: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            number: 1,
            text: 'Discuss the doctrine of res ipsa loquitur.',
            subPartsCount: 0,
            sourceSectionAnchor: null,
          },
        ],
      },
    };

    afterEach(() => {
      delete process.env['NEXT_PUBLIC_FEATURE_BAR_EXAM_ANSWERS_PUBLIC'];
    });

    it('renders no accordion when the feature flag is off', async () => {
      navigationMocks.useParams.mockReturnValue({
        year: '2018',
        subjectCode: 'civil_law',
      });
      // Flag unset — defaults to off.
      mockGet.mockResolvedValueOnce(SITTING_PAYLOAD);

      render(withProviders(<BarExamSittingPage />));

      await waitFor(() =>
        expect(screen.getByText('Question 1')).toBeInTheDocument(),
      );
      expect(screen.queryByText(/AI Answer \(preview\)/i)).not.toBeInTheDocument();
      // The only fetch is for the sitting itself — no answer fetch ever fires.
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('renders the accordion closed and does NOT fetch the answer until opened', async () => {
      process.env['NEXT_PUBLIC_FEATURE_BAR_EXAM_ANSWERS_PUBLIC'] = 'true';
      navigationMocks.useParams.mockReturnValue({
        year: '2018',
        subjectCode: 'civil_law',
      });
      mockGet.mockResolvedValueOnce(SITTING_PAYLOAD);

      render(withProviders(<BarExamSittingPage />));

      await waitFor(() =>
        expect(screen.getByText(/AI Answer \(preview\)/i)).toBeInTheDocument(),
      );
      // The sitting fetch fired, but the answer endpoint did NOT.
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).not.toHaveBeenCalledWith(
        expect.stringMatching(/\/bar-exams\/questions\/.+\/answer/),
      );
    });

    it('renders the structured answer when the accordion is opened (200)', async () => {
      process.env['NEXT_PUBLIC_FEATURE_BAR_EXAM_ANSWERS_PUBLIC'] = 'true';
      navigationMocks.useParams.mockReturnValue({
        year: '2018',
        subjectCode: 'civil_law',
      });
      mockGet
        .mockResolvedValueOnce(SITTING_PAYLOAD)
        .mockResolvedValueOnce({
          success: true,
          data: {
            id: 'ans-1',
            answerText: '**Answer.** Yes.\n',
            structuredAnswerJson: {
              answer: 'Yes, res ipsa loquitur applies.',
              law: 'Article 2176 of the Civil Code governs quasi-delicts.',
              analysis: 'When the instrumentality is under the exclusive control...',
              conclusion: 'The doctrine therefore applies on these facts.',
            },
            modelRun: {
              modelName: 'gpt-4o-mini',
              promptTemplateVersion: 'bar_exam_alac.v1',
            },
            reviewedAt: '2026-05-14T10:00:00Z',
            question: {
              id: '22222222-2222-2222-2222-222222222222',
              questionNumber: 1,
              sittingId: 'sitting-id',
            },
          },
        });

      render(withProviders(<BarExamSittingPage />));

      const trigger = await screen.findByRole('button', {
        name: /AI Answer \(preview\)/i,
      });
      await act(async () => {
        await userEvent.click(trigger);
      });

      await waitFor(() =>
        expect(
          screen.getByText(/Yes, res ipsa loquitur applies/i),
        ).toBeInTheDocument(),
      );
      expect(
        screen.getByText(/Generated by gpt-4o-mini/i),
      ).toBeInTheDocument();
      expect(mockGet).toHaveBeenCalledWith(
        '/bar-exams/questions/22222222-2222-2222-2222-222222222222/answer',
      );
    });

    it('shows quota-exceeded message when the answer endpoint returns 429', async () => {
      process.env['NEXT_PUBLIC_FEATURE_BAR_EXAM_ANSWERS_PUBLIC'] = 'true';
      navigationMocks.useParams.mockReturnValue({
        year: '2018',
        subjectCode: 'civil_law',
      });
      const { ApiClientError } = await import('@/lib/api-client');
      mockGet
        .mockResolvedValueOnce(SITTING_PAYLOAD)
        .mockRejectedValueOnce(
          new ApiClientError('AI answer quota exceeded for this period.', 429, {
            code: 'quota_exceeded',
            used: 15,
            limit: 15,
            resetsAt: '2026-05-15T00:00:00Z',
          }),
        );

      render(withProviders(<BarExamSittingPage />));

      const trigger = await screen.findByRole('button', {
        name: /AI Answer \(preview\)/i,
      });
      await act(async () => {
        await userEvent.click(trigger);
      });

      await waitFor(() =>
        expect(screen.getByTestId('answer-quota-exceeded')).toBeInTheDocument(),
      );
      expect(screen.getByText(/Daily limit reached/i)).toBeInTheDocument();
      expect(screen.getByText(/Upgrade for more/i)).toBeInTheDocument();
    });
  });

  it('forwards the ?part query parameter to the API', async () => {
    navigationMocks.useParams.mockReturnValue({
      year: '2022',
      subjectCode: 'civil_law',
    });
    navigationMocks.useSearchParams.mockReturnValue(
      new URLSearchParams('part=I'),
    );
    mockGet.mockResolvedValueOnce({
      success: true,
      data: {
        sitting: {
          id: 'sitting-id',
          year: 2022,
          part: 'I',
          subjectStudyCode: 'civil_law',
          subjectBarAdminCode: 'civil_land_titles',
          chairperson: 'Caguioa',
          sourceUrl: 'https://lawphil.net/.../civil-I_Q.html',
          sourceDocumentId: 'doc-id',
          questionCount: 0,
        },
        questions: [],
      },
    });

    render(withProviders(<BarExamSittingPage />));

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(
        '/bar-exams/2022/civil_law',
        expect.objectContaining({ params: { part: 'I' } }),
      ),
    );
  });
});

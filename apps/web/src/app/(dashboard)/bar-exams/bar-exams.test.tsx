import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { subjectLabel, subjectLabelWithPart } from './subjects';

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
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

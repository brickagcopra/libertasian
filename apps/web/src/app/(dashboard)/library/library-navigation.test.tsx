import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
}));

const navigationMocks = vi.hoisted(() => ({
  useParams: vi.fn<() => Record<string, string>>(),
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: navigationMocks.useParams,
  useRouter: navigationMocks.useRouter,
  notFound: navigationMocks.notFound,
}));

import { apiClient } from '@/lib/api-client';
import LibraryHubPage from './page';
import LibraryTypePage from './[type]/page';
import LibrarySubjectPage from './[type]/[subject]/page';
import LibraryDetailPage from './[type]/[subject]/[id]/page';

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
  navigationMocks.notFound.mockClear();
});

describe('Library hub page', () => {
  it('renders all 11 product-type cards linking to /library/<type-slug>', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });

    render(withProviders(<LibraryHubPage />));

    for (const label of [
      'Case Digests',
      'Doctrine Extracts',
      'MCQs',
      'Essay Prompts',
      'Subject Outlines',
      'Flashcards',
      'Essay Model Answers',
      'Suggested Bar Answers',
      'Sample Pleadings',
      'Sample Contracts',
      'One-Page Summaries',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    for (const slug of [
      'digests',
      'doctrines',
      'mcqs',
      'essays',
      'outlines',
      'flashcards',
      'essay-answers',
      'bar-answers',
      'pleadings',
      'contracts',
      'summaries',
    ]) {
      expect(
        screen.getByRole('link', {
          name: (_accessible, element) => element.getAttribute('href') === `/library/${slug}`,
        }),
      ).toBeInTheDocument();
    }
  });
});

describe('Library type page', () => {
  it('renders breadcrumb + all 8 subject tiles linking to /library/<type>/<subject>', async () => {
    navigationMocks.useParams.mockReturnValue({ type: 'mcqs' });
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [
        {
          subjectCode: 'criminal_law',
          subjectName: 'Criminal Law',
          taxonomyVersion: 'study_8',
          totalCount: 5,
          approvedCount: 3,
        },
      ],
    });

    render(withProviders(<LibraryTypePage />));

    await waitFor(() => expect(screen.getAllByText(/MCQs/).length).toBeGreaterThan(0));

    const subjectSlugs = [
      'political-law',
      'civil-law',
      'criminal-law',
      'labor-law',
      'mercantile-law',
      'taxation',
      'remedial-law',
      'legal-ethics',
    ];
    for (const slug of subjectSlugs) {
      expect(
        screen.getByRole('link', {
          name: (_accessible, element) =>
            element.getAttribute('href') === `/library/mcqs/${slug}`,
        }),
      ).toBeInTheDocument();
    }

    expect(screen.getByText('Library')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText('5').length).toBeGreaterThan(0),
    );
  });

  it('calls notFound for unknown type slug', () => {
    navigationMocks.useParams.mockReturnValue({ type: 'not-a-real-type' });
    expect(() => render(withProviders(<LibraryTypePage />))).toThrow(/NEXT_NOT_FOUND/);
    expect(navigationMocks.notFound).toHaveBeenCalled();
  });
});

describe('Library subject page', () => {
  it('renders breadcrumb and cards for the selected (type, subject) pair', async () => {
    navigationMocks.useParams.mockReturnValue({ type: 'mcqs', subject: 'criminal-law' });
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'art-1',
          title: 'Sample MCQ 1',
          derivativeType: 'mcq_question',
          confidenceScore: 0.9,
          createdAt: '2026-04-20T10:00:00Z',
          publishedAt: null,
          audience: 'both',
          language: 'en',
          sourceDocument: null,
          subjects: [
            {
              code: 'criminal_law',
              name: 'Criminal Law',
              taxonomyVersion: 'study_8',
              isPrimary: true,
            },
          ],
          disclaimer: null,
          isGated: false,
          upgradeTier: null,
        },
      ],
      meta: { hasNext: false, limit: 20 },
    });

    render(withProviders(<LibrarySubjectPage />));

    await waitFor(() => expect(screen.getByText('Sample MCQ 1')).toBeInTheDocument());

    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Criminal Law MCQs')).toBeInTheDocument();

    expect(mockGet).toHaveBeenCalledWith(
      '/derivatives',
      expect.objectContaining({
        params: expect.objectContaining({
          subjectCode: 'criminal_law',
          derivativeType: 'mcq_question',
          taxonomyVersion: 'study_8',
        }),
      }),
    );
  });

  it('calls notFound for unknown subject slug', () => {
    navigationMocks.useParams.mockReturnValue({ type: 'mcqs', subject: 'not-a-subject' });
    expect(() => render(withProviders(<LibrarySubjectPage />))).toThrow(/NEXT_NOT_FOUND/);
  });
});

describe('Library detail page', () => {
  it('renders breadcrumb through hub > type > subject > title and dispatches via RENDERER_BY_TYPE', async () => {
    navigationMocks.useParams.mockReturnValue({
      type: 'mcqs',
      subject: 'criminal-law',
      id: 'art-1',
    });
    mockGet.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'art-1',
        title: 'Illegal search doctrine — question',
        derivativeType: 'mcq_question',
        confidenceScore: 0.9,
        createdAt: '2026-04-20T10:00:00Z',
        publishedAt: null,
        audience: 'both',
        language: 'en',
        sourceDocument: null,
        subjects: [
          {
            code: 'criminal_law',
            name: 'Criminal Law',
            taxonomyVersion: 'study_8',
            isPrimary: true,
          },
        ],
        disclaimer: null,
        isGated: false,
        upgradeTier: null,
        contentJson: {
          questionStem: 'Which doctrine applies?',
          options: [
            { label: 'A', text: 'Fruit of the poisonous tree', isCorrect: true, rationale: '' },
            { label: 'B', text: 'Other', isCorrect: false, rationale: '' },
          ],
          explanation: '',
        },
        contentPlainText: null,
        disclaimerBody: null,
        mcqQuestion: null,
        essayPrompt: null,
      },
    });

    render(withProviders(<LibraryDetailPage />));

    await waitFor(() =>
      expect(screen.getByText('Which doctrine applies?')).toBeInTheDocument(),
    );

    const links = screen
      .getAllByRole('link')
      .map((a) => ({ href: a.getAttribute('href'), text: a.textContent }));
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: '/library', text: 'Library' }),
        expect.objectContaining({ href: '/library/mcqs', text: 'MCQs' }),
        expect.objectContaining({
          href: '/library/mcqs/criminal-law',
          text: 'Criminal Law',
        }),
      ]),
    );
  });
});

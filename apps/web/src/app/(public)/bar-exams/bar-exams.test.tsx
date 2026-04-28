import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { subjectLabel, subjectLabelWithPart } from './lib';

const fetchMock = vi.fn();

beforeAll(() => {
  // Pin the API URL so the page-under-test fetches deterministically.
  process.env['API_URL'] = 'http://api.local/api/v1';
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
});

describe('bar-exams lib helpers', () => {
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
  it('renders one card per year', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
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
      }),
    });

    const { default: Page } = await import('./page');
    const ui = await Page();
    render(ui);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Past Bar Examinations',
    );
    expect(screen.getByText('2022')).toBeInTheDocument();
    expect(screen.getByText('2018')).toBeInTheDocument();
  });

  it('shows an empty state when the API returns no data', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });

    const { default: Page } = await import('./page');
    const ui = await Page();
    render(ui);

    expect(
      screen.getByText(/No bar exam papers are loaded yet/i),
    ).toBeInTheDocument();
  });
});

describe('bar-exams year page', () => {
  it('renders subject cards for a year', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
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
      }),
    });

    const { default: Page } = await import('./[year]/page');
    const ui = await Page({ params: Promise.resolve({ year: '2018' }) });
    render(ui);

    expect(
      screen.getByRole('heading', { name: /2018 Bar Examinations/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Civil Law')).toBeInTheDocument();
    expect(screen.getByText('Criminal Law')).toBeInTheDocument();
  });
});

describe('bar-exams sitting page', () => {
  it('renders the question list with numbers and subPart badges', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
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
      }),
    });

    const { default: Page } = await import('./[year]/[subjectCode]/page');
    const ui = await Page({
      params: Promise.resolve({ year: '2018', subjectCode: 'civil_law' }),
      searchParams: Promise.resolve({}),
    });
    render(ui);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Civil Law',
    );
    expect(screen.getByText('Question 1')).toBeInTheDocument();
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(screen.getByText('2 sub-parts')).toBeInTheDocument();
    expect(screen.getByText(/View original on LawPhil/i)).toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DerivativeCard } from './derivative-card';
import type { DerivativeListItem } from '../types';

const baseItem: DerivativeListItem = {
  id: 'a-1',
  title: 'People v. Dizon — Doctrine of Equipoise',
  derivativeType: 'case_digest',
  confidenceScore: 0.82,
  createdAt: '2026-04-10T10:00:00Z',
  publishedAt: null,
  audience: 'both',
  language: 'en',
  sourceDocument: {
    id: 'doc-1',
    title: 'People v. Dizon',
    shortTitle: null,
    citationText: 'G.R. No. 12345',
    court: 'SC',
    decisionDate: null,
  },
  subjects: [
    { code: 'criminal_law', name: 'Criminal Law', taxonomyVersion: 'study_8', isPrimary: true },
  ],
  disclaimer: { id: 'cd-1', contentClass: 'case_digest', version: 1 },
  isGated: false,
  upgradeTier: null,
};

describe('DerivativeCard', () => {
  it('renders title, type label, subject badge, and citation', () => {
    render(<DerivativeCard item={baseItem} />);

    expect(screen.getByText(baseItem.title)).toBeInTheDocument();
    expect(screen.getByText('Case Digest')).toBeInTheDocument();
    expect(screen.getByText('Criminal Law')).toBeInTheDocument();
    expect(screen.getByText('G.R. No. 12345')).toBeInTheDocument();
  });

  it('shows confidence badge when score >= 0.7', () => {
    render(<DerivativeCard item={{ ...baseItem, confidenceScore: 0.9 }} />);
    expect(screen.getByText(/90% confidence/i)).toBeInTheDocument();
  });

  it('hides confidence badge when score is below 0.7', () => {
    render(<DerivativeCard item={{ ...baseItem, confidenceScore: 0.5 }} />);
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it('renders upgrade badge when isGated is true', () => {
    render(
      <DerivativeCard
        item={{
          ...baseItem,
          derivativeType: 'mcq_question',
          isGated: true,
          upgradeTier: 'edu',
        }}
      />,
    );
    expect(screen.getByText(/edu/i)).toBeInTheDocument();
  });

  it('links to the type+subject scoped detail page when both are resolvable', () => {
    render(<DerivativeCard item={baseItem} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/library/digests/criminal-law/a-1');
  });

  it('falls back to the legacy /library/<id> path when type or subject is unresolvable', () => {
    render(
      <DerivativeCard
        item={{
          ...baseItem,
          derivativeType: 'unknown_type' as unknown as typeof baseItem.derivativeType,
          subjects: [],
        }}
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/library/a-1');
  });

  it('keeps the user inside the URL filter context when the item has a matching subject', () => {
    // The item's PRIMARY subject is criminal-law, but the page is the
    // civil-law MCQ list. The card must link to civil-law, not criminal-law.
    render(
      <DerivativeCard
        item={{
          ...baseItem,
          derivativeType: 'mcq_question',
          subjects: [
            { code: 'criminal_law', name: 'Criminal Law', taxonomyVersion: 'study_8', isPrimary: true },
            { code: 'civil_law', name: 'Civil Law', taxonomyVersion: 'study_8', isPrimary: false },
          ],
        }}
        pageSubjectSlug="civil-law"
        pageSubjectCode="civil_law"
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/library/mcqs/civil-law/a-1');
  });

  it('falls back to the primary subject when the URL filter has no matching assignment', () => {
    render(
      <DerivativeCard
        item={{
          ...baseItem,
          derivativeType: 'mcq_question',
          subjects: [
            { code: 'criminal_law', name: 'Criminal Law', taxonomyVersion: 'study_8', isPrimary: true },
          ],
        }}
        pageSubjectSlug="taxation-law"
        pageSubjectCode="taxation_law"
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/library/mcqs/criminal-law/a-1');
  });

  it('uses pageSubjectCode even when subjects is a single-element array (deterministic over primary)', () => {
    render(
      <DerivativeCard
        item={{
          ...baseItem,
          derivativeType: 'mcq_question',
          subjects: [
            { code: 'civil_law', name: 'Civil Law', taxonomyVersion: 'study_8', isPrimary: true },
          ],
        }}
        pageSubjectSlug="civil-law"
        pageSubjectCode="civil_law"
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/library/mcqs/civil-law/a-1');
  });
});

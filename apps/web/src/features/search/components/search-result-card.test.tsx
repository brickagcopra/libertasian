import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { SearchResultItem } from '../types';
import { SearchResultCard } from './search-result-card';

const baseItem: SearchResultItem = {
  id: 'result-1',
  score: 0.95,
  source: {
    document_id: 'doc-1',
    title: 'People v. Santos',
    document_type: 'decision',
    court: 'Supreme Court',
    gr_no: 'G.R. No. 123456',
    ponente: 'Leonen, J.',
    decision_date: '2024-06-15',
    is_official: true,
    is_published: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  highlights: {
    plain_text: [
      'The court held that <mark>hearsay evidence</mark> is inadmissible.',
    ],
  },
};

describe('SearchResultCard', () => {
  it('renders document title', () => {
    render(<SearchResultCard item={baseItem} />);
    expect(screen.getByText('People v. Santos')).toBeDefined();
  });

  it('renders document type badge', () => {
    render(<SearchResultCard item={baseItem} />);
    expect(screen.getByText('decision')).toBeDefined();
  });

  it('renders court name', () => {
    render(<SearchResultCard item={baseItem} />);
    expect(screen.getByText('Supreme Court')).toBeDefined();
  });

  it('renders G.R. number', () => {
    render(<SearchResultCard item={baseItem} />);
    expect(screen.getByText('G.R. No. 123456')).toBeDefined();
  });

  it('renders ponente', () => {
    render(<SearchResultCard item={baseItem} />);
    expect(screen.getByText('Ponente: Leonen, J.')).toBeDefined();
  });

  it('renders decision date', () => {
    render(<SearchResultCard item={baseItem} />);
    // Date format depends on locale — just check it's rendered
    expect(screen.getByText(/2024/)).toBeDefined();
  });

  it('renders Official badge for official sources', () => {
    render(<SearchResultCard item={baseItem} />);
    expect(screen.getByText('Official')).toBeDefined();
  });

  it('does not render Official badge for non-official sources', () => {
    const nonOfficialItem: SearchResultItem = {
      ...baseItem,
      source: { ...baseItem.source, is_official: false },
    };
    render(<SearchResultCard item={nonOfficialItem} />);
    expect(screen.queryByText('Official')).toBeNull();
  });

  it('renders highlight snippets', () => {
    render(<SearchResultCard item={baseItem} />);
    // dangerouslySetInnerHTML renders HTML — the text content should be present
    expect(
      screen.getByText(
        /hearsay evidence/,
      ),
    ).toBeDefined();
  });

  it('limits highlight snippets to 2', () => {
    const itemWith3Snippets: SearchResultItem = {
      ...baseItem,
      highlights: {
        plain_text: [
          'Snippet 1',
          'Snippet 2',
          'Snippet 3 should not render',
        ],
      },
    };
    render(<SearchResultCard item={itemWith3Snippets} />);

    expect(screen.getByText('Snippet 1')).toBeDefined();
    expect(screen.getByText('Snippet 2')).toBeDefined();
    expect(screen.queryByText('Snippet 3 should not render')).toBeNull();
  });

  it('renders without highlights', () => {
    const itemNoHighlights: SearchResultItem = {
      ...baseItem,
      highlights: undefined,
    };
    render(<SearchResultCard item={itemNoHighlights} />);
    expect(screen.getByText('People v. Santos')).toBeDefined();
  });

  it('renders document link to reader', () => {
    render(<SearchResultCard item={baseItem} />);
    const link = screen.getByText('People v. Santos').closest('a');
    expect(link?.getAttribute('href')).toBe('/reader/doc-1');
  });

  it('renders underscore document types as spaced text', () => {
    const item: SearchResultItem = {
      ...baseItem,
      source: { ...baseItem.source, document_type: 'bar_exam_reviewer' },
    };
    render(<SearchResultCard item={item} />);
    expect(screen.getByText('bar exam reviewer')).toBeDefined();
  });

  it('renders without optional metadata fields', () => {
    const minimalItem: SearchResultItem = {
      id: 'result-2',
      score: 0.5,
      source: {
        document_id: 'doc-2',
        title: 'Minimal Document',
        document_type: 'statute',
        is_official: false,
        is_published: true,
        created_at: '2024-01-01T00:00:00Z',
      },
    };
    render(<SearchResultCard item={minimalItem} />);

    expect(screen.getByText('Minimal Document')).toBeDefined();
    expect(screen.getByText('statute')).toBeDefined();
    expect(screen.queryByText('Ponente:')).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { toPlainText } from '../lib/format';
import type { DeepResearchResult, DeepResearchSource } from '../schemas';
import { ResearchResult } from './research-result';

const src = (n: number, extra: Partial<DeepResearchSource>): DeepResearchSource => ({
  sourceId: `S${n}`,
  documentId: `doc-${n}`,
  sectionId: `sec-${n}`,
  title: `Title ${n}`,
  citation: null,
  grNo: null,
  court: null,
  date: null,
  sectionLabel: null,
  documentType: null,
  ...extra,
});

const SOURCES = [
  src(1, { court: 'supreme_court', documentType: 'decision', grNo: 'G.R. No. 1' }),
  src(2, { documentType: 'constitution' }),
  src(3, { documentType: 'journal_article' }),
  src(4, { documentType: 'republic_act' }), // retrieved but never cited
];

const RESULT: DeepResearchResult = {
  summary: 'Short answer.',
  sections: [
    {
      heading: 'The rule',
      claims: [
        { text: 'Claim one.', citations: [{ sourceId: 'S2', quote: 'q2' }, { sourceId: 'S1', quote: 'q1' }] },
        { text: 'Claim two.', citations: [{ sourceId: 'S3', quote: 'q3' }, { sourceId: 'S9', quote: 'ghost' }] },
      ],
    },
  ],
  removedClaims: 3,
  abstained: false,
};

describe('ResearchResult', () => {
  it('renders summary, headings, numbered chips and the removed-claims footer', () => {
    render(<ResearchResult question="Q?" result={RESULT} sources={SOURCES} />);
    expect(screen.getByText('Short answer.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The rule' })).toBeInTheDocument();
    // S9 is not a known source: no chip.
    expect(screen.getAllByTestId('citation-chip').map((c) => c.textContent)).toEqual(['1', '2', '3']);
    expect(screen.getByTestId('removed-claims')).toHaveTextContent('3 unsupported statements were removed');
    expect(screen.getByTestId('content-disclaimer')).toBeInTheDocument();
  });

  it('groups only cited sources: Constitution/Statutes, then SC, then Others', () => {
    render(<ResearchResult question="Q?" result={RESULT} sources={SOURCES} />);
    const groups = screen.getAllByTestId(/^source-group-/).map((g) => g.dataset['testid']);
    expect(groups).toEqual(['source-group-law', 'source-group-sc', 'source-group-other']);
    expect(screen.queryByText('Title 4')).not.toBeInTheDocument();
  });

  it('hides the footer when nothing was removed', () => {
    render(<ResearchResult question="Q?" result={{ ...RESULT, removedClaims: 0 }} sources={SOURCES} />);
    expect(screen.queryByTestId('removed-claims')).not.toBeInTheDocument();
  });

  it('renders the abstained card instead of an answer', () => {
    render(
      <ResearchResult
        question="Q?"
        result={{ ...RESULT, abstained: true, abstainReason: 'low_relevance', sections: [] }}
        sources={[]}
      />,
    );
    expect(screen.getByTestId('dr-abstained')).toBeInTheDocument();
    expect(screen.queryByTestId('research-result')).not.toBeInTheDocument();
  });

  it('Copy writes the answer plus the citation list; follow-up calls back', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onFollowUp = vi.fn();
    render(<ResearchResult question="Q?" result={RESULT} sources={SOURCES} onFollowUp={onFollowUp} />);
    fireEvent.click(screen.getByText('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text).toContain('- Claim one. [1][2]');
    expect(text).toContain('Sources');
    expect(text).toContain('[1] Title 1, G.R. No. 1, Supreme Court');
    fireEvent.click(screen.getByText('Ask a follow-up'));
    expect(onFollowUp).toHaveBeenCalled();
  });
});

describe('toPlainText', () => {
  it('lists only cited sources', () => {
    expect(toPlainText(null, RESULT, SOURCES)).not.toContain('Title 4');
  });
});

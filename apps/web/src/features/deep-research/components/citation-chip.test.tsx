import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { CitationChip } from './citation-chip';

const SOURCE = {
  sourceId: 'S2',
  documentId: 'doc-9',
  sectionId: 'sec-4',
  title: 'People v. Santos',
  citation: 'G.R. No. 234567',
  grNo: 'G.R. No. 234567',
  court: 'supreme_court',
  date: '2019-06-03',
  sectionLabel: 'Ruling',
  documentType: 'decision',
};

describe('CitationChip', () => {
  it('renders the number and opens a popover on tap with quote, title, citation, court and date', () => {
    render(<CitationChip number={2} source={SOURCE} quote="the arrest was unlawful" />);
    const chip = screen.getByTestId('citation-chip');
    expect(chip).toHaveTextContent('2');
    expect(screen.queryByTestId('citation-popover')).not.toBeInTheDocument();

    fireEvent.click(chip);

    const pop = screen.getByTestId('citation-popover');
    expect(pop).toHaveTextContent('“the arrest was unlawful”');
    expect(pop).toHaveTextContent('People v. Santos');
    expect(pop).toHaveTextContent('G.R. No. 234567');
    expect(pop).toHaveTextContent('Supreme Court');
    expect(pop).toHaveTextContent('2019');
  });

  it('links "Open in reader" to the section with the quote as ?highlight=', () => {
    render(<CitationChip number={1} source={SOURCE} quote="the arrest was unlawful" />);
    fireEvent.click(screen.getByTestId('citation-chip'));
    const link = screen.getByText('Open in reader').closest('a');
    const href = link?.getAttribute('href') ?? '';
    expect(href.startsWith('/reader/doc-9?')).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('section')).toBe('sec-4');
    expect(params.get('highlight')).toBe('the arrest was unlawful');
  });

  it('opens on mouse hover', () => {
    render(<CitationChip number={1} source={SOURCE} quote="q quote" />);
    fireEvent.pointerEnter(screen.getByTestId('citation-chip'), { pointerType: 'mouse' });
    expect(screen.getByTestId('citation-popover')).toBeInTheDocument();
  });

  it('degrades when the source is unknown', () => {
    render(<CitationChip number={3} source={undefined} quote="x y z" />);
    fireEvent.click(screen.getByTestId('citation-chip'));
    expect(screen.getByText('Source details are unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Open in reader')).not.toBeInTheDocument();
  });
});

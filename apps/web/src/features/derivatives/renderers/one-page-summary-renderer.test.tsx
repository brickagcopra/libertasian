import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OnePageSummaryRenderer } from './one-page-summary-renderer';
import { ONE_PAGE_SUMMARY_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('OnePageSummaryRenderer', () => {
  it('renders topic, bottom line, key points, highlights, and quick reference', () => {
    render(
      <OnePageSummaryRenderer
        data={makeDetail('one_page_summary', ONE_PAGE_SUMMARY_CONTENT)}
      />,
    );
    expect(screen.getByText(/Warrantless Arrests under Rule 113/i)).toBeInTheDocument();
    expect(screen.getByText('Bottom Line')).toBeInTheDocument();
    expect(
      screen.getByText(/three narrow exceptions enumerated in Rule 113/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Key Points')).toBeInTheDocument();
    expect(screen.getByText('Escapee from lawful custody')).toBeInTheDocument();
    expect(screen.getAllByText('In flagrante delicto')).toHaveLength(2);
    expect(screen.getByText('Highlights')).toBeInTheDocument();
    expect(screen.getByText('Quick Reference')).toBeInTheDocument();
    expect(screen.getByText('Rule 113, Sec. 5')).toBeInTheDocument();
  });

  it('gates key points, highlights, and quick reference but keeps the bottom line', () => {
    render(
      <OnePageSummaryRenderer
        data={makeDetail('one_page_summary', ONE_PAGE_SUMMARY_CONTENT, {
          isGated: true,
          upgradeTier: 'pro',
        })}
      />,
    );
    expect(screen.getByText('Bottom Line')).toBeInTheDocument();
    expect(screen.queryByText('Key Points')).not.toBeInTheDocument();
    expect(screen.queryByText('Highlights')).not.toBeInTheDocument();
    expect(screen.queryByText('Quick Reference')).not.toBeInTheDocument();
    expect(screen.getByText(/Unlock full content/i)).toBeInTheDocument();
  });

  it('falls back to Unavailable when contentJson is malformed', () => {
    render(<OnePageSummaryRenderer data={makeDetail('one_page_summary', 'bad')} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });

  it('falls back to Unavailable when bottomLine is missing', () => {
    render(
      <OnePageSummaryRenderer
        data={makeDetail('one_page_summary', { keyPoints: ['stranded'] })}
      />,
    );
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});

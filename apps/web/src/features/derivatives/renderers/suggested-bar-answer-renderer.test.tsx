import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SuggestedBarAnswerRenderer } from './suggested-bar-answer-renderer';
import { SUGGESTED_BAR_ANSWER_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('SuggestedBarAnswerRenderer', () => {
  it('renders exam metadata, question, answer, annotations, and source', () => {
    render(
      <SuggestedBarAnswerRenderer
        data={makeDetail('suggested_bar_answer', SUGGESTED_BAR_ANSWER_CONTENT)}
      />,
    );
    expect(screen.getByText(/Bar 2019/)).toBeInTheDocument();
    expect(screen.getByText('Political Law')).toBeInTheDocument();
    expect(screen.getByText('Question')).toBeInTheDocument();
    expect(
      screen.getByText(/When may a warrantless arrest be validly made\?/),
    ).toBeInTheDocument();
    expect(screen.getByText('Suggested Answer')).toBeInTheDocument();
    expect(screen.getByText('Annotations')).toBeInTheDocument();
    expect(screen.getByText(/Rule 113, Section 5 of the Rules of Court/)).toBeInTheDocument();
    expect(screen.getByText(/UP Law Center Bar Q&A compilation/)).toBeInTheDocument();
  });

  it('hides answer and annotations when gated but keeps the question', () => {
    render(
      <SuggestedBarAnswerRenderer
        data={makeDetail('suggested_bar_answer', SUGGESTED_BAR_ANSWER_CONTENT, {
          isGated: true,
          upgradeTier: 'edu',
        })}
      />,
    );
    expect(screen.getByText('Question')).toBeInTheDocument();
    expect(screen.queryByText('Suggested Answer')).not.toBeInTheDocument();
    expect(screen.queryByText('Annotations')).not.toBeInTheDocument();
    expect(screen.getByText(/Unlock full content/i)).toBeInTheDocument();
  });

  it('falls back to Unavailable when contentJson is not an object', () => {
    render(<SuggestedBarAnswerRenderer data={makeDetail('suggested_bar_answer', 'oops')} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });

  it('falls back to Unavailable when questionText is missing', () => {
    render(
      <SuggestedBarAnswerRenderer
        data={makeDetail('suggested_bar_answer', { suggestedAnswer: 'orphan answer' })}
      />,
    );
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});

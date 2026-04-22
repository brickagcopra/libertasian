import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MCQRenderer } from './mcq-renderer';
import { MCQ_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('MCQRenderer', () => {
  it('renders question stem and all options', () => {
    render(<MCQRenderer data={makeDetail('mcq_question', MCQ_CONTENT)} />);
    expect(screen.getByText(MCQ_CONTENT.questionStem)).toBeInTheDocument();
    for (const opt of MCQ_CONTENT.options) {
      expect(screen.getByText(opt.text)).toBeInTheDocument();
    }
  });

  it('hides correct badge and rationales until reveal-answer is toggled', async () => {
    const user = userEvent.setup();
    render(<MCQRenderer data={makeDetail('mcq_question', MCQ_CONTENT)} />);

    expect(screen.queryByText(/Correct$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Explanation/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reveal answer/i }));

    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(screen.getByText(/Explanation/i)).toBeInTheDocument();
    expect(screen.getByText(MCQ_CONTENT.explanation)).toBeInTheDocument();
  });

  it('renders gated notice and hides reveal toggle when isGated=true', () => {
    render(
      <MCQRenderer
        data={makeDetail('mcq_question', MCQ_CONTENT, { isGated: true, upgradeTier: 'edu' })}
      />,
    );
    expect(screen.getByText(/Unlock full content/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reveal answer/i })).not.toBeInTheDocument();
  });

  it('renders unavailable notice when content is malformed (missing options)', () => {
    render(
      <MCQRenderer
        data={makeDetail('mcq_question', { questionStem: 'Only a stem, no options' })}
      />,
    );
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EssayModelAnswerRenderer } from './essay-model-answer-renderer';
import { ESSAY_MODEL_ANSWER_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('EssayModelAnswerRenderer', () => {
  it('renders prompt reference, ALAC answer, writing tips, and pitfalls', () => {
    render(
      <EssayModelAnswerRenderer
        data={makeDetail('essay_model_answer', ESSAY_MODEL_ANSWER_CONTENT)}
      />,
    );
    expect(screen.getByText('Prompt Reference')).toBeInTheDocument();
    expect(screen.getByText(/Model Answer \(ALAC Format\)/)).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('Law')).toBeInTheDocument();
    expect(screen.getByText('Analysis')).toBeInTheDocument();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();
    expect(screen.getByText('Writing Tips')).toBeInTheDocument();
    expect(screen.getByText('Common Pitfalls')).toBeInTheDocument();
    expect(screen.getByText('Lead with the answer.')).toBeInTheDocument();
  });

  it('hides answer, tips, and pitfalls when gated but keeps prompt reference', () => {
    render(
      <EssayModelAnswerRenderer
        data={makeDetail('essay_model_answer', ESSAY_MODEL_ANSWER_CONTENT, {
          isGated: true,
          upgradeTier: 'pro',
        })}
      />,
    );
    expect(screen.getByText('Prompt Reference')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Model Answer/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Writing Tips')).not.toBeInTheDocument();
    expect(screen.queryByText('Common Pitfalls')).not.toBeInTheDocument();
    expect(screen.getByText(/Unlock full content/i)).toBeInTheDocument();
  });

  it('falls back to Unavailable when contentJson is malformed', () => {
    render(<EssayModelAnswerRenderer data={makeDetail('essay_model_answer', null)} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });

  it('falls back to Unavailable when both promptRef and answer are missing', () => {
    render(
      <EssayModelAnswerRenderer
        data={makeDetail('essay_model_answer', { writingTips: ['orphan'] })}
      />,
    );
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});

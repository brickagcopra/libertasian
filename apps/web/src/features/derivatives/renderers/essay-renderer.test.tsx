import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EssayRenderer } from './essay-renderer';
import { ESSAY_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('EssayRenderer', () => {
  it('renders prompt, model answer sections, and rubric', () => {
    render(<EssayRenderer data={makeDetail('essay_prompt', ESSAY_CONTENT)} />);
    expect(screen.getByText(ESSAY_CONTENT.promptText)).toBeInTheDocument();
    expect(screen.getByText('Model Answer')).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('Law')).toBeInTheDocument();
    expect(screen.getByText(/Rubric/)).toBeInTheDocument();
    expect(screen.getByText('Issue Identification')).toBeInTheDocument();
  });

  it('hides model answer and rubric when gated', () => {
    render(
      <EssayRenderer
        data={makeDetail('essay_prompt', ESSAY_CONTENT, { isGated: true, upgradeTier: 'edu' })}
      />,
    );
    expect(screen.getByText(ESSAY_CONTENT.promptText)).toBeInTheDocument();
    expect(screen.queryByText('Model Answer')).not.toBeInTheDocument();
    expect(screen.queryByText(/Rubric/)).not.toBeInTheDocument();
    expect(screen.getByText(/Unlock full content/i)).toBeInTheDocument();
  });

  it('falls back gracefully when content is missing promptText', () => {
    render(<EssayRenderer data={makeDetail('essay_prompt', { modelAnswer: {} })} />);
    expect(screen.getByText(/Content unavailable/i)).toBeInTheDocument();
  });
});

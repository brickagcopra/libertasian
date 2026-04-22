import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { EssayModelAnswerRenderer } from './essay-model-answer-renderer';
import { ESSAY_MODEL_ANSWER_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('EssayModelAnswerRenderer', () => {
  it('renders prompt reference, ALAC answer, writing tips, and pitfalls', () => {
    const { queryByText } = render(
      <EssayModelAnswerRenderer
        data={makeDetail('essay_model_answer', ESSAY_MODEL_ANSWER_CONTENT)}
      />,
    );
    expect(queryByText('Prompt Reference')).toBeTruthy();
    expect(queryByText(/Model Answer \(ALAC Format\)/)).toBeTruthy();
    expect(queryByText('Answer')).toBeTruthy();
    expect(queryByText('Law')).toBeTruthy();
    expect(queryByText('Analysis')).toBeTruthy();
    expect(queryByText('Conclusion')).toBeTruthy();
    expect(queryByText('Writing Tips')).toBeTruthy();
    expect(queryByText('Common Pitfalls')).toBeTruthy();
    expect(queryByText('Lead with the answer.')).toBeTruthy();
  });

  it('hides answer, tips, and pitfalls when gated but keeps prompt reference', () => {
    const { queryByText } = render(
      <EssayModelAnswerRenderer
        data={makeDetail('essay_model_answer', ESSAY_MODEL_ANSWER_CONTENT, {
          isGated: true,
          upgradeTier: 'pro',
        })}
      />,
    );
    expect(queryByText('Prompt Reference')).toBeTruthy();
    expect(queryByText(/Model Answer \(ALAC Format\)/)).toBeNull();
    expect(queryByText('Writing Tips')).toBeNull();
    expect(queryByText('Common Pitfalls')).toBeNull();
    expect(queryByText(/Unlock full content/i)).toBeTruthy();
  });

  it('falls back to Unavailable when contentJson is malformed', () => {
    const { queryByText } = render(
      <EssayModelAnswerRenderer data={makeDetail('essay_model_answer', null)} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });

  it('falls back to Unavailable when both promptRef and answer are missing', () => {
    const { queryByText } = render(
      <EssayModelAnswerRenderer
        data={makeDetail('essay_model_answer', { writingTips: ['orphan'] })}
      />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});

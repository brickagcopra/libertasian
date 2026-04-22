import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { SuggestedBarAnswerRenderer } from './suggested-bar-answer-renderer';
import { SUGGESTED_BAR_ANSWER_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('SuggestedBarAnswerRenderer', () => {
  it('renders exam metadata, question, answer, annotations, and source', () => {
    const { queryByText } = render(
      <SuggestedBarAnswerRenderer
        data={makeDetail('suggested_bar_answer', SUGGESTED_BAR_ANSWER_CONTENT)}
      />,
    );
    expect(queryByText('Bar 2019')).toBeTruthy();
    expect(queryByText('Political Law')).toBeTruthy();
    expect(queryByText('Question')).toBeTruthy();
    expect(
      queryByText(/When may a warrantless arrest be validly made\?/),
    ).toBeTruthy();
    expect(queryByText('Suggested Answer')).toBeTruthy();
    expect(queryByText('Annotations')).toBeTruthy();
    expect(queryByText(/Rule 113, Section 5 of the Rules of Court/)).toBeTruthy();
    expect(queryByText(/UP Law Center Bar Q&A compilation/)).toBeTruthy();
  });

  it('hides answer and annotations when gated but keeps the question', () => {
    const { queryByText } = render(
      <SuggestedBarAnswerRenderer
        data={makeDetail('suggested_bar_answer', SUGGESTED_BAR_ANSWER_CONTENT, {
          isGated: true,
          upgradeTier: 'edu',
        })}
      />,
    );
    expect(queryByText('Question')).toBeTruthy();
    expect(queryByText('Suggested Answer')).toBeNull();
    expect(queryByText('Annotations')).toBeNull();
    expect(queryByText(/Unlock full content/i)).toBeTruthy();
  });

  it('falls back to Unavailable when contentJson is not an object', () => {
    const { queryByText } = render(
      <SuggestedBarAnswerRenderer data={makeDetail('suggested_bar_answer', 'oops')} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });

  it('falls back to Unavailable when questionText is missing', () => {
    const { queryByText } = render(
      <SuggestedBarAnswerRenderer
        data={makeDetail('suggested_bar_answer', { suggestedAnswer: 'orphan answer' })}
      />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});

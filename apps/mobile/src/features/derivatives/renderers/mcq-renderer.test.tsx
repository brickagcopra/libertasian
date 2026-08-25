import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { MCQRenderer } from './mcq-renderer';
import { MCQ_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('MCQRenderer', () => {
  it('renders question stem and all options', () => {
    const { queryByText , queryAllByText } = render(
      <MCQRenderer data={makeDetail('mcq_question', MCQ_CONTENT)} />,
    );
    expect(queryByText(MCQ_CONTENT.questionStem)).toBeTruthy();
    for (const opt of MCQ_CONTENT.options) {
      expect(queryByText(opt.text)).toBeTruthy();
    }
  });

  it('hides correct badge and explanation until reveal is tapped', () => {
    const { queryByText, getByLabelText , queryAllByText } = render(
      <MCQRenderer data={makeDetail('mcq_question', MCQ_CONTENT)} />,
    );
    expect(queryByText('Correct')).toBeNull();
    expect(queryByText('Explanation')).toBeNull();

    fireEvent.press(getByLabelText('Reveal answer'));

    expect(queryByText('Correct')).toBeTruthy();
    expect(queryByText('Explanation')).toBeTruthy();
    expect(queryByText(MCQ_CONTENT.explanation)).toBeTruthy();
  });

  it('renders gated notice and hides reveal toggle when isGated=true', () => {
    const { queryByText, queryByLabelText , queryAllByText } = render(
      <MCQRenderer
        data={makeDetail('mcq_question', MCQ_CONTENT, {
          isGated: true,
          upgradeTier: 'edu',
        })}
      />,
    );
    // The notice heads AND bodies with this phrase, hence getAllByText.
        expect(queryAllByText(/Not available/i).length).toBeGreaterThan(0);
        // Neutral notice only: no plan named, no price, no purchase action
        // (Apple 3.1.1 / Play Payments).
        expect(queryByText(/Upgrade/i)).toBeNull();
        expect(queryByText(/Unlock full content/i)).toBeNull();
    expect(queryByLabelText('Reveal answer')).toBeNull();
  });

  it('renders unavailable when content is malformed (missing options)', () => {
    const { queryByText , queryAllByText } = render(
      <MCQRenderer
        data={makeDetail('mcq_question', { questionStem: 'Stem only' })}
      />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});

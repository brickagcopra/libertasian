import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { EssayRenderer } from './essay-renderer';
import { ESSAY_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('EssayRenderer', () => {
  it('renders prompt, suggested time, and model answer sections', () => {
    const { queryByText } = render(
      <EssayRenderer data={makeDetail('essay_prompt', ESSAY_CONTENT)} />,
    );
    expect(queryByText('Prompt')).toBeTruthy();
    expect(queryByText(ESSAY_CONTENT.promptText)).toBeTruthy();
    expect(queryByText(/Suggested time: 45 minutes/)).toBeTruthy();
    expect(queryByText('Model Answer')).toBeTruthy();
    expect(queryByText('Answer')).toBeTruthy();
    expect(queryByText('Law')).toBeTruthy();
    expect(queryByText('Rubric (100 pts)')).toBeTruthy();
    expect(queryByText('Issue Identification')).toBeTruthy();
  });

  it('renders gated notice and hides model answer when isGated=true', () => {
    const { queryByText } = render(
      <EssayRenderer
        data={makeDetail('essay_prompt', ESSAY_CONTENT, {
          isGated: true,
          upgradeTier: 'pro',
        })}
      />,
    );
    expect(queryByText(/Unlock full content/i)).toBeTruthy();
    expect(queryByText('Model Answer')).toBeNull();
    expect(queryByText('Rubric (100 pts)')).toBeNull();
  });

  it('renders unavailable when prompt text is missing', () => {
    const { queryByText } = render(
      <EssayRenderer data={makeDetail('essay_prompt', { promptText: '' })} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});

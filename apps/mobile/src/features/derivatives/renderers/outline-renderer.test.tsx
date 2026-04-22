import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { OutlineRenderer } from './outline-renderer';
import { OUTLINE_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('OutlineRenderer', () => {
  it('renders topic, sections, and subSections', () => {
    const { queryByText } = render(
      <OutlineRenderer data={makeDetail('subject_outline', OUTLINE_CONTENT)} />,
    );
    expect(queryByText(OUTLINE_CONTENT.topic)).toBeTruthy();
    expect(queryByText('Search and Seizure')).toBeTruthy();
    expect(queryByText('Warrantless Exceptions')).toBeTruthy();
    expect(queryByText('Right to Counsel')).toBeTruthy();
  });

  it('renders unavailable when sections array is empty', () => {
    const { queryByText } = render(
      <OutlineRenderer data={makeDetail('subject_outline', { sections: [] })} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});

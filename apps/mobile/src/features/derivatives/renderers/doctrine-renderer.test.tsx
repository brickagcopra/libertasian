import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { DoctrineRenderer } from './doctrine-renderer';
import { DOCTRINE_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('DoctrineRenderer', () => {
  it('renders each doctrine entry with type and confidence chips', () => {
    const { queryByText } = render(
      <DoctrineRenderer data={makeDetail('doctrine_extract', DOCTRINE_CONTENT)} />,
    );
    expect(queryByText(DOCTRINE_CONTENT.doctrines[0].text)).toBeTruthy();
    expect(queryByText(DOCTRINE_CONTENT.doctrines[1].text)).toBeTruthy();
    expect(queryByText('92% confidence')).toBeTruthy();
    expect(queryByText('88% confidence')).toBeTruthy();
  });

  it('renders unavailable when no doctrines present', () => {
    const { queryByText } = render(
      <DoctrineRenderer data={makeDetail('doctrine_extract', { doctrines: [] })} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });

  it('renders unavailable when contentJson is not a doctrine object', () => {
    const { queryByText } = render(
      <DoctrineRenderer data={makeDetail('doctrine_extract', null)} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});

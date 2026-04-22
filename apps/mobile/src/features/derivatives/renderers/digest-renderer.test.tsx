import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { DigestRenderer } from './digest-renderer';
import { DIGEST_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('DigestRenderer', () => {
  it('renders every canonical digest section when provided', () => {
    const { queryByText } = render(
      <DigestRenderer data={makeDetail('case_digest', DIGEST_CONTENT)} />,
    );
    for (const title of [
      'Summary',
      'Facts',
      "Petitioner's Arguments",
      "Respondent's Arguments",
      'Issues',
      'Ruling',
      'Doctrine',
      'Dispositive',
    ]) {
      expect(queryByText(title)).toBeTruthy();
    }
  });

  it('handles string issues as a single-item list', () => {
    const { queryByText } = render(
      <DigestRenderer
        data={makeDetail('case_digest', { ...DIGEST_CONTENT, issues: 'Single issue' })}
      />,
    );
    expect(queryByText('Single issue')).toBeTruthy();
  });

  it('renders unavailable when every section is empty', () => {
    const { queryByText } = render(
      <DigestRenderer data={makeDetail('case_digest', {})} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});

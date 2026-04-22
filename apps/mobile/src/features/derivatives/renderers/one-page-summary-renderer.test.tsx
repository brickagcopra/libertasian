import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { OnePageSummaryRenderer } from './one-page-summary-renderer';
import { ONE_PAGE_SUMMARY_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('OnePageSummaryRenderer', () => {
  it('renders topic, bottom line, key points, highlights, and quick reference', () => {
    const { queryByText, queryAllByText } = render(
      <OnePageSummaryRenderer
        data={makeDetail('one_page_summary', ONE_PAGE_SUMMARY_CONTENT)}
      />,
    );
    expect(queryByText(/Warrantless Arrests under Rule 113/i)).toBeTruthy();
    expect(queryByText('Bottom Line')).toBeTruthy();
    expect(queryByText(/three narrow exceptions enumerated in Rule 113/i)).toBeTruthy();
    expect(queryByText('Key Points')).toBeTruthy();
    expect(queryByText('Escapee from lawful custody')).toBeTruthy();
    expect(queryAllByText('In flagrante delicto').length).toBeGreaterThanOrEqual(2);
    expect(queryByText('Highlights')).toBeTruthy();
    expect(queryByText('Quick Reference')).toBeTruthy();
    expect(queryByText('Rule 113, Sec. 5')).toBeTruthy();
  });

  it('gates key points, highlights, and quick reference but keeps the bottom line', () => {
    const { queryByText } = render(
      <OnePageSummaryRenderer
        data={makeDetail('one_page_summary', ONE_PAGE_SUMMARY_CONTENT, {
          isGated: true,
          upgradeTier: 'pro',
        })}
      />,
    );
    expect(queryByText('Bottom Line')).toBeTruthy();
    expect(queryByText('Key Points')).toBeNull();
    expect(queryByText('Highlights')).toBeNull();
    expect(queryByText('Quick Reference')).toBeNull();
    expect(queryByText(/Unlock full content/i)).toBeTruthy();
  });

  it('falls back to Unavailable when contentJson is malformed', () => {
    const { queryByText } = render(
      <OnePageSummaryRenderer data={makeDetail('one_page_summary', 'bad')} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });

  it('falls back to Unavailable when bottomLine is missing', () => {
    const { queryByText } = render(
      <OnePageSummaryRenderer
        data={makeDetail('one_page_summary', { keyPoints: ['stranded'] })}
      />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});

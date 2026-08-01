import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { SamplePleadingRenderer } from './sample-pleading-renderer';
import { SAMPLE_PLEADING_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('SamplePleadingRenderer', () => {
  it('renders caption, parties, sections, prayer, and verification toggle', () => {
    const { queryByText , queryAllByText } = render(
      <SamplePleadingRenderer
        data={makeDetail('sample_pleading', SAMPLE_PLEADING_CONTENT)}
      />,
    );
    expect(queryByText(/Petition for Review on Certiorari/i)).toBeTruthy();
    expect(queryByText('SUPREME COURT OF THE PHILIPPINES')).toBeTruthy();
    expect(queryByText('Juan Dela Cruz vs. People of the Philippines')).toBeTruthy();
    expect(queryByText('G.R. No. 123456')).toBeTruthy();
    expect(queryByText('Parties')).toBeTruthy();
    expect(queryByText('Statement of Facts')).toBeTruthy();
    expect(queryByText('Prayer')).toBeTruthy();
    expect(queryByText(/Verification & Proof of Service/)).toBeTruthy();
  });

  it('gates everything after the caption', () => {
    const { queryByText , queryAllByText } = render(
      <SamplePleadingRenderer
        data={makeDetail('sample_pleading', SAMPLE_PLEADING_CONTENT, {
          isGated: true,
          upgradeTier: 'pro',
        })}
      />,
    );
    expect(queryByText('SUPREME COURT OF THE PHILIPPINES')).toBeTruthy();
    expect(queryByText('Parties')).toBeNull();
    expect(queryByText('Prayer')).toBeNull();
    // The notice heads AND bodies with this phrase, hence getAllByText.
        expect(queryAllByText(/Not included in your plan/i).length).toBeGreaterThan(0);
        // Neutral notice only: no plan named, no price, no purchase action
        // (Apple 3.1.1 / Play Payments).
        expect(queryByText(/Upgrade/i)).toBeNull();
        expect(queryByText(/Unlock full content/i)).toBeNull();
  });

  it('falls back to Unavailable when contentJson is malformed', () => {
    const { queryByText , queryAllByText } = render(
      <SamplePleadingRenderer data={makeDetail('sample_pleading', 42)} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });

  it('falls back to Unavailable when pleadingType and caption are missing', () => {
    const { queryByText , queryAllByText } = render(
      <SamplePleadingRenderer
        data={makeDetail('sample_pleading', { prayer: 'WHEREFORE...' })}
      />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});

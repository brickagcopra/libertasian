import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import { SampleContractRenderer } from './sample-contract-renderer';
import { SAMPLE_CONTRACT_CONTENT, makeDetail } from './__fixtures__/fixtures';

describe('SampleContractRenderer', () => {
  it('renders title, parties, recitals, clauses, and schedules', () => {
    const { queryByText, queryAllByText } = render(
      <SampleContractRenderer
        data={makeDetail('sample_contract', SAMPLE_CONTRACT_CONTENT)}
      />,
    );
    expect(queryByText('Lease Agreement')).toBeTruthy();
    expect(queryByText('Parties')).toBeTruthy();
    expect(queryByText('123 Makati Ave., Makati City')).toBeTruthy();
    expect(queryAllByText('ABC Realty Corp.').length).toBeGreaterThanOrEqual(2);
    expect(queryByText('Recitals')).toBeTruthy();
    expect(queryByText(/Lessor owns the property/)).toBeTruthy();
    expect(queryByText('Term')).toBeTruthy();
    expect(queryByText(/Schedule A - Property/)).toBeTruthy();
  });

  it('gates recitals, clauses, schedules, and signatures', () => {
    const { queryByText , queryAllByText } = render(
      <SampleContractRenderer
        data={makeDetail('sample_contract', SAMPLE_CONTRACT_CONTENT, {
          isGated: true,
          upgradeTier: 'edu',
        })}
      />,
    );
    expect(queryByText('Lease Agreement')).toBeTruthy();
    expect(queryByText('Parties')).toBeTruthy();
    expect(queryByText('Recitals')).toBeNull();
    expect(queryByText('Term')).toBeNull();
    // The notice heads AND bodies with this phrase, hence getAllByText.
        expect(queryAllByText(/Not available/i).length).toBeGreaterThan(0);
        // Neutral notice only: no plan named, no price, no purchase action
        // (Apple 3.1.1 / Play Payments).
        expect(queryByText(/Upgrade/i)).toBeNull();
        expect(queryByText(/Unlock full content/i)).toBeNull();
  });

  it('falls back to Unavailable when contentJson is missing', () => {
    const { queryByText , queryAllByText } = render(
      <SampleContractRenderer data={makeDetail('sample_contract', undefined)} />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });

  it('falls back to Unavailable when contractType is missing', () => {
    const { queryByText , queryAllByText } = render(
      <SampleContractRenderer
        data={makeDetail('sample_contract', { clauses: [{ heading: 'Orphan' }] })}
      />,
    );
    expect(queryByText(/Content unavailable/i)).toBeTruthy();
  });
});

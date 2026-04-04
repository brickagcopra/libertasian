import React from 'react';
import { render } from '@testing-library/react-native';

import { ExpertBadge } from './expert-badge';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

describe('ExpertBadge', () => {
  it('renders badge for approved lawyer', () => {
    const { getByText } = render(
      <ExpertBadge expertiseType="lawyer" status="approved" />,
    );

    expect(getByText('Lawyer')).toBeTruthy();
  });

  it('renders badge for approved law professor', () => {
    const { getByText } = render(
      <ExpertBadge expertiseType="law_professor" status="approved" />,
    );

    expect(getByText('Law Professor')).toBeTruthy();
  });

  it('renders badge for approved retired judge', () => {
    const { getByText } = render(
      <ExpertBadge expertiseType="judge_retired" status="approved" />,
    );

    expect(getByText('Retired Judge')).toBeTruthy();
  });

  it('renders badge for approved legal researcher', () => {
    const { getByText } = render(
      <ExpertBadge expertiseType="legal_researcher" status="approved" />,
    );

    expect(getByText('Legal Researcher')).toBeTruthy();
  });

  it('returns null for pending status', () => {
    const { toJSON } = render(
      <ExpertBadge expertiseType="lawyer" status="pending" />,
    );

    expect(toJSON()).toBeNull();
  });

  it('returns null for rejected status', () => {
    const { toJSON } = render(
      <ExpertBadge expertiseType="lawyer" status="rejected" />,
    );

    expect(toJSON()).toBeNull();
  });

  it('returns null for revoked status', () => {
    const { toJSON } = render(
      <ExpertBadge expertiseType="lawyer" status="revoked" />,
    );

    expect(toJSON()).toBeNull();
  });

  it('renders shield icon for approved expert', () => {
    const { getByTestId } = render(
      <ExpertBadge expertiseType="lawyer" status="approved" />,
    );

    expect(getByTestId('icon-shield-checkmark')).toBeTruthy();
  });

  it('renders with md size', () => {
    const { getByText } = render(
      <ExpertBadge expertiseType="lawyer" status="approved" size="md" />,
    );

    expect(getByText('Lawyer')).toBeTruthy();
  });
});

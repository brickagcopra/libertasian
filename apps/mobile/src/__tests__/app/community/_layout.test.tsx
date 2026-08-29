import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  Stack: Object.assign(
    ({ screenOptions }: { screenOptions: Record<string, unknown> }) => (
      <>{JSON.stringify(screenOptions)}</>
    ),
    {},
  ),
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require('react-native');
    return <Text testID="redirect">{href}</Text>;
  },
}));

import CommunityLayout from '@/app/community/_layout';
import { setEntitled, setFreeTier } from '@/features/entitlements/test-helpers';

describe('CommunityLayout', () => {
  // The layout is guarded now, so a test that renders it has to say which
  // account it is standing in. Without this the default is the free tier and
  // every assertion below would be inspecting a redirect.
  beforeEach(() => {
    setEntitled();
  });

  it('renders without crashing', () => {
    const { toJSON } = render(<CommunityLayout />);
    expect(toJSON()).toBeTruthy();
  });

  it('configures Stack with the brand cream header', () => {
    const { toJSON } = render(<CommunityLayout />);
    const output = JSON.stringify(toJSON());
    expect(output).toContain('#F6F1E8');
  });

  it('sets ink tint color for back button', () => {
    const { toJSON } = render(<CommunityLayout />);
    const output = JSON.stringify(toJSON());
    expect(output).toContain('#1C1A14');
  });

  it('redirects a free account home instead of rendering the subtree', () => {
    // Community shares study artifacts and links straight into /study. Its
    // only entry point is already hidden; this closes the deep link.
    setFreeTier();

    const { getByTestId } = render(<CommunityLayout />);
    expect(getByTestId('redirect').props.children).toBe('/(tabs)');
  });
});

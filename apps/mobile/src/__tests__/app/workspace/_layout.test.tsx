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

import WorkspaceLayout from '@/app/workspace/_layout';
import { setEntitled, setFreeTier } from '@/features/entitlements/test-helpers';

describe('WorkspaceLayout', () => {
  // The layout is guarded now, so a test that renders it has to say which
  // account it is standing in. Without this the default is the free tier and
  // every assertion below would be inspecting a redirect.
  beforeEach(() => {
    setEntitled();
  });

  it('renders without crashing', () => {
    const { toJSON } = render(<WorkspaceLayout />);
    expect(toJSON()).toBeTruthy();
  });

  it('configures Stack with the brand cream header', () => {
    const { toJSON } = render(<WorkspaceLayout />);
    const output = JSON.stringify(toJSON());
    expect(output).toContain('#F6F1E8');
    expect(output).toContain('#1C1A14');
  });

  it('configures header title style', () => {
    const { toJSON } = render(<WorkspaceLayout />);
    const output = JSON.stringify(toJSON());
    expect(output).toContain('Inter_600SemiBold');
    expect(output).toContain('17');
  });

  it('uses a minimal chevron-only back button', () => {
    const { toJSON } = render(<WorkspaceLayout />);
    const output = JSON.stringify(toJSON());
    expect(output).toContain('minimal');
  });

  it('redirects a free account home instead of rendering the subtree', () => {
    // Every workspace quota is 0 on the free tier, so each route below would
    // load and then refuse. A deep link or a push notification lands here
    // without passing the tab that is already hidden.
    setFreeTier();

    const { getByTestId } = render(<WorkspaceLayout />);
    expect(getByTestId('redirect').props.children).toBe('/(tabs)');
  });
});

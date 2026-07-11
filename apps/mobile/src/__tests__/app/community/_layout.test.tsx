import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  Stack: Object.assign(
    ({ screenOptions }: { screenOptions: Record<string, unknown> }) => (
      <>{JSON.stringify(screenOptions)}</>
    ),
    {},
  ),
}));

import CommunityLayout from '@/app/community/_layout';

describe('CommunityLayout', () => {
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
});

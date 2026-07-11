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

import WorkspaceLayout from '@/app/workspace/_layout';

describe('WorkspaceLayout', () => {
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
});

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

  it('configures Stack with white background', () => {
    const { toJSON } = render(<WorkspaceLayout />);
    const output = JSON.stringify(toJSON());
    expect(output).toContain('#fff');
  });

  it('configures header title style', () => {
    const { toJSON } = render(<WorkspaceLayout />);
    const output = JSON.stringify(toJSON());
    expect(output).toContain('600');
    expect(output).toContain('#111827');
  });

  it('sets headerBackTitle to Back', () => {
    const { toJSON } = render(<WorkspaceLayout />);
    const output = JSON.stringify(toJSON());
    expect(output).toContain('Back');
  });
});

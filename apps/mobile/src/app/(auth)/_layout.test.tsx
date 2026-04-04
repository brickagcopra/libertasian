import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  Stack: Object.assign(
    ({ screenOptions }: { screenOptions?: Record<string, unknown> }) => {
      const { Text } = require('react-native');
      return (
        <Text testID="stack">
          {JSON.stringify(screenOptions)}
        </Text>
      );
    },
    { Screen: () => null },
  ),
}));

import AuthLayout from './_layout';

describe('AuthLayout', () => {
  it('renders a Stack with headerShown false', () => {
    const { getByTestId } = render(<AuthLayout />);

    const stack = getByTestId('stack');
    const props = JSON.parse(stack.props.children);
    expect(props.headerShown).toBe(false);
  });
});

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

import OnboardingLayout from './_layout';

describe('OnboardingLayout', () => {
  it('renders a Stack with headerShown false and slide animation', () => {
    const { getByTestId } = render(<OnboardingLayout />);

    const stack = getByTestId('stack');
    const props = JSON.parse(stack.props.children);
    expect(props.headerShown).toBe(false);
    expect(props.animation).toBe('slide_from_right');
  });
});

import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock Stack.Screen to render headerRight if provided
jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => React.ReactNode } }) => {
      const { View } = require('react-native');
      if (options?.headerRight) {
        return <View testID="header-right">{options.headerRight()}</View>;
      }
      return null;
    },
  },
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));
jest.mock('@/features/workspace/hooks/use-tasks', () => ({
  useCreateTask: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
    error: null,
  }),
}));
jest.mock('@/components/date-picker-field', () => ({
  DatePickerField: ({ label, placeholder }: { label?: string; placeholder?: string }) => {
    const { View, Text } = require('react-native');
    return (
      <View>
        {label ? <Text>{label}</Text> : null}
        <Text>{placeholder ?? 'Select date'}</Text>
      </View>
    );
  },
}));

import CreateTaskScreen from '@/app/workspace/tasks/create';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('CreateTaskScreen', () => {
  it('renders title input and Save button', () => {
    const { getByPlaceholderText, getByText } = render(
      <CreateTaskScreen />,
      { wrapper: createWrapper() },
    );
    expect(
      getByPlaceholderText('e.g. Draft motion for reconsideration'),
    ).toBeTruthy();
    expect(getByText('Save')).toBeTruthy();
  });

  it('renders priority chips', () => {
    const { getByText } = render(<CreateTaskScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('Low')).toBeTruthy();
    expect(getByText('Medium')).toBeTruthy();
    expect(getByText('High')).toBeTruthy();
    expect(getByText('Urgent')).toBeTruthy();
  });
});

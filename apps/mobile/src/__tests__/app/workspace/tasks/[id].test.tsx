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
  useLocalSearchParams: jest.fn(() => ({ id: 't-1' })),
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseTask = jest.fn();
jest.mock('@/features/workspace/hooks/use-tasks', () => ({
  useTask: (...args: unknown[]) => mockUseTask(...args),
  useUpdateTask: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
  }),
  useDeleteTask: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
  }),
  useCreateTaskComment: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
  useDeleteTaskComment: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
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

import TaskDetailScreen from '@/app/workspace/tasks/[id]';

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

describe('TaskDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseTask.mockReturnValue({ data: undefined, isLoading: true });
    const { UNSAFE_root } = render(<TaskDetailScreen />, {
      wrapper: createWrapper(),
    });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders task title and status chips', () => {
    mockUseTask.mockReturnValue({
      data: {
        data: {
          id: 't-1',
          title: 'File Motion',
          description: 'File the preliminary motion',
          status: 'todo',
          priority: 'high',
          dueDate: '2024-04-01',
          assignedTo: null,
          assignedToUserId: null,
          createdBy: { id: 'u-1', fullName: 'Juan', email: 'juan@example.com' },
          createdByUserId: 'u-1',
          matter: null,
          matterId: null,
          comments: [],
          createdAt: '2024-03-01',
          updatedAt: '2024-03-01',
          organizationId: 'org-1',
          completedAt: null,
          _count: { comments: 0 },
        },
      },
      isLoading: false,
    });
    const { getByText } = render(<TaskDetailScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('File Motion')).toBeTruthy();
    expect(getByText('To Do')).toBeTruthy();
  });
});

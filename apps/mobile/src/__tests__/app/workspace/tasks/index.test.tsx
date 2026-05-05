import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseTasks = jest.fn();
jest.mock('@/features/workspace/hooks/use-tasks', () => ({
  useTasks: (...args: unknown[]) => mockUseTasks(...args),
  useDeleteTask: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
  useUpdateTask: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
}));

import TasksListScreen from '@/app/workspace/tasks/index';

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

describe('TasksListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseTasks.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<TasksListScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('No tasks yet')).toBeTruthy();
  });

  it('renders status filter chips', () => {
    mockUseTasks.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<TasksListScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('All')).toBeTruthy();
    expect(getByText('To Do')).toBeTruthy();
    expect(getByText('In Progress')).toBeTruthy();
  });

  it('renders task cards', () => {
    mockUseTasks.mockReturnValue({
      data: {
        data: [
          {
            id: 't-1',
            title: 'File Motion',
            status: 'todo',
            priority: 'high',
            dueDate: '2024-04-01',
            matter: { id: 'm-1', title: 'Smith v. Jones' },
            assignedTo: null,
            createdBy: { id: 'u-1', fullName: 'Juan', email: 'juan@example.com' },
            _count: { comments: 2 },
            createdAt: '2024-03-01',
            updatedAt: '2024-03-01',
            organizationId: 'org-1',
            matterId: 'm-1',
            createdByUserId: 'u-1',
            assignedToUserId: null,
            description: null,
            completedAt: null,
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<TasksListScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('File Motion')).toBeTruthy();
  });
});

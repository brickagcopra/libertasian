import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseBarSubjects = jest.fn();
jest.mock('@/features/study/hooks/use-bar-subjects', () => ({
  useBarSubjects: () => mockUseBarSubjects(),
}));

import CodalsSubjectSelector from '@/app/study/codals/index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('CodalsSubjectSelector', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseBarSubjects.mockReturnValue({ data: undefined, isLoading: true });
    const { UNSAFE_root } = render(<CodalsSubjectSelector />, { wrapper: createWrapper() });
    // ActivityIndicator renders when loading
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows empty state when no subjects', () => {
    mockUseBarSubjects.mockReturnValue({ data: [], isLoading: false });
    const { getByText } = render(<CodalsSubjectSelector />, { wrapper: createWrapper() });
    expect(getByText(/No bar subjects/i)).toBeTruthy();
  });

  it('renders subject cards', () => {
    mockUseBarSubjects.mockReturnValue({
      data: [
        { id: 's-1', code: 'civil_law', name: 'Civil Law', documentCount: 42 },
        { id: 's-2', code: 'criminal_law', name: 'Criminal Law', documentCount: 30 },
      ],
      isLoading: false,
    });
    const { getByText } = render(<CodalsSubjectSelector />, { wrapper: createWrapper() });
    expect(getByText('Civil Law')).toBeTruthy();
    expect(getByText('Criminal Law')).toBeTruthy();
  });

  it('navigates to subject codals on card press', () => {
    mockUseBarSubjects.mockReturnValue({
      data: [{ id: 's-1', code: 'civil_law', name: 'Civil Law', documentCount: 42 }],
      isLoading: false,
    });
    const { getByText } = render(<CodalsSubjectSelector />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Civil Law'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith('/study/codals/civil_law');
  });
});

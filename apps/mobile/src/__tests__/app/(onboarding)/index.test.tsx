import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    post: jest.fn(),
    get: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    setOnUnauthorized: jest.fn(),
  },
}));

jest.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    user: { fullName: 'Juan Cruz', email: 'juan@test.com' },
    setUser: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
    isAuthenticated: true,
    isLoading: false,
  }),
}));

jest.mock('@/storage/mmkv', () => ({
  mmkvStorage: { setBoolean: jest.fn(), getString: jest.fn(), set: jest.fn() },
  STORAGE_KEYS: { ONBOARDING_COMPLETED: 'onboarding_completed' },
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { replace: jest.fn(), push: jest.fn() },
}));

import { apiClient } from '@/lib/api-client';
import OnboardingScreen from '@/app/(onboarding)/index';

const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('OnboardingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the welcome step initially', () => {
    const { getByText, queryByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Step 1 of 5')).toBeTruthy();
    expect(getByText(/Welcome, Juan/)).toBeTruthy();
    expect(queryByText(/AI-powered Philippine legal research/)).toBeTruthy();
  });

  it('navigates to role step on Continue', () => {
    const { getByText, queryByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Continue'));

    expect(getByText('Step 2 of 5')).toBeTruthy();
    expect(queryByText('What best describes you?')).toBeTruthy();
  });

  it('shows role options on step 2', () => {
    const { getByText, queryByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Continue'));

    expect(queryByText('Law Student')).toBeTruthy();
    expect(queryByText('Bar Taker')).toBeTruthy();
    expect(queryByText('Solo Practitioner')).toBeTruthy();
    expect(queryByText('Firm Member')).toBeTruthy();
    expect(queryByText('Legal Editor')).toBeTruthy();
  });

  it('disables Continue when no role selected', () => {
    const { getByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    // Go to role step
    fireEvent.press(getByText('Continue'));

    // Continue button should be disabled (opacity style)
    // Try pressing Continue — it should not advance to step 3
    fireEvent.press(getByText('Continue'));
    expect(getByText('Step 2 of 5')).toBeTruthy();
  });

  it('advances after selecting a role', () => {
    const { getByText, queryByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Law Student'));
    fireEvent.press(getByText('Continue'));

    expect(getByText('Step 3 of 5')).toBeTruthy();
    expect(queryByText('Study Mode')).toBeTruthy();
  });

  it('shows student features for student role', () => {
    const { getByText, queryByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Law Student'));
    fireEvent.press(getByText('Continue'));

    expect(queryByText('Study Mode')).toBeTruthy();
    expect(queryByText('Codal Reader')).toBeTruthy();
  });

  it('shows practitioner features for solo practitioner role', () => {
    const { getByText, queryByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Solo Practitioner'));
    fireEvent.press(getByText('Continue'));

    expect(queryByText('Scan to Digest')).toBeTruthy();
    expect(queryByText('Matter Workspace')).toBeTruthy();
  });

  it('shows bar subjects on preferences step for student', () => {
    const { getByText, queryByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    // Navigate to step 4 as student
    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Law Student'));
    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Continue'));

    expect(getByText('Step 4 of 5')).toBeTruthy();
    expect(queryByText('Pick your bar subjects.')).toBeTruthy();
    expect(queryByText('Political Law')).toBeTruthy();
    expect(queryByText('Criminal Law')).toBeTruthy();
  });

  it('shows practice areas on preferences step for practitioner', () => {
    const { getByText, queryByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    // Navigate to step 4 as practitioner
    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Solo Practitioner'));
    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Continue'));

    expect(queryByText('Pick your practice areas.')).toBeTruthy();
    expect(queryByText('Civil Litigation')).toBeTruthy();
    expect(queryByText('Corporate Law')).toBeTruthy();
  });

  it('shows summary on ready step', () => {
    const { getByText, queryByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    // Navigate to step 5
    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Bar Taker'));
    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Continue'));
    fireEvent.press(getByText('Continue'));

    expect(getByText('Step 5 of 5')).toBeTruthy();
    expect(queryByText("You're all set.")).toBeTruthy();
    expect(queryByText(/Role: Bar Taker/)).toBeTruthy();
  });

  it('navigates back with Back button', () => {
    const { getByText, queryByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Continue'));
    expect(getByText('Step 2 of 5')).toBeTruthy();

    fireEvent.press(getByText('Back'));
    expect(getByText('Step 1 of 5')).toBeTruthy();
  });

  it('completes onboarding with Start Exploring', async () => {
    mockPatch.mockResolvedValue({
      data: { id: '1', fullName: 'Juan Cruz', email: 'juan@test.com' },
    });

    const { getByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    // Navigate to final step
    await act(async () => { fireEvent.press(getByText('Continue')); });
    await act(async () => { fireEvent.press(getByText('Bar Taker')); });
    await act(async () => { fireEvent.press(getByText('Continue')); });
    await act(async () => { fireEvent.press(getByText('Continue')); });
    await act(async () => { fireEvent.press(getByText('Continue')); });

    await act(async () => {
      fireEvent.press(getByText('Start exploring'));
      // Let the async function resolve
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockPatch).toHaveBeenCalledWith(
      '/users/me/onboarding',
      expect.objectContaining({
        userRole: 'bar_taker',
        skipped: false,
      }),
    );
  });

  it('completes onboarding with Skip', async () => {
    mockPatch.mockResolvedValue({ data: null });

    const { getByText } = render(<OnboardingScreen />, {
      wrapper: createWrapper(),
    });

    await act(async () => {
      fireEvent.press(getByText('Skip'));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockPatch).toHaveBeenCalledWith(
      '/users/me/onboarding',
      expect.objectContaining({
        skipped: true,
      }),
    );
  });
});

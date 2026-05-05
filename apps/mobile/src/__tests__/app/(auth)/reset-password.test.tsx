import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockMutateAsync = jest.fn();
jest.mock('@/features/auth/hooks/use-auth', () => ({
  useResetPassword: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

const mockUseLocalSearchParams = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@/lib/constants', () => ({
  APP_NAME: 'LIBERTASIAN',
}));

jest.mock('@/lib/api-client', () => ({
  apiClient: { post: jest.fn(), get: jest.fn(), setOnUnauthorized: jest.fn() },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    serverMessage: string;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.serverMessage = message;
    }
  },
}));

import { ApiClientError } from '@/lib/api-client';
import ResetPasswordScreen from '@/app/(auth)/reset-password';

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

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows invalid link state when no token is present', () => {
    mockUseLocalSearchParams.mockReturnValue({});

    const { getByText, queryByText } = render(<ResetPasswordScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Invalid Reset Link')).toBeTruthy();
    expect(queryByText('Request New Link')).toBeTruthy();
  });

  it('renders the reset form when token is present', () => {
    mockUseLocalSearchParams.mockReturnValue({ token: 'valid-token-123' });

    const { getAllByText, getByPlaceholderText } = render(
      <ResetPasswordScreen />,
      { wrapper: createWrapper() },
    );

    expect(getAllByText('Reset Password').length).toBeGreaterThanOrEqual(1);
    expect(getByPlaceholderText('Minimum 10 characters')).toBeTruthy();
    expect(getByPlaceholderText('Re-enter your password')).toBeTruthy();
  });

  it('shows validation error for empty password', async () => {
    mockUseLocalSearchParams.mockReturnValue({ token: 'valid-token-123' });

    const { getAllByText, queryByText } = render(<ResetPasswordScreen />, {
      wrapper: createWrapper(),
    });

    const resetBtn = getAllByText('Reset Password');

    await act(async () => {
      fireEvent.press(resetBtn[resetBtn.length - 1]);
    });

    await waitFor(() => {
      expect(queryByText('Password is required')).toBeTruthy();
    });
  });

  it('shows validation error for short password', async () => {
    mockUseLocalSearchParams.mockReturnValue({ token: 'valid-token-123' });

    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <ResetPasswordScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(getByPlaceholderText('Minimum 10 characters'), 'short');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'short');

    const resetBtn = getAllByText('Reset Password');
    await act(async () => {
      fireEvent.press(resetBtn[resetBtn.length - 1]);
    });

    await waitFor(() => {
      expect(queryByText('Password must be at least 10 characters')).toBeTruthy();
    });
  });

  it('shows validation error for mismatched passwords', async () => {
    mockUseLocalSearchParams.mockReturnValue({ token: 'valid-token-123' });

    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <ResetPasswordScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(
      getByPlaceholderText('Minimum 10 characters'),
      'NewPassword1234',
    );
    fireEvent.changeText(
      getByPlaceholderText('Re-enter your password'),
      'DifferentPass99',
    );

    const resetBtn = getAllByText('Reset Password');
    await act(async () => {
      fireEvent.press(resetBtn[resetBtn.length - 1]);
    });

    await waitFor(() => {
      expect(queryByText('Passwords do not match')).toBeTruthy();
    });
  });

  it('shows success state after valid reset', async () => {
    mockUseLocalSearchParams.mockReturnValue({ token: 'valid-token-123' });
    mockMutateAsync.mockResolvedValueOnce({});

    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <ResetPasswordScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(
      getByPlaceholderText('Minimum 10 characters'),
      'NewPassword1234',
    );
    fireEvent.changeText(
      getByPlaceholderText('Re-enter your password'),
      'NewPassword1234',
    );

    const resetBtn = getAllByText('Reset Password');
    await act(async () => {
      fireEvent.press(resetBtn[resetBtn.length - 1]);
    });

    await waitFor(() => {
      expect(queryByText('Password Reset')).toBeTruthy();
      expect(
        queryByText(/Your password has been reset successfully/),
      ).toBeTruthy();
    });
  });

  it('shows alert on 400 error (invalid token)', async () => {
    mockUseLocalSearchParams.mockReturnValue({ token: 'expired-token' });
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockMutateAsync.mockRejectedValueOnce(
      new ApiClientError(400, 'Token expired'),
    );

    const { getAllByText, getByPlaceholderText } = render(
      <ResetPasswordScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(
      getByPlaceholderText('Minimum 10 characters'),
      'NewPassword1234',
    );
    fireEvent.changeText(
      getByPlaceholderText('Re-enter your password'),
      'NewPassword1234',
    );

    const resetBtn = getAllByText('Reset Password');
    await act(async () => {
      fireEvent.press(resetBtn[resetBtn.length - 1]);
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Invalid or Expired Link',
        'This reset link is no longer valid. Please request a new one.',
      );
    });
  });

  it('has link to sign in page', () => {
    mockUseLocalSearchParams.mockReturnValue({ token: 'valid-token-123' });

    const { queryByText } = render(<ResetPasswordScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText(/Remember your password/)).toBeTruthy();
  });
});

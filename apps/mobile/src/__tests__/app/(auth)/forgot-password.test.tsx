import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockMutateAsync = jest.fn();
jest.mock('@/features/auth/hooks/use-auth', () => ({
  useForgotPassword: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
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
import ForgotPasswordScreen from '@/app/(auth)/forgot-password';

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

describe('ForgotPasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the forgot password form', () => {
    const { getByText, getByPlaceholderText } = render(
      <ForgotPasswordScreen />,
      { wrapper: createWrapper() },
    );

    expect(getByText('LIBERTASIAN')).toBeTruthy();
    expect(getByText('Forgot Password')).toBeTruthy();
    expect(getByPlaceholderText('you@example.com')).toBeTruthy();
    expect(getByText('Send Reset Link')).toBeTruthy();
  });

  it('shows validation error for empty email', async () => {
    const { getByText, queryByText } = render(<ForgotPasswordScreen />, {
      wrapper: createWrapper(),
    });

    await act(async () => {
      fireEvent.press(getByText('Send Reset Link'));
    });

    await waitFor(() => {
      expect(queryByText('Email is required')).toBeTruthy();
    });
  });

  it('shows validation error for invalid email', async () => {
    const { getByText, getByPlaceholderText, queryByText } = render(
      <ForgotPasswordScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'not-email');

    await act(async () => {
      fireEvent.press(getByText('Send Reset Link'));
    });

    await waitFor(() => {
      expect(queryByText('Enter a valid email address')).toBeTruthy();
    });
  });

  it('shows success state after valid submission', async () => {
    mockMutateAsync.mockResolvedValueOnce({});

    const { getByText, getByPlaceholderText, queryByText } = render(
      <ForgotPasswordScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(
      getByPlaceholderText('you@example.com'),
      'test@example.com',
    );

    await act(async () => {
      fireEvent.press(getByText('Send Reset Link'));
    });

    await waitFor(() => {
      expect(queryByText('Check Your Inbox')).toBeTruthy();
    });
  });

  it('shows success on non-429 error (anti-enumeration)', async () => {
    mockMutateAsync.mockRejectedValueOnce(
      new ApiClientError(404, 'Not found'),
    );

    const { getByText, getByPlaceholderText, queryByText } = render(
      <ForgotPasswordScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(
      getByPlaceholderText('you@example.com'),
      'noone@test.com',
    );

    await act(async () => {
      fireEvent.press(getByText('Send Reset Link'));
    });

    await waitFor(() => {
      expect(queryByText('Check Your Inbox')).toBeTruthy();
    });
  });

  it('shows alert on 429 rate limit', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockMutateAsync.mockRejectedValueOnce(
      new ApiClientError(429, 'Too many requests'),
    );

    const { getByText, getByPlaceholderText } = render(
      <ForgotPasswordScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(
      getByPlaceholderText('you@example.com'),
      'test@example.com',
    );

    await act(async () => {
      fireEvent.press(getByText('Send Reset Link'));
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Too Many Attempts',
        'Please wait a few minutes before trying again.',
      );
    });
  });

  it('has link to sign in page', () => {
    const { queryByText } = render(<ForgotPasswordScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText(/Remember your password/)).toBeTruthy();
  });
});

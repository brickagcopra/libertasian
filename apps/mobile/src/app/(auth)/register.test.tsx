import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockMutateAsync = jest.fn();
jest.mock('../../features/auth/hooks/use-auth', () => ({
  useRegister: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

const mockSignIn = jest.fn();
jest.mock('../../providers/auth-provider', () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    signOut: jest.fn(),
    user: null,
    isAuthenticated: false,
    isLoading: false,
    setUser: jest.fn(),
  }),
}));

jest.mock('../../lib/constants', () => ({
  APP_NAME: 'LIBERTASIAN',
}));

jest.mock('../../lib/api-client', () => ({
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

import { ApiClientError } from '../../lib/api-client';
import RegisterScreen from './register';

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

describe('RegisterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function pressSubmitButton(getAllByText: ReturnType<typeof render>['getAllByText']) {
    const elements = getAllByText('Create Account');
    fireEvent.press(elements[elements.length - 1]);
  }

  it('renders the registration form', () => {
    const { getAllByText, getByPlaceholderText } = render(<RegisterScreen />, {
      wrapper: createWrapper(),
    });

    expect(getAllByText('LIBERTASIAN').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Create Account').length).toBeGreaterThanOrEqual(2);
    expect(getByPlaceholderText('Juan Dela Cruz')).toBeTruthy();
    expect(getByPlaceholderText('you@example.com')).toBeTruthy();
    expect(getByPlaceholderText('Minimum 10 characters')).toBeTruthy();
    expect(getByPlaceholderText('Re-enter your password')).toBeTruthy();
  });

  it('shows validation error for empty full name', async () => {
    const { getAllByText, queryByText } = render(<RegisterScreen />, {
      wrapper: createWrapper(),
    });

    await act(async () => {
      pressSubmitButton(getAllByText);
    });

    await waitFor(() => {
      expect(queryByText('Full name is required')).toBeTruthy();
    });
  });

  it('shows validation error for short name', async () => {
    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <RegisterScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(getByPlaceholderText('Juan Dela Cruz'), 'A');

    await act(async () => {
      pressSubmitButton(getAllByText);
    });

    await waitFor(() => {
      expect(queryByText('Name must be at least 2 characters')).toBeTruthy();
    });
  });

  it('shows validation error for invalid email', async () => {
    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <RegisterScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(getByPlaceholderText('Juan Dela Cruz'), 'Juan Cruz');
    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'bad-email');
    fireEvent.changeText(getByPlaceholderText('Minimum 10 characters'), 'Password1234');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'Password1234');

    await act(async () => {
      pressSubmitButton(getAllByText);
    });

    await waitFor(() => {
      expect(queryByText('Enter a valid email address')).toBeTruthy();
    });
  });

  it('shows validation error for short password', async () => {
    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <RegisterScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(getByPlaceholderText('Juan Dela Cruz'), 'Juan Cruz');
    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'juan@test.com');
    fireEvent.changeText(getByPlaceholderText('Minimum 10 characters'), 'short');

    await act(async () => {
      pressSubmitButton(getAllByText);
    });

    await waitFor(() => {
      expect(queryByText('Password must be at least 10 characters')).toBeTruthy();
    });
  });

  it('shows validation error for mismatched passwords', async () => {
    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <RegisterScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(getByPlaceholderText('Juan Dela Cruz'), 'Juan Cruz');
    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'juan@test.com');
    fireEvent.changeText(getByPlaceholderText('Minimum 10 characters'), 'Password1234');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'DifferentPass1');

    await act(async () => {
      pressSubmitButton(getAllByText);
    });

    await waitFor(() => {
      expect(queryByText('Passwords do not match')).toBeTruthy();
    });
  });

  it('calls register mutation with correct data on valid submission', async () => {
    mockMutateAsync.mockResolvedValueOnce({
      user: { id: '1', email: 'juan@test.com', fullName: 'Juan Cruz' },
      accessToken: 'at-123',
      refreshToken: 'rt-456',
    });

    const { getAllByText, getByPlaceholderText } = render(<RegisterScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('Juan Dela Cruz'), 'Juan Cruz');
    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'juan@test.com');
    fireEvent.changeText(getByPlaceholderText('Minimum 10 characters'), 'Password1234');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'Password1234');

    await act(async () => {
      pressSubmitButton(getAllByText);
    });

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        fullName: 'Juan Cruz',
        email: 'juan@test.com',
        password: 'Password1234',
      });
    });
  });

  it('shows error for 409 conflict (duplicate email)', async () => {
    mockMutateAsync.mockRejectedValueOnce(
      new ApiClientError(409, 'Email already exists'),
    );

    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <RegisterScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(getByPlaceholderText('Juan Dela Cruz'), 'Juan Cruz');
    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'juan@test.com');
    fireEvent.changeText(getByPlaceholderText('Minimum 10 characters'), 'Password1234');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'Password1234');

    await act(async () => {
      pressSubmitButton(getAllByText);
    });

    await waitFor(() => {
      expect(queryByText('An account with this email already exists')).toBeTruthy();
    });
  });

  it('shows alert for 429 rate limit', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockMutateAsync.mockRejectedValueOnce(
      new ApiClientError(429, 'Too many requests'),
    );

    const { getAllByText, getByPlaceholderText } = render(<RegisterScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('Juan Dela Cruz'), 'Juan Cruz');
    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'juan@test.com');
    fireEvent.changeText(getByPlaceholderText('Minimum 10 characters'), 'Password1234');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'Password1234');

    await act(async () => {
      pressSubmitButton(getAllByText);
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Too Many Attempts',
        'Please wait a few minutes before trying again.',
      );
    });
  });

  it('shows breached password error', async () => {
    mockMutateAsync.mockRejectedValueOnce(
      new ApiClientError(400, 'This password has been found in a data breach'),
    );

    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <RegisterScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(getByPlaceholderText('Juan Dela Cruz'), 'Juan Cruz');
    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'juan@test.com');
    fireEvent.changeText(getByPlaceholderText('Minimum 10 characters'), 'Password1234');
    fireEvent.changeText(getByPlaceholderText('Re-enter your password'), 'Password1234');

    await act(async () => {
      pressSubmitButton(getAllByText);
    });

    await waitFor(() => {
      expect(
        queryByText(
          'This password has been found in a data breach. Please choose a different one.',
        ),
      ).toBeTruthy();
    });
  });

  it('has link to sign in page', () => {
    const { queryByText } = render(<RegisterScreen />, {
      wrapper: createWrapper(),
    });

    expect(queryByText(/Already have an account/)).toBeTruthy();
  });
});

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    post: jest.fn(),
    get: jest.fn(),
    setOnUnauthorized: jest.fn(),
  },
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

const mockSignIn = jest.fn();
jest.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    signOut: jest.fn(),
    user: null,
    isAuthenticated: false,
    isLoading: false,
    setUser: jest.fn(),
  }),
}));

import { apiClient, ApiClientError } from '@/lib/api-client';
import LoginScreen from '@/app/(auth)/login';

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

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

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the redesigned login form', () => {
    const { getByText, getByPlaceholderText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Welcome back.')).toBeTruthy();
    expect(getByText('Pick up where you left off.')).toBeTruthy();
    expect(getByText('Sign in')).toBeTruthy();
    expect(getByPlaceholderText('you@example.com')).toBeTruthy();
    // Password placeholder is now bullets (•) in the redesigned screen.
    expect(getByPlaceholderText('••••••••')).toBeTruthy();
  });

  it('calls login mutation with trimmed/lowercased email and password', async () => {
    mockPost.mockResolvedValueOnce({
      user: {
        id: '1',
        email: 'test@example.com',
        fullName: 'Test',
        phone: null,
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        createdAt: '2024-01-01',
      },
      tokens: { accessToken: 'at-123', refreshToken: 'rt-456' },
      mfaRequired: false,
    });

    const { getByText, getByPlaceholderText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('you@example.com'), '  TEST@example.com  ');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'MyPassword123!');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/login',
        expect.objectContaining({
          email: 'test@example.com',
          password: 'MyPassword123!',
        }),
        expect.anything(),
      );
    });
  });

  it('shows the MFA modal when the API returns mfaRequired', async () => {
    mockPost.mockResolvedValueOnce({
      mfaRequired: true,
      tokens: { accessToken: '', refreshToken: '' },
      user: null,
    });

    const { getByText, getByPlaceholderText, queryByText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'test@example.com');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'password123');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    await waitFor(() => {
      expect(queryByText('Two-step verification')).toBeTruthy();
    });

    expect(getByPlaceholderText('000000')).toBeTruthy();
  });

  it('shows inline error message on 401', async () => {
    mockPost.mockRejectedValueOnce(new ApiClientError(401, 'Invalid credentials'));

    const { getByText, getByPlaceholderText, queryByText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'test@example.com');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'wrongpass');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    await waitFor(() => {
      expect(queryByText('Invalid email or password.')).toBeTruthy();
    });
  });

  it('shows rate-limit alert on 429', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockPost.mockRejectedValueOnce(new ApiClientError(429, 'Too many attempts'));

    const { getByText, getByPlaceholderText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'test@example.com');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'pw');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Too Many Attempts',
        expect.stringContaining('few minutes'),
      );
    });
  });

  it('renders Forgot? link and Create an account link', () => {
    const { getByText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Forgot?')).toBeTruthy();
    expect(getByText('Create an account')).toBeTruthy();
  });
});

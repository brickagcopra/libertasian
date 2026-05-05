import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
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

jest.mock('@/lib/constants', () => ({
  APP_NAME: 'LIBERTASIAN',
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

  it('renders the login form with email and password fields', () => {
    const { getByText, getAllByText, getByPlaceholderText } = render(
      <LoginScreen />,
      { wrapper: createWrapper() },
    );

    expect(getByText('LIBERTASIAN')).toBeTruthy();
    // "Sign In" appears as both header title and button label
    expect(getAllByText('Sign In').length).toBeGreaterThanOrEqual(2);
    expect(getByPlaceholderText('you@example.com')).toBeTruthy();
    expect(getByPlaceholderText('Enter your password')).toBeTruthy();
  });

  it('shows validation error for empty email', async () => {
    const { getAllByText, queryByText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    // Press the Sign In button (second "Sign In" text — first is the header)
    const signInElements = getAllByText('Sign In');
    await act(async () => {
      fireEvent.press(signInElements[signInElements.length - 1]);
    });

    await waitFor(() => {
      expect(queryByText('Email is required')).toBeTruthy();
    });
  });

  it('shows validation error for invalid email', async () => {
    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <LoginScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'not-an-email');
    fireEvent.changeText(getByPlaceholderText('Enter your password'), 'password123');

    const signInElements = getAllByText('Sign In');
    await act(async () => {
      fireEvent.press(signInElements[signInElements.length - 1]);
    });

    await waitFor(() => {
      expect(queryByText('Enter a valid email address')).toBeTruthy();
    });
  });

  it('shows validation error for empty password', async () => {
    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <LoginScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'test@example.com');

    const signInElements = getAllByText('Sign In');
    await act(async () => {
      fireEvent.press(signInElements[signInElements.length - 1]);
    });

    await waitFor(() => {
      expect(queryByText('Password is required')).toBeTruthy();
    });
  });

  it('calls login mutation with correct data', async () => {
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

    const { getAllByText, getByPlaceholderText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(
      getByPlaceholderText('you@example.com'),
      'test@example.com',
    );
    fireEvent.changeText(
      getByPlaceholderText('Enter your password'),
      'MyPassword123!',
    );

    const signInElements = getAllByText('Sign In');
    await act(async () => {
      fireEvent.press(signInElements[signInElements.length - 1]);
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

  it('shows MFA field when mfaRequired is returned', async () => {
    mockPost.mockResolvedValueOnce({
      mfaRequired: true,
      tokens: { accessToken: '', refreshToken: '' },
      user: null,
    });

    const { getAllByText, getByPlaceholderText, queryByText } = render(
      <LoginScreen />,
      { wrapper: createWrapper() },
    );

    fireEvent.changeText(
      getByPlaceholderText('you@example.com'),
      'test@example.com',
    );
    fireEvent.changeText(
      getByPlaceholderText('Enter your password'),
      'password123',
    );

    const signInElements = getAllByText('Sign In');
    await act(async () => {
      fireEvent.press(signInElements[signInElements.length - 1]);
    });

    await waitFor(() => {
      expect(queryByText('MFA Code')).toBeTruthy();
    });

    expect(getByPlaceholderText('000000')).toBeTruthy();
  });

  it('shows alert on 401 error', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockPost.mockRejectedValueOnce(
      new ApiClientError(401, 'Invalid credentials'),
    );

    const { getAllByText, getByPlaceholderText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(
      getByPlaceholderText('you@example.com'),
      'test@example.com',
    );
    fireEvent.changeText(
      getByPlaceholderText('Enter your password'),
      'wrongpass',
    );

    const signInElements = getAllByText('Sign In');
    await act(async () => {
      fireEvent.press(signInElements[signInElements.length - 1]);
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Login Failed',
        'Invalid email or password.',
      );
    });
  });

  it('has links to forgot password and register', () => {
    const { getByText, queryByText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Forgot password?')).toBeTruthy();
    expect(queryByText(/Don't have an account/)).toBeTruthy();
  });
});

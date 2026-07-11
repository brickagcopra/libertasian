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

// EXPO_PUBLIC_* reads are inlined by babel at transform time, so tests mock
// the env accessor module instead of mutating process.env.
jest.mock('@/features/auth/social-login-env', () => ({
  getGoogleWebClientId: jest.fn(),
  getGoogleIosClientId: jest.fn(),
}));

import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { apiClient, ApiClientError } from '@/lib/api-client';
import {
  getGoogleIosClientId,
  getGoogleWebClientId,
} from '@/features/auth/social-login-env';
import LoginScreen from '@/app/(auth)/login';

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockGoogleSignIn = GoogleSignin.signIn as jest.MockedFunction<typeof GoogleSignin.signIn>;
const mockAppleSignIn = AppleAuthentication.signInAsync as jest.MockedFunction<
  typeof AppleAuthentication.signInAsync
>;

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

  it('shows inline validation error when email is empty', async () => {
    const { getByText, queryByText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    await waitFor(() => {
      expect(queryByText('Email is required')).toBeTruthy();
    });
    // Submission was blocked — no API call.
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows inline validation error for invalid email', async () => {
    const { getByText, getByPlaceholderText, queryByText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'not-an-email');
    fireEvent.changeText(getByPlaceholderText('••••••••'), 'somepassword');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    await waitFor(() => {
      expect(queryByText('Enter a valid email address')).toBeTruthy();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows inline validation error when password is empty', async () => {
    const { getByText, getByPlaceholderText, queryByText } = render(<LoginScreen />, {
      wrapper: createWrapper(),
    });

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'test@example.com');

    await act(async () => {
      fireEvent.press(getByText('Sign in'));
    });

    await waitFor(() => {
      expect(queryByText('Password is required')).toBeTruthy();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('LoginScreen — social sign-in buttons', () => {
  const mockWebClientId = getGoogleWebClientId as jest.MockedFunction<
    typeof getGoogleWebClientId
  >;
  const mockIosClientId = getGoogleIosClientId as jest.MockedFunction<
    typeof getGoogleIosClientId
  >;

  const authResponse = {
    user: {
      id: '1',
      email: 'test@example.com',
      fullName: 'Test',
      phone: null,
      status: 'active',
      emailVerified: true,
      mfaEnabled: false,
      onboardingCompletedAt: '2026-01-01',
      createdAt: '2024-01-01',
    },
    tokens: { accessToken: 'at-123', refreshToken: 'rt-456' },
    mfaRequired: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWebClientId.mockReturnValue('web-id.apps.googleusercontent.com');
    mockIosClientId.mockReturnValue('ios-id.apps.googleusercontent.com');
  });

  it('renders Apple, Google, and SSO buttons on iOS', () => {
    const { getByText } = render(<LoginScreen />, { wrapper: createWrapper() });

    expect(getByText('Apple')).toBeTruthy();
    expect(getByText('Google')).toBeTruthy();
    expect(getByText('SSO')).toBeTruthy();
  });

  it('hides the Apple button on Android (guideline 4.8 is iOS-only)', () => {
    const replaced = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      const { queryByText, getByText } = render(<LoginScreen />, { wrapper: createWrapper() });

      expect(queryByText('Apple')).toBeNull();
      expect(getByText('Google')).toBeTruthy();
      expect(getByText('SSO')).toBeTruthy();
    } finally {
      replaced.restore();
    }
  });

  it('Google without EXPO_PUBLIC_GOOGLE_* env: shows Coming soon, never touches the native module', async () => {
    mockWebClientId.mockReturnValue(undefined);
    mockIosClientId.mockReturnValue(undefined);
    const { getByText } = render(<LoginScreen />, { wrapper: createWrapper() });

    await act(async () => {
      fireEvent.press(getByText('Google'));
    });

    expect(Alert.alert).toHaveBeenCalledWith('Coming soon', 'Google sign-in is not yet enabled.');
    expect(mockGoogleSignIn).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('Google success: exchanges the idToken and signs in through the shared auth path', async () => {
    mockGoogleSignIn.mockResolvedValue({
      type: 'success',
      data: { idToken: 'google-id-token' },
    } as never);
    mockPost.mockResolvedValue(authResponse);

    const { getByText } = render(<LoginScreen />, { wrapper: createWrapper() });

    await act(async () => {
      fireEvent.press(getByText('Google'));
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/google/mobile',
        { idToken: 'google-id-token' },
        { skipAuth: true },
      );
    });
    expect(mockSignIn).toHaveBeenCalledWith('at-123', 'rt-456', authResponse.user);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('Google cancel is silent: no alert, no API call, no auth change', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'cancelled', data: null } as never);

    const { getByText } = render(<LoginScreen />, { wrapper: createWrapper() });

    await act(async () => {
      fireEvent.press(getByText('Google'));
    });

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('Google real failure: one friendly alert, no auth change', async () => {
    mockGoogleSignIn.mockRejectedValue(
      Object.assign(new Error('play services broke'), { code: 'PLAY_SERVICES_NOT_AVAILABLE' }),
    );

    const { getByText } = render(<LoginScreen />, { wrapper: createWrapper() });

    await act(async () => {
      fireEvent.press(getByText('Google'));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Sign-in failed',
      expect.stringContaining('Google'),
    );
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('Apple success: exchanges the identityToken and signs in', async () => {
    mockAppleSignIn.mockResolvedValue({
      identityToken: 'apple-jwt',
      fullName: { givenName: 'Juan', familyName: 'Dela Cruz' },
    } as never);
    mockPost.mockResolvedValue(authResponse);

    const { getByText } = render(<LoginScreen />, { wrapper: createWrapper() });

    await act(async () => {
      fireEvent.press(getByText('Apple'));
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/apple/mobile',
        { identityToken: 'apple-jwt', fullName: 'Juan Dela Cruz' },
        { skipAuth: true },
      );
    });
    expect(mockSignIn).toHaveBeenCalledWith('at-123', 'rt-456', authResponse.user);
  });

  it('Apple cancel is silent: no alert, no API call', async () => {
    mockAppleSignIn.mockRejectedValue(
      Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }),
    );

    const { getByText } = render(<LoginScreen />, { wrapper: createWrapper() });

    await act(async () => {
      fireEvent.press(getByText('Apple'));
    });

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('SSO stays a Coming soon stub', async () => {
    const { getByText } = render(<LoginScreen />, { wrapper: createWrapper() });

    await act(async () => {
      fireEvent.press(getByText('SSO'));
    });

    expect(Alert.alert).toHaveBeenCalledWith('Coming soon', 'SSO is not yet enabled.');
  });
});

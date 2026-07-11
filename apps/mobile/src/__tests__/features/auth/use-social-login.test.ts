import { renderHook, act } from '@testing-library/react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { router } from 'expo-router';

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
      this.statusCode = statusCode;
      this.serverMessage = message;
    }
  },
}));

const mockAuthSignIn = jest.fn();
jest.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    signIn: mockAuthSignIn,
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

import { apiClient } from '@/lib/api-client';
import {
  getGoogleIosClientId,
  getGoogleWebClientId,
} from '@/features/auth/social-login-env';
import {
  isAppleSignInAvailable,
  isGoogleSignInAvailable,
  useSocialLogin,
} from '@/features/auth/hooks/use-social-login';

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockGoogleSignIn = GoogleSignin.signIn as jest.MockedFunction<typeof GoogleSignin.signIn>;
const mockAppleSignIn = AppleAuthentication.signInAsync as jest.MockedFunction<
  typeof AppleAuthentication.signInAsync
>;

const authResponse = {
  user: {
    id: 'u1',
    email: 'juan@example.com',
    fullName: 'Juan',
    onboardingCompletedAt: '2026-01-01',
  },
  tokens: { accessToken: 'AT', refreshToken: 'RT' },
  mfaRequired: false,
};

const mockWebClientId = getGoogleWebClientId as jest.MockedFunction<typeof getGoogleWebClientId>;
const mockIosClientId = getGoogleIosClientId as jest.MockedFunction<typeof getGoogleIosClientId>;

describe('use-social-login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebClientId.mockReturnValue('web-id.apps.googleusercontent.com');
    mockIosClientId.mockReturnValue('ios-id.apps.googleusercontent.com');
  });

  describe('availability', () => {
    it('Google is available when both client IDs are set (iOS default platform)', () => {
      expect(isGoogleSignInAvailable()).toBe(true);
    });

    it('Google is unavailable without the web client ID', () => {
      mockWebClientId.mockReturnValue(undefined);
      expect(isGoogleSignInAvailable()).toBe(false);
    });

    it('Google is unavailable on iOS without the iOS client ID', () => {
      mockIosClientId.mockReturnValue(undefined);
      expect(isGoogleSignInAvailable()).toBe(false);
    });

    it('Apple is available on iOS (jest-expo default platform)', () => {
      expect(isAppleSignInAvailable()).toBe(true);
    });
  });

  describe('signInWithGoogle', () => {
    it('exchanges the idToken at /auth/google/mobile and signs in via the shared auth path', async () => {
      mockGoogleSignIn.mockResolvedValue({
        type: 'success',
        data: { idToken: 'google-id-token' },
      } as never);
      mockPost.mockResolvedValue(authResponse);

      const { result } = renderHook(() => useSocialLogin());
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      expect(outcome).toBe('success');
      expect(GoogleSignin.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          webClientId: 'web-id.apps.googleusercontent.com',
          iosClientId: 'ios-id.apps.googleusercontent.com',
        }),
      );
      expect(GoogleSignin.hasPlayServices).toHaveBeenCalledWith({
        showPlayServicesUpdateDialog: true,
      });
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/google/mobile',
        { idToken: 'google-id-token' },
        { skipAuth: true },
      );
      // EXACT same token-storage path as password login
      expect(mockAuthSignIn).toHaveBeenCalledWith('AT', 'RT', authResponse.user);
      expect(router.replace).toHaveBeenCalledWith('/(tabs)');
    });

    it('routes new users (no onboardingCompletedAt) to onboarding', async () => {
      mockGoogleSignIn.mockResolvedValue({
        type: 'success',
        data: { idToken: 't' },
      } as never);
      mockPost.mockResolvedValue({
        ...authResponse,
        user: { ...authResponse.user, onboardingCompletedAt: null },
      });

      const { result } = renderHook(() => useSocialLogin());
      await act(async () => {
        await result.current.signInWithGoogle();
      });

      expect(router.replace).toHaveBeenCalledWith('/(onboarding)');
    });

    it('user cancel via v13 { type: "cancelled" } is a silent no-op', async () => {
      mockGoogleSignIn.mockResolvedValue({ type: 'cancelled', data: null } as never);

      const { result } = renderHook(() => useSocialLogin());
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      expect(outcome).toBe('cancelled');
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockAuthSignIn).not.toHaveBeenCalled();
    });

    it('user cancel via thrown SIGN_IN_CANCELLED code is a silent no-op', async () => {
      mockGoogleSignIn.mockRejectedValue(
        Object.assign(new Error('cancelled'), { code: 'SIGN_IN_CANCELLED' }),
      );

      const { result } = renderHook(() => useSocialLogin());
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      expect(outcome).toBe('cancelled');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('API rejection → failed, no auth state change', async () => {
      mockGoogleSignIn.mockResolvedValue({
        type: 'success',
        data: { idToken: 'bad' },
      } as never);
      mockPost.mockRejectedValue(new Error('401'));

      const { result } = renderHook(() => useSocialLogin());
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      expect(outcome).toBe('failed');
      expect(mockAuthSignIn).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });

    it('missing env → failed without touching the native module', async () => {
      mockWebClientId.mockReturnValue(undefined);

      const { result } = renderHook(() => useSocialLogin());
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      expect(outcome).toBe('failed');
      expect(GoogleSignin.signIn).not.toHaveBeenCalled();
    });
  });

  describe('signInWithApple', () => {
    it('exchanges identityToken + formatted fullName (first authorization)', async () => {
      mockAppleSignIn.mockResolvedValue({
        identityToken: 'apple-jwt',
        fullName: { givenName: 'Juan', middleName: null, familyName: 'Dela Cruz' },
      } as never);
      mockPost.mockResolvedValue(authResponse);

      const { result } = renderHook(() => useSocialLogin());
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.signInWithApple();
      });

      expect(outcome).toBe('success');
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/apple/mobile',
        { identityToken: 'apple-jwt', fullName: 'Juan Dela Cruz' },
        { skipAuth: true },
      );
      expect(mockAuthSignIn).toHaveBeenCalledWith('AT', 'RT', authResponse.user);
    });

    it('omits fullName on subsequent authorizations (Apple sends it only once)', async () => {
      mockAppleSignIn.mockResolvedValue({
        identityToken: 'apple-jwt',
        fullName: null,
      } as never);
      mockPost.mockResolvedValue(authResponse);

      const { result } = renderHook(() => useSocialLogin());
      await act(async () => {
        await result.current.signInWithApple();
      });

      expect(mockPost).toHaveBeenCalledWith(
        '/auth/apple/mobile',
        { identityToken: 'apple-jwt' },
        { skipAuth: true },
      );
    });

    it('user cancel (ERR_REQUEST_CANCELED) is a silent no-op', async () => {
      mockAppleSignIn.mockRejectedValue(
        Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }),
      );

      const { result } = renderHook(() => useSocialLogin());
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.signInWithApple();
      });

      expect(outcome).toBe('cancelled');
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockAuthSignIn).not.toHaveBeenCalled();
    });

    it('missing identityToken → failed', async () => {
      mockAppleSignIn.mockResolvedValue({ identityToken: null, fullName: null } as never);

      const { result } = renderHook(() => useSocialLogin());
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.signInWithApple();
      });

      expect(outcome).toBe('failed');
      expect(mockPost).not.toHaveBeenCalled();
    });
  });
});

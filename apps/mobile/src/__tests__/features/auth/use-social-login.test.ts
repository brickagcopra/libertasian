import { renderHook, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { router } from 'expo-router';

// The real client pulls in expo-sqlite / NetInfo / MMKV. We only care that the
// failure reporting reaches the PRE-AUTH endpoint, so stub the whole module.
jest.mock('@/lib/analytics', () => ({
  mobileAnalytics: { trackPreAuth: jest.fn(), track: jest.fn() },
}));

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
import { mobileAnalytics } from '@/lib/analytics';
import {
  getGoogleIosClientId,
  getGoogleWebClientId,
} from '@/features/auth/social-login-env';
import {
  isAppleSignInAvailable,
  isGoogleSignInAvailable,
  useSocialLogin,
  type SocialLoginResult,
} from '@/features/auth/hooks/use-social-login';

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockTrackPreAuth = mobileAnalytics.trackPreAuth as jest.MockedFunction<
  typeof mobileAnalytics.trackPreAuth
>;
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
      let outcome: SocialLoginResult | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      expect(outcome?.outcome).toBe('success');
      expect(GoogleSignin.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          webClientId: 'web-id.apps.googleusercontent.com',
          iosClientId: 'ios-id.apps.googleusercontent.com',
        }),
      );
      // hasPlayServices is a no-op on iOS (the library returns true before
      // touching the native module), so it is no longer called there.
      expect(GoogleSignin.hasPlayServices).not.toHaveBeenCalled();
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
      let outcome: SocialLoginResult | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      expect(outcome?.outcome).toBe('cancelled');
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockAuthSignIn).not.toHaveBeenCalled();
    });

    it('user cancel via thrown SIGN_IN_CANCELLED code is a silent no-op', async () => {
      mockGoogleSignIn.mockRejectedValue(
        Object.assign(new Error('cancelled'), { code: 'SIGN_IN_CANCELLED' }),
      );

      const { result } = renderHook(() => useSocialLogin());
      let outcome: SocialLoginResult | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      expect(outcome?.outcome).toBe('cancelled');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('API rejection → failed, no auth state change', async () => {
      mockGoogleSignIn.mockResolvedValue({
        type: 'success',
        data: { idToken: 'bad' },
      } as never);
      mockPost.mockRejectedValue(new Error('401'));

      const { result } = renderHook(() => useSocialLogin());
      let outcome: SocialLoginResult | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      expect(outcome?.outcome).toBe('failed');
      expect(mockAuthSignIn).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });

    it('missing env → unavailable, reported as its own event, native module untouched', async () => {
      mockWebClientId.mockReturnValue(undefined);

      const { result } = renderHook(() => useSocialLogin());
      let outcome: SocialLoginResult | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      // NOT 'failed': nothing was attempted and retrying cannot help.
      expect(outcome?.outcome).toBe('unavailable');
      expect(GoogleSignin.signIn).not.toHaveBeenCalled();
      expect(mockTrackPreAuth).toHaveBeenCalledWith('social_login_unavailable', {
        provider: 'google',
        platform: Platform.OS,
        reason: 'missing_web_client_id',
      });
    });

    it('iOS without the iOS client ID reports which precondition failed', async () => {
      mockIosClientId.mockReturnValue(undefined);

      const { result } = renderHook(() => useSocialLogin());
      await act(async () => {
        await result.current.signInWithGoogle();
      });

      expect(mockTrackPreAuth).toHaveBeenCalledWith(
        'social_login_unavailable',
        expect.objectContaining({ reason: 'missing_ios_client_id' }),
      );
    });

    it('calls hasPlayServices on Android, where it means something', async () => {
      const replaced = jest.replaceProperty(Platform, 'OS', 'android');
      try {
        mockGoogleSignIn.mockResolvedValue({
          type: 'success',
          data: { idToken: 't' },
        } as never);
        mockPost.mockResolvedValue(authResponse);

        const { result } = renderHook(() => useSocialLogin());
        await act(async () => {
          await result.current.signInWithGoogle();
        });

        expect(GoogleSignin.hasPlayServices).toHaveBeenCalledWith({
          showPlayServicesUpdateDialog: true,
        });
      } finally {
        replaced.restore();
      }
    });

    it('a native DEVELOPER_ERROR reports stage + code and returns the code to the caller', async () => {
      mockGoogleSignIn.mockRejectedValue(
        Object.assign(new Error('DEVELOPER_ERROR'), { code: '10' }),
      );

      const { result } = renderHook(() => useSocialLogin());
      let outcome: SocialLoginResult | undefined;
      await act(async () => {
        outcome = await result.current.signInWithGoogle();
      });

      expect(outcome).toEqual({ outcome: 'failed', code: '10' });
      expect(mockTrackPreAuth).toHaveBeenCalledWith('social_login_failed', {
        provider: 'google',
        platform: Platform.OS,
        stage: 'native_sign_in',
        code: '10',
        message: 'DEVELOPER_ERROR',
      });
    });

    it('an API rejection is reported at the token_exchange stage, never the id token', async () => {
      mockGoogleSignIn.mockResolvedValue({
        type: 'success',
        data: { idToken: 'super-secret-id-token' },
      } as never);
      mockPost.mockRejectedValue(new Error('401 Unauthorized'));

      const { result } = renderHook(() => useSocialLogin());
      await act(async () => {
        await result.current.signInWithGoogle();
      });

      expect(mockTrackPreAuth).toHaveBeenCalledWith(
        'social_login_failed',
        expect.objectContaining({ stage: 'token_exchange' }),
      );
      // No token material may reach analytics, ever.
      const sent = JSON.stringify(mockTrackPreAuth.mock.calls);
      expect(sent).not.toContain('super-secret-id-token');
    });

    it('a cancel is never reported — it is not a failure', async () => {
      mockGoogleSignIn.mockResolvedValue({ type: 'cancelled', data: null } as never);

      const { result } = renderHook(() => useSocialLogin());
      await act(async () => {
        await result.current.signInWithGoogle();
      });

      expect(mockTrackPreAuth).not.toHaveBeenCalled();
    });

    it('a missing id token is reported at the id_token stage', async () => {
      mockGoogleSignIn.mockResolvedValue({ type: 'success', data: {} } as never);

      const { result } = renderHook(() => useSocialLogin());
      await act(async () => {
        await result.current.signInWithGoogle();
      });

      expect(mockTrackPreAuth).toHaveBeenCalledWith(
        'social_login_failed',
        expect.objectContaining({ stage: 'id_token', message: 'no_id_token' }),
      );
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
      let outcome: SocialLoginResult | undefined;
      await act(async () => {
        outcome = await result.current.signInWithApple();
      });

      expect(outcome?.outcome).toBe('success');
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
      let outcome: SocialLoginResult | undefined;
      await act(async () => {
        outcome = await result.current.signInWithApple();
      });

      expect(outcome?.outcome).toBe('cancelled');
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockAuthSignIn).not.toHaveBeenCalled();
    });

    it('missing identityToken → failed', async () => {
      mockAppleSignIn.mockResolvedValue({ identityToken: null, fullName: null } as never);

      const { result } = renderHook(() => useSocialLogin());
      let outcome: SocialLoginResult | undefined;
      await act(async () => {
        outcome = await result.current.signInWithApple();
      });

      expect(outcome?.outcome).toBe('failed');
      expect(mockPost).not.toHaveBeenCalled();
    });
  });
});

import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { apiClient } from '../../../lib/api-client';
import { logger } from '../../../lib/logger';
import { useAuth } from '../../../providers/auth-provider';
import { getGoogleIosClientId, getGoogleWebClientId } from '../social-login-env';
import type { AuthResponse } from '../types';

export type SocialProvider = 'google' | 'apple';

/**
 * `cancelled` = the user backed out of the native sheet — callers must treat
 * it as a silent no-op, never an error. `failed` = anything else (native
 * error, network, API rejection); callers show ONE friendly message.
 */
export type SocialLoginOutcome = 'success' | 'cancelled' | 'failed';

/**
 * Whether native Google Sign-In can run in this build. Both client IDs are
 * baked in at build time via EXPO_PUBLIC_* env; when the build shipped
 * without them the Google button degrades to the "Coming soon" alert
 * instead of crashing into an unconfigured native module.
 */
export function isGoogleSignInAvailable(): boolean {
  if (!getGoogleWebClientId()) return false;
  if (Platform.OS === 'ios' && !getGoogleIosClientId()) return false;
  return true;
}

/** Apple guideline 4.8: Sign in with Apple is required (and iOS-only). */
export function isAppleSignInAvailable(): boolean {
  return Platform.OS === 'ios';
}

/**
 * Apple sends the user's name ONLY on first authorization; format it for the
 * API when present, otherwise the server falls back to the email local-part.
 */
function formatAppleFullName(
  name: AppleAuthentication.AppleAuthenticationFullName | null,
): string | undefined {
  if (!name) return undefined;
  const formatted = [name.givenName, name.middleName, name.familyName]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');
  return formatted || undefined;
}

/**
 * google-signin v13 calls TurboModuleRegistry.getEnforcing at IMPORT time, so
 * a binary built without the native module (older dev client, OTA over a
 * pre-social-login build) would crash the login screen on mount if this were
 * a static import. Lazy-require keeps the screen mountable — a missing module
 * surfaces as the friendly 'failed' alert instead.
 * (expo-apple-authentication needs no such guard: it resolves its native
 * module optionally and stubs isAvailableAsync=false when absent.)
 */
function requireGoogleSignin(): typeof import('@react-native-google-signin/google-signin') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-google-signin/google-signin');
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
  }
  return undefined;
}

/** Extract the ID token from a google-signin v13 `{ type, data }` response
 *  (tolerating the pre-v13 flat shape) without echoing anything else. */
function extractGoogleSignInResult(result: unknown): {
  cancelled: boolean;
  idToken: string | null;
} {
  if (!result || typeof result !== 'object') return { cancelled: false, idToken: null };
  const shaped = result as { type?: string; data?: { idToken?: string | null } | null; idToken?: string | null };
  if (shaped.type === 'cancelled') return { cancelled: true, idToken: null };
  const idToken = shaped.data?.idToken ?? shaped.idToken ?? null;
  return { cancelled: false, idToken };
}

/**
 * Native social sign-in for the login screen. Exchanges the provider's ID
 * token at the mobile token-exchange endpoints (POST /auth/google/mobile,
 * POST /auth/apple/mobile — X-Client: mobile is set by apiClient on every
 * request) and then feeds the response through the EXACT same
 * token-storage/auth-state path password login uses: authStorage via
 * AuthProvider.signIn, then the same onboarding-aware redirect.
 *
 * OAuth has no separate register flow — the API links or creates the account,
 * so login and register screens share this hook.
 */
export function useSocialLogin() {
  const { signIn } = useAuth();
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);

  const completeLogin = useCallback(
    async (result: AuthResponse) => {
      await signIn(result.tokens.accessToken, result.tokens.refreshToken, result.user);
      router.replace(result.user.onboardingCompletedAt ? '/(tabs)' : '/(onboarding)');
    },
    [signIn],
  );

  const signInWithGoogle = useCallback(async (): Promise<SocialLoginOutcome> => {
    if (!isGoogleSignInAvailable()) return 'failed';
    setPendingProvider('google');
    let cancelCode: string | undefined;
    try {
      const { GoogleSignin, statusCodes } = requireGoogleSignin();
      cancelCode = String(statusCodes.SIGN_IN_CANCELLED);

      const iosClientId = getGoogleIosClientId();
      GoogleSignin.configure({
        webClientId: getGoogleWebClientId() as string,
        ...(iosClientId ? { iosClientId } : {}),
      });
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      const { cancelled, idToken } = extractGoogleSignInResult(await GoogleSignin.signIn());
      if (cancelled) return 'cancelled';
      if (!idToken) {
        logger.warn('social_login_failed', { provider: 'google', reason: 'no_id_token' });
        return 'failed';
      }

      const response = await apiClient.post<AuthResponse>(
        '/auth/google/mobile',
        { idToken },
        { skipAuth: true },
      );
      await completeLogin(response);
      return 'success';
    } catch (err) {
      const code = errorCode(err);
      if (cancelCode !== undefined && code === cancelCode) return 'cancelled';
      logger.warn('social_login_failed', {
        provider: 'google',
        code,
        message: err instanceof Error ? err.message : 'unknown',
      });
      return 'failed';
    } finally {
      setPendingProvider(null);
    }
  }, [completeLogin]);

  const signInWithApple = useCallback(async (): Promise<SocialLoginOutcome> => {
    setPendingProvider('apple');
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        logger.warn('social_login_failed', { provider: 'apple', reason: 'no_identity_token' });
        return 'failed';
      }

      const fullName = formatAppleFullName(credential.fullName);
      const response = await apiClient.post<AuthResponse>(
        '/auth/apple/mobile',
        { identityToken: credential.identityToken, ...(fullName ? { fullName } : {}) },
        { skipAuth: true },
      );
      await completeLogin(response);
      return 'success';
    } catch (err) {
      const code = errorCode(err);
      if (code === 'ERR_REQUEST_CANCELED') return 'cancelled';
      logger.warn('social_login_failed', {
        provider: 'apple',
        code,
        message: err instanceof Error ? err.message : 'unknown',
      });
      return 'failed';
    } finally {
      setPendingProvider(null);
    }
  }, [completeLogin]);

  return { signInWithGoogle, signInWithApple, pendingProvider };
}

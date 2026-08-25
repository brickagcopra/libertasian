import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { apiClient } from '../../../lib/api-client';
import { useAuth } from '../../../providers/auth-provider';
import { getGoogleIosClientId, getGoogleWebClientId } from '../social-login-env';
import {
  errorMessage,
  reportSocialLoginFailure,
  reportSocialLoginUnavailable,
  type SocialLoginStage,
} from '../social-login-telemetry';
import type { AuthResponse } from '../types';

export type SocialProvider = 'google' | 'apple';

/**
 * `cancelled` = the user backed out of the native sheet — callers must treat
 * it as a silent no-op, never an error. `unavailable` = the build shipped
 * without the inlined Google client IDs, so nothing was attempted and
 * retrying cannot help. `failed` = anything else (native error, network, API
 * rejection); callers show ONE friendly message.
 */
export type SocialLoginOutcome = 'success' | 'cancelled' | 'unavailable' | 'failed';

/**
 * `code` is the native error code (Google's `10` = DEVELOPER_ERROR, Apple's
 * `ERR_*`). It is surfaced in the alert so a tester can read it back — until
 * now `unavailable` and every native failure produced byte-identical UI, which
 * is a large part of why this went undiagnosed for six weeks.
 */
export type SocialLoginResult =
  | { outcome: 'success' }
  | { outcome: 'cancelled' }
  | { outcome: 'unavailable' }
  | { outcome: 'failed'; code?: string };

/**
 * Whether native Google Sign-In can run in this build. Both client IDs are
 * baked in at build time via EXPO_PUBLIC_* env; when the build shipped
 * without them the Google button degrades to the "Coming soon" alert
 * instead of crashing into an unconfigured native module.
 */
export function googleUnavailableReason():
  | 'missing_web_client_id'
  | 'missing_ios_client_id'
  | null {
  if (!getGoogleWebClientId()) return 'missing_web_client_id';
  if (Platform.OS === 'ios' && !getGoogleIosClientId()) return 'missing_ios_client_id';
  return null;
}

export function isGoogleSignInAvailable(): boolean {
  return googleUnavailableReason() === null;
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

  const signInWithGoogle = useCallback(async (): Promise<SocialLoginResult> => {
    const unavailableReason = googleUnavailableReason();
    if (unavailableReason) {
      // The build shipped without EXPO_PUBLIC_GOOGLE_*. Report it as its own
      // event: nothing was attempted, and the fix is an EAS build-profile env
      // change rather than anything the user or the native SDK can do.
      reportSocialLoginUnavailable({ provider: 'google', reason: unavailableReason });
      return { outcome: 'unavailable' };
    }
    setPendingProvider('google');
    let cancelCode: string | undefined;
    // Advanced as the flow progresses so the catch below can say WHERE it
    // broke. Without it every failure looked alike in the logs.
    let stage: SocialLoginStage = 'configure';
    try {
      const { GoogleSignin, statusCodes } = requireGoogleSignin();
      cancelCode = String(statusCodes.SIGN_IN_CANCELLED);

      const iosClientId = getGoogleIosClientId();
      GoogleSignin.configure({
        webClientId: getGoogleWebClientId() as string,
        ...(iosClientId ? { iosClientId } : {}),
      });

      // Android only. google-signin's hasPlayServices returns `true`
      // immediately when Platform.OS === 'ios'
      // (lib/commonjs/signIn/GoogleSignin.js), so on iOS it was a no-op that
      // could not fail — and its only throw path there is the dev-mode guard
      // for a missing `showPlayServicesUpdateDialog`. Gate it to the platform
      // where it actually means something.
      if (Platform.OS === 'android') {
        stage = 'play_services';
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }

      stage = 'native_sign_in';
      const { cancelled, idToken } = extractGoogleSignInResult(await GoogleSignin.signIn());
      if (cancelled) return { outcome: 'cancelled' };
      if (!idToken) {
        reportSocialLoginFailure({
          provider: 'google',
          stage: 'id_token',
          message: 'no_id_token',
        });
        return { outcome: 'failed' };
      }

      stage = 'token_exchange';
      const response = await apiClient.post<AuthResponse>(
        '/auth/google/mobile',
        { idToken },
        { skipAuth: true },
      );
      await completeLogin(response);
      return { outcome: 'success' };
    } catch (err) {
      const code = errorCode(err);
      if (cancelCode !== undefined && code === cancelCode) return { outcome: 'cancelled' };
      reportSocialLoginFailure({
        provider: 'google',
        stage,
        code,
        message: errorMessage(err),
      });
      return { outcome: 'failed', ...(code ? { code } : {}) };
    } finally {
      setPendingProvider(null);
    }
  }, [completeLogin]);

  const signInWithApple = useCallback(async (): Promise<SocialLoginResult> => {
    setPendingProvider('apple');
    // Apple works today. The reporting is here so that if it ever stops
    // working we are not blind for six weeks the way Google was.
    let stage: SocialLoginStage = 'native_sign_in';
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        reportSocialLoginFailure({
          provider: 'apple',
          stage: 'id_token',
          message: 'no_identity_token',
        });
        return { outcome: 'failed' };
      }

      stage = 'token_exchange';
      const fullName = formatAppleFullName(credential.fullName);
      const response = await apiClient.post<AuthResponse>(
        '/auth/apple/mobile',
        { identityToken: credential.identityToken, ...(fullName ? { fullName } : {}) },
        { skipAuth: true },
      );
      await completeLogin(response);
      return { outcome: 'success' };
    } catch (err) {
      const code = errorCode(err);
      if (code === 'ERR_REQUEST_CANCELED') return { outcome: 'cancelled' };
      reportSocialLoginFailure({
        provider: 'apple',
        stage,
        code,
        message: errorMessage(err),
      });
      return { outcome: 'failed', ...(code ? { code } : {}) };
    } finally {
      setPendingProvider(null);
    }
  }, [completeLogin]);

  return { signInWithGoogle, signInWithApple, pendingProvider };
}

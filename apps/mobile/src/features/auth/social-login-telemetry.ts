import { Platform } from 'react-native';

import { mobileAnalytics } from '../../lib/analytics';
import { logger } from '../../lib/logger';

/**
 * Failure telemetry for native social sign-in.
 *
 * WHY THIS EXISTS: `logger.warn` is dev-only — lib/logger.ts returns early on
 * `!__DEV__`, so every social_login_failed warning in a release build went
 * nowhere. Mobile Google sign-in produced zero successful audit rows for six
 * weeks and zero diagnostics to explain it. These events are the release-build
 * channel; the logger calls stay for anyone watching Metro/adb.
 *
 * They go through `mobileAnalytics.trackPreAuth`, which posts to the
 * UNAUTHENTICATED POST /analytics/events. The login screen is pre-auth by
 * definition, so /analytics/events/auth (JwtAuthGuard) would 401 on exactly
 * the failures we are trying to see.
 *
 * NEVER pass an ID token, identity token, authorization code, access token,
 * email address, or any other credential material into these helpers. The
 * payload is persisted server-side. Only the fields below are sent, and the
 * native message is truncated.
 */

/** Which provider call was in flight. */
export type SocialProviderName = 'google' | 'apple';

/**
 * How far the flow got before it failed. This is the field that separates a
 * Google Cloud console misconfiguration from a server-side rejection:
 *
 * - `configure`      — GoogleSignin.configure() / module load threw. A missing
 *                      native module (OTA over a pre-social-login binary)
 *                      lands here.
 * - `play_services`  — hasPlayServices() rejected (Android only; see
 *                      use-social-login.ts for why iOS no longer calls it).
 * - `native_sign_in` — the native sheet rejected. DEVELOPER_ERROR (code 10)
 *                      lands here and means the OAuth client for this package
 *                      + signing certificate does not exist in the console.
 * - `id_token`       — the sheet returned success but carried no ID token.
 * - `token_exchange` — our own API rejected the token (audience mismatch,
 *                      network, 5xx).
 */
export type SocialLoginStage =
  | 'configure'
  | 'play_services'
  | 'native_sign_in'
  | 'id_token'
  | 'token_exchange';

/**
 * Native error strings are short, but they are attacker-influenced in the
 * general case and we persist them. Cap the length rather than trusting it.
 */
const MAX_MESSAGE_LENGTH = 180;

function truncateMessage(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…`
    : message;
}

/** Pull `message` off an unknown throwable without echoing the whole object. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return truncateMessage(err.message);
  if (typeof err === 'string') return truncateMessage(err);
  return 'unknown';
}

/**
 * A genuine on-device failure: report the stage and the native code so the
 * cause is recoverable from analytics alone.
 */
export function reportSocialLoginFailure(params: {
  provider: SocialProviderName;
  stage: SocialLoginStage;
  code?: string;
  message?: string;
}): void {
  const { provider, stage, code, message } = params;

  logger.warn('social_login_failed', { provider, stage, code, message });

  mobileAnalytics.trackPreAuth('social_login_failed', {
    provider,
    platform: Platform.OS,
    stage,
    code: code ?? 'none',
    message: message ?? 'none',
  });
}

/**
 * The build shipped without the inlined EXPO_PUBLIC_GOOGLE_* client IDs, so
 * nothing was ever attempted. Reported as its own event because the fix is a
 * build-profile env change, not a retry — and because until now this state
 * was indistinguishable from a real failure at the UI.
 *
 * `reason` names which precondition is missing, never the client ID values.
 */
export function reportSocialLoginUnavailable(params: {
  provider: SocialProviderName;
  reason: 'missing_web_client_id' | 'missing_ios_client_id';
}): void {
  const { provider, reason } = params;

  logger.warn('social_login_unavailable', { provider, reason });

  mobileAnalytics.trackPreAuth('social_login_unavailable', {
    provider,
    platform: Platform.OS,
    reason,
  });
}

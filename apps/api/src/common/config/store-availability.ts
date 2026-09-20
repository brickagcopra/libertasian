import type { ConfigService } from '@nestjs/config';

/**
 * The platforms a store purchase can be available on.
 *
 * Anything else — web, a missing header, a value we do not recognise — is not a
 * platform with an in-app store, and resolves to `false`.
 */
export type ClientPlatform = 'ios' | 'android';

/** Header the mobile client sends. Absent on web and on older builds. */
export const CLIENT_PLATFORM_HEADER = 'x-platform';

export function parseClientPlatform(value: unknown): ClientPlatform | null {
  const normalized = String(value ?? '').toLowerCase();
  return normalized === 'ios' || normalized === 'android' ? normalized : null;
}

/**
 * Whether a store purchase is available on `platform` (design D14, mechanism C).
 *
 * THE DEFAULT IS `false` AND MUST STAY THAT WAY, in both env vars and in this
 * function's fall-through. The whole point of the flag is that the first IAP
 * build ships behaving IDENTICALLY to the currently approved one, so it is safe
 * to submit while the store products are still in review. A default of `true`
 * would flip that on at deploy time, showing a purchase entry point for
 * products that do not exist yet — which is Guideline 3.1.1 in the other
 * direction, and reachable by omission with no review gate in front of it.
 *
 * PER PLATFORM, not global. An Android-approved / iOS-pending state is normal
 * during a rollout, and one flag would get it wrong for one of them.
 *
 * Flipping this is a deliberate act: set the variable for a platform ONLY once
 * that platform's store products are live and approved.
 */
export function isStorePurchaseAvailable(
  config: ConfigService,
  platform: ClientPlatform | null,
): boolean {
  if (platform === 'ios') {
    return config.get<boolean>('STORE_PURCHASE_AVAILABLE_IOS') === true;
  }
  if (platform === 'android') {
    return config.get<boolean>('STORE_PURCHASE_AVAILABLE_ANDROID') === true;
  }
  return false;
}

/** Header every HTTP client sends, and the only thing that separates the two headerless clients. */
export const USER_AGENT_HEADER = 'user-agent';

/**
 * Which client surface a request came from.
 *
 * A STRICT REFINEMENT OF `ClientPlatform`, not a replacement. `ClientPlatform`
 * answers "can this client buy from a store?" and must keep answering `null`
 * for everything headerless. `ClientSurface` answers the different question
 * "which client is this?", and its whole reason to exist is that
 * `ClientPlatform` cannot distinguish the two headerless callers:
 *
 *   - `legacy_app` — live App Store build 25 and every pre-#439 mobile build.
 *     Cut before `x-platform` existed, has NO purchase surface, told Apple
 *     there is no paid tier. MUST STAY UNGATED FOREVER.
 *   - `web` — a browser. Has no in-app store either, which is why it also
 *     resolves to a `null` platform and today reads the entire paid corpus for
 *     free.
 *
 * Both send no `x-platform` header, so no amount of header parsing can tell
 * them apart — which is why gating on `platform === null` is not an option.
 */
export type ClientSurface = 'ios' | 'android' | 'legacy_app' | 'web';

/**
 * User agents that mean "a native mobile app", i.e. `legacy_app` when no
 * `x-platform` header narrows it further.
 *
 *   - iOS sends `LIBERTASIAN/32 CFNetwork/3860.700.2 Darwin/25.6.0`
 *   - Android (OkHttp, via React Native's fetch) sends `okhttp/4.9.2`
 *
 * `CFNetwork` and `Darwin` are Apple's networking stack and kernel, emitted by
 * `URLSession` and never by a browser: Safari on iOS and Chrome on macOS both
 * send a `Mozilla/5.0 (…)` string containing neither token.
 *
 * DELIBERATELY OVER-BROAD IN THE UNGATED DIRECTION. A match means "do not
 * gate", so a false positive (some tool that also uses OkHttp) costs a free
 * read, while a false negative would gate a shipped binary that cannot buy —
 * the build-23 rejection. When in doubt this pattern should match.
 */
const NATIVE_APP_USER_AGENT = /LIBERTASIAN\/\d+|CFNetwork|Darwin|okhttp/i;

/**
 * Resolve the surface a request came from, from its headers alone.
 *
 * THE HEADER WINS WHEN IT PARSES. A build new enough to send `x-platform` has
 * told us exactly what it is; its user agent cannot overrule that, or an iOS
 * build 26 that can buy would be demoted to `legacy_app` by its own CFNetwork
 * UA and never gated.
 *
 * THE FALLBACK DEFAULTS TO `'web'`, NOT `'legacy_app'`, and must stay that way.
 * `web` is the only value this function returns that is ever gated (and only
 * when `PAYWALL_ENFORCED_WEB` is explicitly on), so the default direction is
 * "possibly gated" for anything we cannot positively identify as a native app.
 * Defaulting an unknown UA to `legacy_app` would hand a permanent, unfixable
 * bypass to any client that simply omits its User-Agent — which is precisely
 * what a scraper does.
 */
export function resolveClientSurface(headers: unknown): ClientSurface {
  const bag =
    headers !== null && typeof headers === 'object'
      ? (headers as Record<string, unknown>)
      : {};

  const platform = parseClientPlatform(bag[CLIENT_PLATFORM_HEADER]);
  if (platform !== null) {
    return platform;
  }

  // Node types a repeated header as `string[]`; join rather than index so a
  // duplicated User-Agent cannot hide the token we are looking for.
  const raw = bag[USER_AGENT_HEADER];
  const userAgent = Array.isArray(raw) ? raw.join(' ') : String(raw ?? '');

  return NATIVE_APP_USER_AGENT.test(userAgent) ? 'legacy_app' : 'web';
}

import type { ConfigService } from '@nestjs/config';

import {
  isStorePurchaseAvailable,
  type ClientPlatform,
} from './store-availability';

/**
 * Read the PAYWALL_ENFORCED kill switch.
 *
 * Joi coerces the env var to a real boolean, but @nestjs/config also writes
 * validated values back into `process.env` (where everything is a string), so
 * the value reaching us is `boolean | string` depending on how the config was
 * loaded. Both spellings of "off" are honoured; anything else — including the
 * var being absent — means enforced, so a typo can never silently open the
 * paid surface.
 */
export function isPaywallEnforced(config: ConfigService): boolean {
  const raw = config.get<boolean | string>('PAYWALL_ENFORCED');
  return raw !== false && raw !== 'false';
}

/**
 * Whether the paywall is enforced for ONE request, given the platform that
 * request came from.
 *
 *     enforced = isPaywallEnforced(config)                       // global master
 *             || isStorePurchaseAvailable(config, platform)      // per platform
 *
 * THE RULE IN ONE SENTENCE: only gate a client that can actually buy.
 *
 * A 402/403 is only fair if the user has a way to clear it. `PAYWALL_ENFORCED`
 * alone cannot express that, because it is global while purchasability is
 * per-platform: the App Store build may be sellable while the Play build is
 * still pending, or the reverse. Flipping one global switch necessarily gets it
 * wrong for one of them, and getting it wrong in the "gate a client that cannot
 * buy" direction is what caused the build-23 rejection.
 *
 * WHY THE ABSENCE OF THE HEADER IS LOAD-BEARING — do not "fix" this by
 * defaulting the platform to anything:
 *
 *   App Store build 25 is live, has NO purchase surface, and its review notes
 *   tell Apple there is no paid tier. It was cut 2026-08-25 and the
 *   `x-platform` header only landed 2026-08-29 (#439), so build 25 sends NO
 *   header at all. That absence parses to `null`, `isStorePurchaseAvailable`
 *   returns `false` for `null`, and those users are therefore NEVER enforced —
 *   no matter what `STORE_PURCHASE_AVAILABLE_IOS` is set to. The missing header
 *   is the only thing separating a shipped binary that cannot buy from one that
 *   can, and it is what lets us turn iOS purchasing on for build 26 without
 *   retroactively gating build 25.
 *
 *   Web sends no header either, so it resolves to `null` and is likewise
 *   untouched.
 *
 * `isPaywallEnforced` remains the global master and still wins on its own: set
 * `PAYWALL_ENFORCED=true` and every caller is enforced regardless of platform,
 * which is the legacy behaviour and the escape hatch if this per-platform model
 * ever needs to be bypassed wholesale.
 *
 * A `null` platform means "no platform with an in-app store" — web, an absent
 * header, or an unrecognised value. It is the safe default and every caller
 * that has no request context must pass it.
 */
export function isPaywallEnforcedForRequest(
  config: ConfigService,
  platform: ClientPlatform | null,
): boolean {
  return isPaywallEnforced(config) || isStorePurchaseAvailable(config, platform);
}

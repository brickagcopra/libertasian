import type { ConfigService } from '@nestjs/config';

import {
  isStorePurchaseAvailable,
  type ClientPlatform,
  type ClientSurface,
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
 * Read the `PAYWALL_ENFORCED_WEB` switch — browsers only.
 *
 * STRICT `=== true`, UNLIKE `isPaywallEnforced`. The two switches are not
 * spelled the same way because they fail in opposite directions. The master
 * switch treats a malformed value as ON so a typo cannot silently open the paid
 * surface; this one treats anything but a real boolean `true` as OFF so a typo
 * cannot silently gate a surface that has no purchase flow. A browser cannot
 * buy through an in-app store, so the failure it must never have is the one
 * where it starts refusing reads by accident.
 *
 * The `=== true` comparison is also why `PAYWALL_ENFORCED_WEB` MUST be in the
 * Joi schema in `app.module.ts`: only the validated env-var path coerces
 * `'true'` to a boolean. A var absent from the schema arrives as the STRING
 * `'true'`, fails `=== true`, and the flag is inert with nothing in the logs
 * to say so.
 */
export function isWebPaywallEnforced(config: ConfigService): boolean {
  return config.get<boolean | string>('PAYWALL_ENFORCED_WEB') === true;
}

/**
 * Whether the paywall is enforced for ONE request, given the platform that
 * request came from and the client surface that issued it.
 *
 * SURFACE STATE AS OF 2026-09-20: iOS ships build 32 with four approved IAPs
 * and is the only live payment rail; Android's Play billing is pending a
 * payments profile; web has no gateway (Xendit declined the merchant
 * activation). Read every "can this client buy" claim below against that.
 *
 *     enforced = isPaywallEnforced(config)                       // global master
 *             || isStorePurchaseAvailable(config, platform)      // per platform
 *             || (surface === 'web' && isWebPaywallEnforced())   // browsers
 *
 * THE RULE IN ONE SENTENCE: only gate a client that can actually buy.
 *
 * A 402/403 is only fair if the user has a way to clear it. `PAYWALL_ENFORCED`
 * alone cannot express that, because it is global while purchasability is
 * per-platform — and as of 2026-09-20 the three surfaces are in three different
 * states:
 *
 *   iOS      1.0.2 (build 32) has been on the App Store since 2026-09-14 with
 *            four approved, purchasable StoreKit IAPs. iOS CAN take money.
 *   Android  Play billing is off; the Google payments profile is still pending.
 *   Web      no gateway at all — Xendit rejected the merchant activation.
 *
 *   THIS IS WHY THE GLOBAL SWITCH STAYS OFF, and the reason is no longer an App
 *   Review one: flipping `PAYWALL_ENFORCED=true` would gate Android and web
 *   alongside iOS, handing those users a 402/403 with no rail to clear it on.
 *   Getting it wrong in that "gate a client that cannot buy" direction is what
 *   caused the build-23 rejection.
 *
 * WHY THE ABSENCE OF THE HEADER IS LOAD-BEARING — do not "fix" this by
 * defaulting the platform to anything:
 *
 *   App Store build 25 was the binary approved 2026-08-28, on review notes that
 *   said at the time there was no paid tier. It is no longer what the App Store
 *   serves — build 32 superseded it on 2026-09-14, and Apple has since reviewed
 *   and approved a paid tier on iOS. What build 25 still is, is a LEGACY
 *   INSTALL BASE: copies on devices that never updated, carrying no purchase
 *   surface. It was cut 2026-08-25 and the `x-platform` header only landed
 *   2026-08-29 (#439), so it sends NO header at all. That absence parses to
 *   `null`, `isStorePurchaseAvailable` returns `false` for `null`, and those
 *   users are therefore NEVER enforced — no matter what
 *   `STORE_PURCHASE_AVAILABLE_IOS` is set to. The missing header is the only
 *   thing separating a stale install that cannot buy from a current one that
 *   can, and it is what let us turn iOS purchasing on without retroactively
 *   gating whoever had not updated.
 *
 *   THIS GUARD IS NOW DEFENSIVE, AND IS KEPT ANYWAY. Seven days of prod nginx
 *   logs to 2026-09-20 show 249 of 249 iOS app requests carrying
 *   `LIBERTASIAN/32` — the header-less population measures empty. Keep it: the
 *   cost is a branch that never fires, and the failure it prevents is charging
 *   a user who has no way to pay.
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
 *
 * THE WEB TERM, AND WHY IT IS KEYED ON THE SURFACE AND NOT ON `platform`:
 *
 *   Everything above is about clients that CAN buy. A browser cannot, so by the
 *   rule above it would never be gated — and indeed it is not today, which is
 *   how a signed-in free account reads the whole paid corpus from a browser.
 *   `web` is therefore gated ONLY behind its own explicit switch.
 *
 *   AND THAT SWITCH IS NOT READY TO FLIP. Web has no payment gateway — Xendit
 *   declined the merchant activation — so as of 2026-09-20 turning
 *   `PAYWALL_ENFORCED_WEB` on would gate a surface with no route out, which is
 *   the same mistake in a smaller blast radius. The term exists so the gate is
 *   in place the day a rail is; it does not mean the gate is due.
 *
 *   It cannot key on `platform === null`, because `null` is ALSO what the
 *   legacy header-less install base resolves to — those builds predate
 *   `x-platform` and send no header. Gating on `null` would gate them along
 *   with the browser, which is exactly the build-23 rejection.
 *   `ClientSurface` exists to split those two apart by User-Agent; see
 *   `resolveClientSurface`.
 *
 * `surface` DEFAULTS TO `null` — "no surface", i.e. never web-enforced. That is
 * the value every caller outside an HTTP request has: BullMQ workers, `@Cron`
 * sweeps, seeds and scripts resolve entitlements with no headers to read, and
 * none of them has a user waiting on a paywall. Same reasoning as the `null`
 * platform.
 */
export function isPaywallEnforcedForRequest(
  config: ConfigService,
  platform: ClientPlatform | null,
  surface: ClientSurface | null = null,
): boolean {
  return (
    isPaywallEnforced(config) ||
    isStorePurchaseAvailable(config, platform) ||
    (surface === 'web' && isWebPaywallEnforced(config))
  );
}

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

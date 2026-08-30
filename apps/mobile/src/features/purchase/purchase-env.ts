import { Platform } from 'react-native';

/**
 * The RevenueCat PUBLIC SDK keys, one per platform.
 *
 * These are publishable keys — they identify the app to RevenueCat and are
 * meant to ship in the binary. The SECRET key (`REVENUECAT_API_KEY`) lives only
 * on the server, where it backs the §9 reconciliation pull; it must never
 * appear in this app.
 *
 * `EXPO_PUBLIC_*` vars are INLINED by babel-preset-expo at bundle time. They
 * only work as static `process.env[...]` member expressions with a literal key,
 * and their values are baked into the build — set them in the EAS build profile
 * env, and expect to need a native build, because OTA cannot change them.
 * Isolated in this module for the same reason `social-login-env.ts` exists:
 * tests mock these getters, since mutating `process.env` at runtime has no
 * effect on an inlined read.
 */
export function getRevenueCatIosKey(): string | undefined {
  return process.env['EXPO_PUBLIC_REVENUECAT_IOS_KEY'];
}

export function getRevenueCatAndroidKey(): string | undefined {
  return process.env['EXPO_PUBLIC_REVENUECAT_ANDROID_KEY'];
}

/**
 * The key for the platform we are running on, or `undefined`.
 *
 * `undefined` is the normal state today: no RevenueCat project is configured
 * yet. Every caller must treat it as "the store is unavailable", never as an
 * error to report — see `PurchaseSurfaceStatus`.
 */
export function getRevenueCatKey(): string | undefined {
  if (Platform.OS === 'ios') return getRevenueCatIosKey();
  if (Platform.OS === 'android') return getRevenueCatAndroidKey();
  // Web and anything else: there is no store to purchase through.
  return undefined;
}

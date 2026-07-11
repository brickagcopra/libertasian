/**
 * EXPO_PUBLIC_* vars are INLINED by babel-preset-expo at bundle time — they
 * only work as static `process.env[...]` member expressions with a literal
 * key, and their values are baked into the build (set them in the EAS build
 * profile env; a native build is required, OTA cannot change them). Isolated
 * in this module so tests can mock the getters — mutating process.env at
 * runtime has no effect on inlined reads.
 */
export function getGoogleWebClientId(): string | undefined {
  return process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'];
}

export function getGoogleIosClientId(): string | undefined {
  return process.env['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'];
}

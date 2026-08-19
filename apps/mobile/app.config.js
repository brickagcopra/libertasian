/**
 * Dynamic Expo config layered on top of app.json (Expo loads app.json first and
 * passes it in as `config`). Carries the two plugins that cannot live in static
 * JSON: Google Sign-In, whose `iosUrlScheme` (the reversed iOS OAuth client ID)
 * comes from the environment, and our local `withAndroid16Compat`, which is a
 * function rather than a published module name.
 *
 * EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must be set at prebuild/EAS-build time for
 * native Google Sign-In on iOS. When absent, the plugin is skipped entirely —
 * the build still succeeds and the JS layer degrades the Google button to the
 * "Coming soon" alert (see use-social-login.ts).
 */

/**
 * Android 16 (API 36) compatibility overrides that pair with the
 * compileSdk/targetSdk 36 bump in app.json's expo-build-properties entry: the
 * AGP 8.6.0 compileSdk suppression and the large-screen resizability opt-out.
 * Registered here because it is a local plugin function, not a module name
 * resolvable from app.json. See plugins/withAndroid16Compat.js for why each
 * override exists and when to remove it.
 */
const withAndroid16Compat = require('./plugins/withAndroid16Compat');

/** `1234-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.1234-abc` */
function reversedGoogleClientId(clientId) {
  const suffix = '.apps.googleusercontent.com';
  if (!clientId || !clientId.endsWith(suffix)) return null;
  return `com.googleusercontent.apps.${clientId.slice(0, -suffix.length)}`;
}

module.exports = ({ config }) => {
  const iosUrlScheme = reversedGoogleClientId(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ...(iosUrlScheme
        ? [['@react-native-google-signin/google-signin', { iosUrlScheme }]]
        : []),
      withAndroid16Compat,
    ],
  };
};

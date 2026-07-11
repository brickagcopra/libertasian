/**
 * Dynamic Expo config layered on top of app.json (Expo loads app.json first and
 * passes it in as `config`). Exists ONLY to inject the Google Sign-In config
 * plugin, whose `iosUrlScheme` (the reversed iOS OAuth client ID) comes from
 * the environment and therefore cannot live in static JSON.
 *
 * EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must be set at prebuild/EAS-build time for
 * native Google Sign-In on iOS. When absent, the plugin is skipped entirely —
 * the build still succeeds and the JS layer degrades the Google button to the
 * "Coming soon" alert (see use-social-login.ts).
 */

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
    ],
  };
};

/**
 * Config plugin: the two Android 16 (API 36) compatibility knobs that
 * `expo-build-properties` cannot express.
 *
 * Google Play requires every app to target API 36 by 2026-08-30, so app.json
 * bumps compileSdk/targetSdk to 36. We are deliberately staying on Expo SDK 52
 * (RN 0.76.9) rather than upgrading the SDK, which means the toolchain and the
 * runtime each need one manual override. Both live here so there is a single
 * place to delete them when the app eventually moves to Expo SDK 54+.
 */

const { withGradleProperties, withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

/**
 * `android.suppressUnsupportedCompileSdk=36`
 *
 * RN 0.76.9 pins AGP 8.6.0, whose highest *tested* compileSdk is 34. Given a
 * compileSdk it does not recognise, AGP does not warn — it fails the build with
 * "We recommend using a newer Android Gradle plugin". This property downgrades
 * that hard failure back to a warning for the one SDK level we name.
 *
 * It is a suppression, not a fix: AGP 8.6.0 genuinely has not been validated
 * against the API 36 platform jar. The real fix is an AGP bump, which on a
 * managed/prebuild app means an Expo SDK upgrade (SDK 54 ships AGP 8.8+). That
 * is a separate project; this keeps us shippable before the Play deadline.
 */
const SUPPRESS_UNSUPPORTED_COMPILE_SDK = 'android.suppressUnsupportedCompileSdk';

/**
 * `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`
 *
 * Android 16 ignores an app's orientation, resizability and aspect-ratio
 * restrictions on any display at least sw600dp — tablets, and foldables when
 * unfolded. app.json sets `"orientation": "portrait"`, and every screen in this
 * app is laid out for a portrait phone (iOS is `supportsTablet: false` for the
 * same reason), so without this opt-out a tablet would silently get a stretched
 * landscape layout nobody has designed or QA'd.
 *
 * Verified against developer.android.com/about/versions/16/behavior-changes-16
 * rather than recalled: the property name and the `<application>`-level
 * placement are both taken from that page.
 *
 * The opt-out is explicitly TEMPORARY. Google's docs state it stops applying
 * once the app targets API 37, at which point the restrictions are ignored on
 * sw600dp displays regardless of this flag. Treat the next targetSdk bump as
 * the deadline for actually making the large-screen layouts adaptive.
 */
const ALLOW_RESTRICTED_RESIZABILITY = 'android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY';

/** Sets `key=value` in gradle.properties, replacing any existing entry for `key`. */
function setGradleProperty(gradleProperties, key, value) {
  const existing = gradleProperties.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
    return gradleProperties;
  }
  gradleProperties.push({ type: 'property', key, value });
  return gradleProperties;
}

/** Sets a `<property>` on `<application>`, replacing any existing one of the same name. */
function setApplicationProperty(application, name, value) {
  const properties = (application.property ?? []).filter(
    (item) => item.$?.['android:name'] !== name,
  );
  properties.push({ $: { 'android:name': name, 'android:value': value } });
  application.property = properties;
}

const withAndroid16Compat = (config) => {
  config = withGradleProperties(config, (cfg) => {
    cfg.modResults = setGradleProperty(
      cfg.modResults,
      SUPPRESS_UNSUPPORTED_COMPILE_SDK,
      '36',
    );
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    setApplicationProperty(application, ALLOW_RESTRICTED_RESIZABILITY, 'true');
    return cfg;
  });

  return config;
};

module.exports = withAndroid16Compat;

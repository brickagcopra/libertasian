const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Expo Router uses require.context() to discover all route files in src/app/.
// blockList prevents resolution but require.context still discovers the files,
// causing runtime crashes. Instead, resolve test files to empty modules so
// they exist in the route map but contain no code.
const testFilePattern = /\.test\.[jt]sx?$|\.spec\.[jt]sx?$|__tests__/;

// Bypass @expo/metro-runtime error overlay bug that crashes with
// "Objects are not valid as a React child" on SDK 52 / RN 0.76.
// https://github.com/expo/expo/issues/33585
const errorOverlayShim = path.resolve(__dirname, 'src/lib/error-overlay-shim.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (testFilePattern.test(moduleName)) {
    return { type: 'empty' };
  }
  if (moduleName === '@expo/metro-runtime/error-overlay') {
    return { type: 'sourceFile', filePath: errorOverlayShim };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Expo Router uses require.context() to discover all route files in src/app/.
// blockList prevents resolution but require.context still discovers the files,
// causing runtime crashes. Instead, resolve test files to empty modules so
// they exist in the route map but contain no code.
const testFilePattern = /\.test\.[jt]sx?$|\.spec\.[jt]sx?$|__tests__/;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (testFilePattern.test(moduleName)) {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });

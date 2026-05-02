const { withGradleProperties, withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withAndroidArchs(config) {
  config = withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const upsert = (key, value) => {
      const idx = props.findIndex((p) => p.type === 'property' && p.key === key);
      const entry = { type: 'property', key, value };
      if (idx >= 0) props[idx] = entry;
      else props.push(entry);
    };
    upsert('reactNativeArchitectures', 'arm64-v8a');
    upsert('android.injected.build.abi', 'arm64-v8a');
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!/ndk\s*\{[^}]*abiFilters/.test(contents)) {
      contents = contents.replace(
        /(defaultConfig\s*\{)/,
        '$1\n        ndk {\n            abiFilters "arm64-v8a"\n        }',
      );
      cfg.modResults.contents = contents;
    }
    return cfg;
  });

  return config;
};

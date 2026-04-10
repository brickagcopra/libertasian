// Shim to bypass @expo/metro-runtime error overlay bug
// https://github.com/expo/expo/issues/33585
exports.withErrorOverlay = function withErrorOverlay(Comp) {
  return Comp;
};

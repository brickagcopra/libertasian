import type { EdgeInsets } from 'react-native-safe-area-context';

/**
 * Safe-area padding helpers.
 *
 * `app.json` targets compileSdk/targetSdk 35, which forces edge-to-edge on
 * Android 15+: the app draws under the status and navigation bars, so any
 * screen with a hardcoded `paddingTop` has its header clipped by the status
 * bar. Measured on an API 36 emulator, `useSafeAreaInsets().top` is 54.1 —
 * more than some of the fixed values these screens used.
 *
 * The formula is `max(designPadding, inset)`, NOT `inset + designPadding`:
 *
 * - The fixed values already measured from the TOP OF THE SCREEN, not from
 *   below the status bar. Adding the inset to them would push every screen
 *   down by a full status-bar height on both platforms — a visible iOS
 *   regression, which this PR must not cause.
 * - Taking the max keeps iOS byte-identical wherever the design value already
 *   cleared the inset (every screen here is 56+ except SearchScreen's 54, and
 *   no iPhone reports a top inset above ~62), while guaranteeing content never
 *   sits under a system bar on any device.
 * - Where the design value did NOT clear the inset, the result is a small
 *   downward correction. That is the bug being fixed, not a regression.
 *
 * Keep using these two functions rather than inlining `Math.max`: one place to
 * change if the rule ever needs to become device-aware.
 */

/** Top padding that respects the status bar / notch without shrinking the design. */
export function topInsetPadding(insets: EdgeInsets, designPadding: number): number {
  return Math.max(designPadding, insets.top);
}

/**
 * Bottom padding that respects the gesture/navigation bar.
 *
 * Under targetSdk 34 the bottom inset reads 0 (the system still reserves the
 * nav bar), so this is a no-op today and starts mattering the moment the
 * targetSdk 35 build ships. Screens with a fixed footer, tab bar, or player
 * bar need it or their last control sits under the gesture pill.
 */
export function bottomInsetPadding(insets: EdgeInsets, designPadding: number): number {
  return Math.max(designPadding, insets.bottom);
}

/**
 * Bottom padding for a screen whose design spacing sits ABOVE a floating bar
 * (tab bar, audio player). The bar itself is what must clear the gesture
 * inset, so the scroll content needs both: the design's clearance plus the
 * inset the bar was pushed up by.
 */
export function bottomInsetPaddingStacked(
  insets: EdgeInsets,
  designPadding: number,
): number {
  return designPadding + insets.bottom;
}

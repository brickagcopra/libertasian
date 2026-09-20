import { resolveClientSurface } from './store-availability';

/**
 * `resolveClientSurface` exists to answer the one question `parseClientPlatform`
 * cannot: a browser and live App Store build 25 BOTH send no `x-platform`
 * header, so both resolve to a `null` platform, and gating on that `null` would
 * gate build 25 — a shipped binary with no purchase surface — along with the
 * browser. That is the build-23 rejection.
 *
 * The User-Agent is the only thing that separates them:
 *
 *   iOS      LIBERTASIAN/32 CFNetwork/3860.700.2 Darwin/25.6.0
 *   Android  okhttp/4.9.2
 *   Browser  Mozilla/5.0 (...) — neither token
 *
 * Every assertion below is therefore about one of two failure directions:
 * calling a native app `web` (gates a client that cannot buy), or calling a
 * browser `legacy_app` (a free-corpus bypass that no flag can close).
 */
describe('resolveClientSurface', () => {
  const CHROME_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const IOS_APP_UA = 'LIBERTASIAN/25 CFNetwork/3860.700.2 Darwin/25.6.0';
  const ANDROID_APP_UA = 'okhttp/4.9.2';

  // ---- the header wins whenever it parses ----

  it('takes the x-platform header over the User-Agent — app UA, header says ios', () => {
    // Build 26 sends BOTH. If the UA were allowed to win, its own CFNetwork
    // string would demote a purchase-capable build to `legacy_app` and it would
    // never be gated, which is the whole point of shipping the header.
    expect(
      resolveClientSurface({
        'x-platform': 'ios',
        'user-agent': IOS_APP_UA,
      }),
    ).toBe('ios');
  });

  it('takes the x-platform header over the User-Agent — browser UA, header says android', () => {
    // The other direction: a declared platform is not overruled by a UA that
    // looks like a browser. The header is a first-party claim from our own
    // client; the UA is a heuristic used only when there is no claim.
    expect(
      resolveClientSurface({
        'x-platform': 'android',
        'user-agent': CHROME_UA,
      }),
    ).toBe('android');
  });

  it('falls through to the User-Agent when the header is present but unrecognised', () => {
    // `parseClientPlatform` returns null for anything that is not ios/android,
    // and null means "no claim", not "web".
    expect(
      resolveClientSurface({
        'x-platform': 'windows',
        'user-agent': IOS_APP_UA,
      }),
    ).toBe('legacy_app');
  });

  it('normalises header case, via the shared parser', () => {
    expect(resolveClientSurface({ 'x-platform': 'iOS' })).toBe('ios');
  });

  // ---- headerless native apps: legacy_app, never gated ----

  it('reads a headerless iOS app UA as legacy_app — PROTECTS LIVE BUILD 25', () => {
    // The exact shape build 25 sends. If this ever returns 'web', turning on
    // PAYWALL_ENFORCED_WEB would start refusing reads to every installed copy
    // of an already-approved binary that has no way to buy anything.
    expect(resolveClientSurface({ 'user-agent': IOS_APP_UA })).toBe(
      'legacy_app',
    );
  });

  it('reads a headerless Android app UA as legacy_app', () => {
    expect(resolveClientSurface({ 'user-agent': ANDROID_APP_UA })).toBe(
      'legacy_app',
    );
  });

  it('matches any of the four native tokens on its own', () => {
    // Each token is independently sufficient: the UA string is assembled by
    // the platform and its exact composition changes between OS releases.
    for (const ua of [
      'LIBERTASIAN/32',
      'CFNetwork/3860.700.2',
      'Darwin/25.6.0',
      'okhttp/4.12.0',
    ]) {
      expect(resolveClientSurface({ 'user-agent': ua })).toBe('legacy_app');
    }
  });

  it('is case-insensitive about the native tokens', () => {
    expect(resolveClientSurface({ 'user-agent': 'OkHttp/4.9.2' })).toBe(
      'legacy_app',
    );
  });

  it('reads a repeated User-Agent header without losing the token', () => {
    // Node types a repeated header as string[]. Indexing [0] would miss a
    // token that arrived in the second copy.
    expect(
      resolveClientSurface({ 'user-agent': [CHROME_UA, ANDROID_APP_UA] }),
    ).toBe('legacy_app');
  });

  // ---- everything else: web ----

  it('reads a Chrome UA as web', () => {
    expect(resolveClientSurface({ 'user-agent': CHROME_UA })).toBe('web');
  });

  it('reads Safari on macOS as web, despite Apple hardware in the UA', () => {
    // 'Macintosh' and 'Mac OS X' must NOT match: a desktop browser is the main
    // client this whole change exists to reach.
    expect(
      resolveClientSurface({
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
      }),
    ).toBe('web');
  });

  it('reads Safari on iOS as web — a phone browser is still a browser', () => {
    expect(
      resolveClientSurface({
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
      }),
    ).toBe('web');
  });

  it('reads an EMPTY User-Agent as web, not legacy_app', () => {
    // The load-bearing default. Defaulting an unidentifiable client to
    // `legacy_app` would hand a permanent bypass to anything that simply omits
    // its User-Agent — which is exactly what a scraper does.
    expect(resolveClientSurface({ 'user-agent': '' })).toBe('web');
  });

  it('reads a missing User-Agent as web', () => {
    expect(resolveClientSurface({})).toBe('web');
  });

  it('does not throw on an unexpected request shape', () => {
    // Called from a guard and from middleware, neither of which may throw a
    // TypeError on a request it did not expect.
    expect(resolveClientSurface(undefined)).toBe('web');
    expect(resolveClientSurface(null)).toBe('web');
    expect(resolveClientSurface('not-a-header-bag')).toBe('web');
  });
});

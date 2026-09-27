import { beforeEach, describe, it, expect, vi } from 'vitest';

import {
  OAUTH_RETURN_KEY,
  isSafeReturnPath,
  loginHref,
  resolveSafeRedirect,
  stashOAuthReturnPath,
  takeOAuthReturnPath,
} from './safe-redirect';

describe('resolveSafeRedirect', () => {
  const FALLBACK = '/search';

  it('accepts safe same-origin app paths', () => {
    expect(resolveSafeRedirect('/scans', FALLBACK)).toBe('/scans');
    expect(resolveSafeRedirect('/study?x=1', FALLBACK)).toBe('/study?x=1');
  });

  it('rejects open-redirect attempts and falls back', () => {
    expect(resolveSafeRedirect('//evil.com', FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeRedirect('/\\evil.com', FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeRedirect('https://evil.com', FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeRedirect('javascript:alert(1)', FALLBACK)).toBe(FALLBACK);
  });

  it('falls back on empty / missing values', () => {
    expect(resolveSafeRedirect(null, FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeRedirect(undefined, FALLBACK)).toBe(FALLBACK);
    expect(resolveSafeRedirect('', FALLBACK)).toBe(FALLBACK);
  });

  it('passes the billing checkout deep link through unchanged (plan + coupon)', () => {
    // The pricing → register → verify → login flow hands this exact shape to
    // ?from= so the post-auth redirect reaches checkout with intent intact.
    expect(
      resolveSafeRedirect('/settings/billing?plan=pro&coupon=SAVE20', FALLBACK),
    ).toBe('/settings/billing?plan=pro&coupon=SAVE20');
  });

  it('rejects a checkout-lookalike absolute URL on another origin', () => {
    expect(
      resolveSafeRedirect('https://evil.com/settings/billing?plan=pro', FALLBACK),
    ).toBe(FALLBACK);
  });

  it('preserves path + query exactly (Deep Research ?q=)', () => {
    expect(resolveSafeRedirect('/research?q=doctrine%20of%20estoppel', FALLBACK)).toBe(
      '/research?q=doctrine%20of%20estoppel',
    );
    expect(resolveSafeRedirect('/research?q=a%26b%3Dc&x=1#frag', FALLBACK)).toBe(
      '/research?q=a%26b%3Dc&x=1#frag',
    );
    // An encoded `%` in the QUERY is legitimate and must not trip decoding.
    expect(resolveSafeRedirect('/search?q=100%25', FALLBACK)).toBe('/search?q=100%25');
    // A `//` or backslash later in the query is just data.
    expect(resolveSafeRedirect('/research?q=https://x.y/a\\b', FALLBACK)).toBe(
      '/research?q=https://x.y/a\\b',
    );
  });

  it.each([
    ['protocol-relative', '//evil.com/research?q=x'],
    ['backslash', '/\\evil.com'],
    ['absolute http', 'http://evil.com'],
    ['uppercase scheme', 'JAVASCRIPT:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['no leading slash', 'evil.com/path'],
    ['tab smuggled //', '/\t/evil.com'],
    ['newline', '/search\nSet-Cookie: x'],
    ['encoded //', '/%2F%2Fevil.com'],
    ['encoded // lower', '/%2f/evil.com'],
    ['encoded backslash', '/%5Cevil.com'],
    ['encoded tab', '/%09/evil.com'],
    ['double-encoded //', '/%252F%252Fevil.com'],
    ['double-encoded backslash', '/%255Cevil.com'],
    ['leading-encoded slash', '%2F%2Fevil.com'],
    ['encoded javascript', '%6Aavascript:alert(1)'],
    ['malformed escape in path', '/%E0%A4%A'],
    ['whitespace-prefixed', ' //evil.com'],
  ])('rejects %s (%s)', (_label, value) => {
    expect(resolveSafeRedirect(value, FALLBACK)).toBe(FALLBACK);
    expect(isSafeReturnPath(value)).toBe(false);
  });

  it('rejects an absurdly long value', () => {
    expect(resolveSafeRedirect(`/${'a'.repeat(3000)}`, FALLBACK)).toBe(FALLBACK);
  });
});

describe('loginHref', () => {
  it('carries a safe path + query as ?from=', () => {
    expect(loginHref('/research?q=estoppel')).toBe(
      `/login?from=${encodeURIComponent('/research?q=estoppel')}`,
    );
    expect(new URLSearchParams(loginHref('/research?q=a&b=c').split('?')[1]).get('from')).toBe(
      '/research?q=a&b=c',
    );
  });

  it('is plain /login for unsafe, empty, root or login targets', () => {
    expect(loginHref('//evil.com')).toBe('/login');
    expect(loginHref('/%2F%2Fevil.com')).toBe('/login');
    expect(loginHref(null)).toBe('/login');
    expect(loginHref('')).toBe('/login');
    expect(loginHref('/')).toBe('/login');
    expect(loginHref('/login?from=%2Fsearch')).toBe('/login');
  });
});

describe('OAuth return path (sessionStorage round trip)', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('stashes a safe path and hands it back once', () => {
    stashOAuthReturnPath('/research?q=estoppel');
    expect(window.sessionStorage.getItem(OAUTH_RETURN_KEY)).toBe('/research?q=estoppel');
    expect(takeOAuthReturnPath()).toBe('/research?q=estoppel');
    expect(takeOAuthReturnPath()).toBeNull();
  });

  it('does not stash an unsafe path, and clears a stale one', () => {
    stashOAuthReturnPath('/digests');
    stashOAuthReturnPath('//evil.com');
    expect(window.sessionStorage.getItem(OAUTH_RETURN_KEY)).toBeNull();
    expect(takeOAuthReturnPath()).toBeNull();
  });

  it('re-validates on read (storage is writable by page script)', () => {
    window.sessionStorage.setItem(OAUTH_RETURN_KEY, 'https://evil.com');
    expect(takeOAuthReturnPath()).toBeNull();
    expect(window.sessionStorage.getItem(OAUTH_RETURN_KEY)).toBeNull();
  });

  it('fails soft when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(takeOAuthReturnPath()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

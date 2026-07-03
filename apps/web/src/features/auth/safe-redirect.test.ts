import { describe, it, expect } from 'vitest';

import { resolveSafeRedirect } from './safe-redirect';

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
});

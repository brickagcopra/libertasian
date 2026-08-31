import type { Request, Response } from 'express';

import { getRequestPlatform } from '../context/request-context';
import { RequestPlatformMiddleware } from './request-platform.middleware';

describe('RequestPlatformMiddleware', () => {
  const middleware = new RequestPlatformMiddleware();

  /** Run the middleware over a header bag and report what downstream sees. */
  const platformSeenBy = (headers: unknown): unknown => {
    let seen: unknown = 'next-never-called';
    middleware.use(
      { headers } as unknown as Request,
      {} as Response,
      () => {
        seen = getRequestPlatform();
      },
    );
    return seen;
  };

  it('makes the parsed platform visible to downstream handlers', () => {
    expect(platformSeenBy({ 'x-platform': 'ios' })).toBe('ios');
    expect(platformSeenBy({ 'x-platform': 'android' })).toBe('android');
  });

  it('resolves an absent header to null — PROTECTS LIVE BUILD 25', () => {
    // Build 25 predates the header entirely. Its requests must arrive with no
    // platform, which means not enforced.
    expect(platformSeenBy({})).toBeNull();
  });

  it('resolves an unrecognised value to null', () => {
    expect(platformSeenBy({ 'x-platform': 'windows' })).toBeNull();
    expect(platformSeenBy({ 'x-platform': '' })).toBeNull();
  });

  it('normalises case, via the shared parser', () => {
    // Behaviour comes from `parseClientPlatform`, not from this middleware —
    // asserted here only to prove the middleware delegates rather than
    // reimplementing the rule.
    expect(platformSeenBy({ 'x-platform': 'iOS' })).toBe('ios');
  });

  it('does not throw when the request has no headers bag', () => {
    expect(() => platformSeenBy(undefined)).not.toThrow();
    expect(platformSeenBy(undefined)).toBeNull();
  });

  it('leaves no context behind once the request completes', () => {
    platformSeenBy({ 'x-platform': 'ios' });

    // The store must not outlive the request that created it, or a background
    // job running afterwards would inherit a user's platform.
    expect(getRequestPlatform()).toBeNull();
  });

  it('calls next exactly once', () => {
    const next = jest.fn();
    middleware.use(
      { headers: { 'x-platform': 'ios' } } as unknown as Request,
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});

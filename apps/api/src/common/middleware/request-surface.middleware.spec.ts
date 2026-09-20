import type { Request, Response } from 'express';

import {
  getRequestPlatform,
  getRequestSurface,
  runWithRequestContext,
} from '../context/request-context';
import { RequestPlatformMiddleware } from './request-platform.middleware';

/**
 * The surface half of `RequestPlatformMiddleware`.
 *
 * `request-platform.middleware.spec.ts` covers the platform half; this file
 * covers the value that makes the browser gate possible at all, and the
 * property that matters most about it: the surface and the platform are
 * resolved from ONE header bag in ONE pass, so the two can never describe
 * different clients within a request.
 */
describe('RequestPlatformMiddleware — client surface', () => {
  const middleware = new RequestPlatformMiddleware();

  const CHROME_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const IOS_APP_UA = 'LIBERTASIAN/25 CFNetwork/3860.700.2 Darwin/25.6.0';

  /** Run the middleware over a header bag and report what downstream sees. */
  const seenBy = (
    headers: unknown,
  ): { platform: unknown; surface: unknown } => {
    let seen: { platform: unknown; surface: unknown } = {
      platform: 'next-never-called',
      surface: 'next-never-called',
    };
    middleware.use({ headers } as unknown as Request, {} as Response, () => {
      seen = { platform: getRequestPlatform(), surface: getRequestSurface() };
    });
    return seen;
  };

  it('makes the resolved surface visible to downstream handlers', () => {
    expect(seenBy({ 'user-agent': CHROME_UA }).surface).toBe('web');
  });

  it('resolves a headerless native app to legacy_app — PROTECTS LIVE BUILD 25', () => {
    // Build 25 predates `x-platform` entirely, so its platform is null — the
    // same null a browser has. Only this surface distinguishes them, and
    // `legacy_app` is the value that is never enforced.
    expect(seenBy({ 'user-agent': IOS_APP_UA }).surface).toBe('legacy_app');
  });

  it('resolves a request with no User-Agent at all to web', () => {
    expect(seenBy({}).surface).toBe('web');
  });

  it('resolves platform and surface from the SAME header bag, consistently', () => {
    // Build 26: both values describe one client. If the middleware ever
    // resolved them from different places — one from headers, one from ambient
    // state — this is where the disagreement would first show up.
    expect(seenBy({ 'x-platform': 'ios', 'user-agent': IOS_APP_UA })).toEqual({
      platform: 'ios',
      surface: 'ios',
    });
  });

  it('keeps the platform null while the surface is web, for a browser', () => {
    // The pairing the whole design rests on: a browser cannot buy (null
    // platform, so no store term ever fires) yet is still identifiable (web
    // surface, so its own flag can gate it).
    expect(seenBy({ 'user-agent': CHROME_UA })).toEqual({
      platform: null,
      surface: 'web',
    });
  });

  it('does not throw when the request has no headers bag', () => {
    expect(() => seenBy(undefined)).not.toThrow();
    expect(seenBy(undefined).surface).toBe('web');
  });

  it('leaves no surface behind once the request completes', () => {
    seenBy({ 'user-agent': CHROME_UA });

    // Outside a request the surface is null, NOT 'web'. A background job that
    // inherited 'web' from a finished request would start gating work nobody is
    // waiting on and that has no way to present a paywall.
    expect(getRequestSurface()).toBeNull();
  });

  it('reports null for a context built without a surface', () => {
    // `RequestContext.surface` is optional so that hand-built contexts — tests,
    // and anything simulating a request — keep today's behaviour. Absent must
    // read as null (never enforced), not as 'web'.
    runWithRequestContext({ platform: 'ios' }, () => {
      expect(getRequestSurface()).toBeNull();
      expect(getRequestPlatform()).toBe('ios');
    });
  });

  it('does not leak a surface between concurrently interleaved requests', async () => {
    // The same ALS property `request-context.spec.ts` pins for the platform,
    // asserted for the surface: a module-level variable would be overwritten by
    // whichever request entered the middleware most recently, and a browser
    // request resuming after a DB round-trip would read build 25's surface —
    // deciding, wrongly, that it is ungated.
    const observed: Record<string, unknown> = {};

    const run = (label: string, surface: 'web' | 'legacy_app', delay: number) =>
      runWithRequestContext({ platform: null, surface }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        observed[label] = getRequestSurface();
      });

    await Promise.all([
      run('browser', 'web', 20),
      run('build25', 'legacy_app', 5),
    ]);

    expect(observed).toEqual({ browser: 'web', build25: 'legacy_app' });
  });
});

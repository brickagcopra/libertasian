import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';

import { AppThrottlerGuard } from './app-throttler.guard';

const SECRET = 'test-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';

/** Reaches the protected getTracker without going through Nest's DI. */
type TrackerAccess = { getTracker(req: Record<string, unknown>): Promise<string> };

function makeGuard() {
  const jwt = new JwtService({ secret: SECRET });
  const config = {
    get: (key: string, fallback?: string) =>
      key === 'JWT_SECRET' ? SECRET : (fallback ?? ''),
  } as unknown as ConfigService;

  const guard = new AppThrottlerGuard(
    {} as ThrottlerModuleOptions,
    {} as ThrottlerStorage,
    new Reflector(),
    jwt,
    config,
  );
  return { guard: guard as unknown as TrackerAccess, jwt };
}

function req(headers: Record<string, string> = {}, extra = {}) {
  return { headers, ip: '203.0.113.7', ...extra };
}

describe('AppThrottlerGuard.getTracker', () => {
  it('keys on the verified sub from the Bearer token', async () => {
    const { guard, jwt } = makeGuard();
    const token = jwt.sign({ sub: USER_ID, email: 'a@b.com' });

    expect(await guard.getTracker(req({ authorization: `Bearer ${token}` }))).toBe(
      USER_ID,
    );
  });

  it('is case-insensitive about the Bearer scheme', async () => {
    const { guard, jwt } = makeGuard();
    const token = jwt.sign({ sub: USER_ID });

    expect(await guard.getTracker(req({ authorization: `bearer ${token}` }))).toBe(
      USER_ID,
    );
  });

  // The whole point of the fix: this used to be dead code, because global
  // guards run before route-level JwtAuthGuard and req.user is never set.
  it('falls back to IP when there is no Authorization header', async () => {
    const { guard } = makeGuard();
    expect(await guard.getTracker(req())).toBe('203.0.113.7');
  });

  it('REJECTS a token signed with the wrong key and falls back to IP', async () => {
    const { guard } = makeGuard();
    const forged = new JwtService({ secret: 'attacker-key' }).sign({
      sub: 'forged-subject',
    });

    // Keying on an unverified sub would let anyone mint a fresh subject per
    // request and get an unlimited budget.
    expect(
      await guard.getTracker(req({ authorization: `Bearer ${forged}` })),
    ).toBe('203.0.113.7');
  });

  it('falls back to IP for an expired token', async () => {
    const { guard, jwt } = makeGuard();
    const expired = jwt.sign({ sub: USER_ID }, { expiresIn: '-1s' });

    expect(
      await guard.getTracker(req({ authorization: `Bearer ${expired}` })),
    ).toBe('203.0.113.7');
  });

  it('falls back to IP for a malformed token or non-Bearer scheme', async () => {
    const { guard } = makeGuard();

    expect(
      await guard.getTracker(req({ authorization: 'Bearer not-a-jwt' })),
    ).toBe('203.0.113.7');
    expect(await guard.getTracker(req({ authorization: 'Basic abc123' }))).toBe(
      '203.0.113.7',
    );
    expect(await guard.getTracker(req({ authorization: 'Bearer' }))).toBe(
      '203.0.113.7',
    );
  });

  it('prefers an already-populated req.user over re-verifying', async () => {
    const { guard } = makeGuard();
    expect(await guard.getTracker(req({}, { user: { sub: 'from-req-user' } }))).toBe(
      'from-req-user',
    );
  });

  it("returns 'unknown' when neither a token nor an IP is available", async () => {
    const { guard } = makeGuard();
    expect(await guard.getTracker({ headers: {} })).toBe('unknown');
  });

  it('gives two different users separate buckets on one shared egress IP', async () => {
    const { guard, jwt } = makeGuard();
    const a = jwt.sign({ sub: 'user-a' });
    const b = jwt.sign({ sub: 'user-b' });

    // The CGNAT / office-NAT case from CLAUDE.md: same IP, distinct trackers.
    const trackerA = await guard.getTracker(req({ authorization: `Bearer ${a}` }));
    const trackerB = await guard.getTracker(req({ authorization: `Bearer ${b}` }));

    expect(trackerA).toBe('user-a');
    expect(trackerB).toBe('user-b');
    expect(trackerA).not.toBe(trackerB);
  });
});

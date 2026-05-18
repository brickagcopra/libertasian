import { ExecutionContext } from '@nestjs/common';

import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  let guard: OptionalJwtAuthGuard;
  const ctx = {} as ExecutionContext;

  beforeEach(() => {
    guard = new OptionalJwtAuthGuard();
  });

  it('returns null when no token is present (passport user=false)', () => {
    const result = guard.handleRequest(null, false, undefined, ctx);
    expect(result).toBeNull();
  });

  it('returns null when token is invalid (err set, user=false)', () => {
    const err = new Error('jwt expired');
    const result = guard.handleRequest(err, false, undefined, ctx);
    expect(result).toBeNull();
  });

  it('returns the user payload when token is valid', () => {
    const user = { sub: 'user-1', organizationId: 'org-1', roles: ['member'] };
    const result = guard.handleRequest(null, user, undefined, ctx);
    expect(result).toEqual(user);
  });

  it('never throws on missing/invalid token (anonymous traffic allowed through)', () => {
    expect(() => guard.handleRequest(null, false, undefined, ctx)).not.toThrow();
    expect(() =>
      guard.handleRequest(new Error('bad'), false, undefined, ctx),
    ).not.toThrow();
  });
});

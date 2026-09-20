import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '@libertasian/types';

import { PermissionsService } from '../../rbac/permissions.service';
import { JwtStrategy } from './jwt.strategy';

function buildPayload(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'user-1',
    email: 'admin@example.com',
    role: 'owner' as JwtPayload['role'],
    organizationId: 'org-1',
    mfaVerified: true,
    iat: 0,
    exp: 0,
    ...overrides,
  };
}

/**
 * Platform-admin resolution no longer lives here. The strategy used to read
 * the effective permissions of the caller's CURRENT org membership and test
 * them for any `admin:*` code — which made platform authority a property of
 * owning a personal workspace, i.e. of every account on the system. The single
 * definition is now PermissionsService.isPlatformAdmin, scoped to the platform
 * organization and shared with auth.service's token issuance; the `admin:*`
 * prefix semantics and fail-closed behaviour are asserted there
 * (platform-authority.spec.ts).
 *
 * What is asserted here is the wiring: the strategy delegates by USER id, and
 * memberId stays scoped to the caller's current org because that is what
 * PermissionsGuard and TenantGuard consume.
 */
describe('JwtStrategy.validate', () => {
  let config: ConfigService;
  let permissions: jest.Mocked<PermissionsService>;
  let strategy: JwtStrategy;

  beforeEach(() => {
    config = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        return def;
      }),
    } as unknown as ConfigService;

    permissions = {
      resolveMemberId: jest.fn().mockResolvedValue('member-1'),
      getEffectivePermissions: jest.fn(),
      isPlatformAdmin: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<PermissionsService>;

    strategy = new JwtStrategy(config, permissions);
  });

  it('delegates isPlatformAdmin to PermissionsService, keyed by USER id', async () => {
    permissions.isPlatformAdmin.mockResolvedValue(true);

    const out = await strategy.validate(buildPayload());

    expect(out.isPlatformAdmin).toBe(true);
    expect(permissions.isPlatformAdmin).toHaveBeenCalledWith('user-1');
  });

  it('marks isPlatformAdmin=false when the user is not platform staff', async () => {
    permissions.isPlatformAdmin.mockResolvedValue(false);

    const out = await strategy.validate(buildPayload());

    expect(out.isPlatformAdmin).toBe(false);
  });

  it('does NOT derive platform admin from the caller’s current org', async () => {
    // The old implementation called getEffectivePermissions(memberId of
    // payload.organizationId) and prefix-tested the result. A personal
    // workspace must contribute nothing to this answer.
    permissions.isPlatformAdmin.mockResolvedValue(false);
    permissions.getEffectivePermissions.mockResolvedValue(['admin:billing']);

    const out = await strategy.validate(
      buildPayload({ organizationId: 'personal-workspace' }),
    );

    expect(out.isPlatformAdmin).toBe(false);
    expect(permissions.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('resolves memberId against the caller’s CURRENT org', async () => {
    permissions.resolveMemberId.mockResolvedValue('member-9');

    const out = await strategy.validate(buildPayload());

    expect(out.memberId).toBe('member-9');
    expect(permissions.resolveMemberId).toHaveBeenCalledWith('user-1', 'org-1');
  });

  it('leaves memberId undefined when the user is not a member of the token org', async () => {
    permissions.resolveMemberId.mockResolvedValue(null);

    const out = await strategy.validate(buildPayload());

    expect(out.memberId).toBeUndefined();
  });

  it('rejects payloads missing sub or email', async () => {
    await expect(
      strategy.validate(buildPayload({ sub: '' as string })),
    ).rejects.toThrow();
    await expect(
      strategy.validate(buildPayload({ email: '' as string })),
    ).rejects.toThrow();
  });

  it('does not deny the request if member resolution throws', async () => {
    permissions.resolveMemberId.mockRejectedValue(new Error('redis down'));

    const out = await strategy.validate(buildPayload());

    expect(out.memberId).toBeUndefined();
    expect(out.isPlatformAdmin).toBe(false);
  });
});

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

describe('JwtStrategy.validate — platform admin resolution', () => {
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
      resolveMemberId: jest.fn(),
      getEffectivePermissions: jest.fn(),
    } as unknown as jest.Mocked<PermissionsService>;

    strategy = new JwtStrategy(config, permissions);
  });

  it('marks isPlatformAdmin=true when member has any admin:* permission', async () => {
    permissions.resolveMemberId.mockResolvedValue('member-1');
    permissions.getEffectivePermissions.mockResolvedValue([
      'documents:read',
      'admin:billing',
    ]);

    const out = await strategy.validate(buildPayload());

    expect(out.isPlatformAdmin).toBe(true);
    expect(out.memberId).toBe('member-1');
    expect(permissions.resolveMemberId).toHaveBeenCalledWith('user-1', 'org-1');
    expect(permissions.getEffectivePermissions).toHaveBeenCalledWith('member-1');
  });

  it('marks isPlatformAdmin=true on admin:users', async () => {
    permissions.resolveMemberId.mockResolvedValue('member-1');
    permissions.getEffectivePermissions.mockResolvedValue(['admin:users']);

    const out = await strategy.validate(buildPayload());

    expect(out.isPlatformAdmin).toBe(true);
  });

  it('marks isPlatformAdmin=false when member only holds non-admin perms', async () => {
    permissions.resolveMemberId.mockResolvedValue('member-1');
    permissions.getEffectivePermissions.mockResolvedValue([
      'documents:read',
      'digests:read',
      'workspace:matter:read',
    ]);

    const out = await strategy.validate(buildPayload());

    expect(out.isPlatformAdmin).toBe(false);
    expect(out.memberId).toBe('member-1');
  });

  it('does not match strings that merely contain "admin:" in the middle', async () => {
    // Defense against any future perm that contains the substring but is not
    // a real admin:* code (e.g. "workspace:admin:foo"). startsWith() is the
    // contract.
    permissions.resolveMemberId.mockResolvedValue('member-1');
    permissions.getEffectivePermissions.mockResolvedValue([
      'workspace:admin:notes',
    ]);

    const out = await strategy.validate(buildPayload());

    expect(out.isPlatformAdmin).toBe(false);
  });

  it('returns isPlatformAdmin=false when user is not an org member', async () => {
    permissions.resolveMemberId.mockResolvedValue(null);

    const out = await strategy.validate(buildPayload());

    expect(out.isPlatformAdmin).toBe(false);
    expect(out.memberId).toBeUndefined();
    expect(permissions.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('rejects payloads missing sub or email', async () => {
    await expect(
      strategy.validate(buildPayload({ sub: '' as string })),
    ).rejects.toThrow();
    await expect(
      strategy.validate(buildPayload({ email: '' as string })),
    ).rejects.toThrow();
  });

  it('fails open as non-admin if RBAC lookup throws (must not deny the request)', async () => {
    permissions.resolveMemberId.mockRejectedValue(new Error('redis down'));

    const out = await strategy.validate(buildPayload());

    expect(out.isPlatformAdmin).toBe(false);
  });
});

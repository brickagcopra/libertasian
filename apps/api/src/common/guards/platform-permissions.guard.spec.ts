import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { PermissionsService } from '../../modules/rbac/permissions.service';
import { PlatformPermissionsGuard } from './platform-permissions.guard';

/**
 * PermissionsGuard answers "may the caller do this in their CURRENT org?".
 * For platform administration that is the wrong question in both directions:
 *
 *  - every self-registered user holds `owner` on a personal workspace, so a
 *    tenant-scoped `members:read` check is satisfied by every account on the
 *    system;
 *  - login picks a user's OLDEST active membership as the token org, so a
 *    genuine superadmin whose personal workspace predates their staff
 *    membership would be refused their own console.
 */
describe('PlatformPermissionsGuard', () => {
  function buildContext(user: unknown) {
    const request = { user };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
      _request: request,
    } as never;
  }

  function build(opts: {
    required?: { permissions: string[]; mode: 'all' | 'any' };
    platformPermissions?: string[];
    platformMemberId?: string | null;
  }) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(opts.required),
    } as unknown as Reflector;

    const permissions = {
      getPlatformPermissions: jest
        .fn()
        .mockResolvedValue(opts.platformPermissions ?? []),
      resolvePlatformMemberId: jest
        .fn()
        .mockResolvedValue(opts.platformMemberId ?? null),
    };

    const guard = new PlatformPermissionsGuard(
      reflector,
      permissions as unknown as PermissionsService,
    );

    return { guard, permissions };
  }

  it('passes handlers that declare no platform permissions', async () => {
    const { guard } = build({ required: undefined });

    await expect(guard.canActivate(buildContext({ sub: 'u-1' }))).resolves.toBe(
      true,
    );
  });

  it('allows a caller holding the required platform permission', async () => {
    const { guard } = build({
      required: { permissions: ['members:read'], mode: 'all' },
      platformPermissions: ['members:read', 'roles:read'],
    });

    await expect(guard.canActivate(buildContext({ sub: 'u-1' }))).resolves.toBe(
      true,
    );
  });

  it('denies a caller who holds the permission only on their own workspace', async () => {
    // getPlatformPermissions returns [] for a non-member of the platform org,
    // whatever they hold elsewhere. This is the whole point of the guard.
    const { guard } = build({
      required: { permissions: ['members:read'], mode: 'all' },
      platformPermissions: [],
    });

    await expect(
      guard.canActivate(buildContext({ sub: 'u-owner' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keys on the USER, never on the token organization', async () => {
    const { guard, permissions } = build({
      required: { permissions: ['members:read'], mode: 'all' },
      platformPermissions: ['members:read'],
    });

    await guard.canActivate(
      buildContext({ sub: 'u-1', organizationId: 'personal-workspace' }),
    );

    expect(permissions.getPlatformPermissions).toHaveBeenCalledWith('u-1');
  });

  it('honours mode any', async () => {
    const { guard } = build({
      required: { permissions: ['roles:create', 'members:read'], mode: 'any' },
      platformPermissions: ['members:read'],
    });

    await expect(guard.canActivate(buildContext({ sub: 'u-1' }))).resolves.toBe(
      true,
    );
  });

  it('honours mode all', async () => {
    const { guard } = build({
      required: { permissions: ['roles:create', 'members:read'], mode: 'all' },
      platformPermissions: ['members:read'],
    });

    await expect(
      guard.canActivate(buildContext({ sub: 'u-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies an unauthenticated request', async () => {
    const { guard } = build({
      required: { permissions: ['members:read'], mode: 'all' },
    });

    await expect(
      guard.canActivate(buildContext(undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('attaches the resolved platform member for the handler', async () => {
    const { guard } = build({
      required: { permissions: ['members:read'], mode: 'all' },
      platformPermissions: ['members:read'],
      platformMemberId: 'm-super',
    });
    const context = buildContext({ sub: 'u-1' }) as unknown as {
      _request: { user: Record<string, unknown> };
    };

    await guard.canActivate(context as never);

    expect(context._request.user['platformMemberId']).toBe('m-super');
  });

  it('names only what was required, never the caller’s own permissions', async () => {
    // The denial message reaches the client; the caller's full permission set
    // is not the client's business.
    const { guard } = build({
      required: { permissions: ['roles:create'], mode: 'all' },
      platformPermissions: ['members:read', 'digests:review'],
    });

    await expect(
      guard.canActivate(buildContext({ sub: 'u-1' })),
    ).rejects.toThrow(/roles:create/);
    await expect(
      guard.canActivate(buildContext({ sub: 'u-1' })),
    ).rejects.not.toThrow(/digests:review/);
  });
});

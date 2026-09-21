import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PlatformPermissionsGuard } from './platform-permissions.guard';
import { PLATFORM_PERMISSIONS_KEY } from '../decorators/platform-permissions.decorator';

interface RequestUser {
  sub?: string;
  organizationId?: string;
  memberId?: string;
}

function makeContext(user: RequestUser | undefined): {
  context: ExecutionContext;
  request: { user: RequestUser | undefined };
} {
  const request = { user };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeGuard(
  meta: { permissions: string[]; mode: 'all' | 'any' } | undefined,
  held: string[],
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockImplementation((key: string) =>
      key === PLATFORM_PERMISSIONS_KEY ? meta : undefined,
    ),
  } as unknown as Reflector;

  const platformGrants = {
    hasAnyPlatformPermission: jest
      .fn()
      .mockImplementation((_userId: string, codes: string[]) =>
        Promise.resolve(codes.some((c) => held.includes(c))),
      ),
    hasAllPlatformPermissions: jest
      .fn()
      .mockImplementation((_userId: string, codes: string[]) =>
        Promise.resolve(codes.every((c) => held.includes(c))),
      ),
  };

  return {
    guard: new PlatformPermissionsGuard(reflector, platformGrants as never),
    platformGrants,
  };
}

describe('PlatformPermissionsGuard', () => {
  it('passes when no platform permissions are required', async () => {
    const { guard } = makeGuard(undefined, []);
    const { context } = makeContext({ sub: 'u-1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows a user holding the required permission', async () => {
    const { guard } = makeGuard(
      { permissions: ['platform-staff:manage'], mode: 'all' },
      ['platform-staff:manage'],
    );
    const { context } = makeContext({ sub: 'u-1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('denies a user who does not hold it', async () => {
    const { guard } = makeGuard(
      { permissions: ['platform-staff:manage'], mode: 'all' },
      ['digests:review'],
    );
    const { context } = makeContext({ sub: 'u-1' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('resolves from user.sub ONLY — an absent organizationId is not an error', async () => {
    // A staff member's JWT org is their personal workspace and tells this
    // guard nothing. It must not be required, read, or resolved.
    const { guard, platformGrants } = makeGuard(
      { permissions: ['platform-staff:manage'], mode: 'all' },
      ['platform-staff:manage'],
    );
    const { context } = makeContext({ sub: 'u-1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(platformGrants.hasAllPlatformPermissions).toHaveBeenCalledWith('u-1', [
      'platform-staff:manage',
    ]);
  });

  it('NEVER writes user.memberId', async () => {
    // PermissionsGuard attaches the resolved organization_members id there and
    // tenant-scoped writes downstream use it. Writing it from a platform
    // resolution would send those writes to the wrong organization — a
    // data-integrity bug, not a 403.
    const { guard } = makeGuard(
      { permissions: ['platform-staff:manage'], mode: 'all' },
      ['platform-staff:manage'],
    );
    const { context, request } = makeContext({
      sub: 'u-1',
      organizationId: 'org-personal',
    });

    await guard.canActivate(context);

    expect(request.user).not.toHaveProperty('memberId');
    expect(request.user).toEqual({ sub: 'u-1', organizationId: 'org-personal' });
  });

  it('leaves an existing memberId untouched', async () => {
    const { guard } = makeGuard(
      { permissions: ['platform-staff:manage'], mode: 'all' },
      ['platform-staff:manage'],
    );
    const { context, request } = makeContext({
      sub: 'u-1',
      organizationId: 'org-personal',
      memberId: 'member-from-tenant-guard',
    });

    await guard.canActivate(context);

    expect(request.user?.memberId).toBe('member-from-tenant-guard');
  });

  it('refuses an unauthenticated request', async () => {
    const { guard } = makeGuard(
      { permissions: ['platform-staff:manage'], mode: 'all' },
      [],
    );
    const { context } = makeContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(
      /Authentication required/,
    );
  });

  it("mode 'any' needs only one of the listed permissions", async () => {
    const { guard } = makeGuard(
      { permissions: ['platform-staff:manage', 'platform-roles:manage'], mode: 'any' },
      ['platform-roles:manage'],
    );
    const { context } = makeContext({ sub: 'u-1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('says how platform capability is obtained when it denies', async () => {
    const { guard } = makeGuard(
      { permissions: ['platform-staff:manage'], mode: 'all' },
      [],
    );
    const { context } = makeContext({ sub: 'u-1' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      /granted per person in Admin → Staff/,
    );
  });
});

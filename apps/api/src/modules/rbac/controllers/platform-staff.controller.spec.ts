import { Reflector } from '@nestjs/core';

import { PlatformStaffController } from './platform-staff.controller';
import { PLATFORM_PERMISSIONS_KEY } from '../../../common/decorators/platform-permissions.decorator';
import {
  JwtAuthGuard,
  PermissionsGuard,
  PlatformPermissionsGuard,
  SubscriptionGuard,
  TenantGuard,
} from '../../../common/guards';
import { PERMISSIONS_KEY } from '../../../common/decorators/permissions.decorator';

const GUARDS_KEY = '__guards__';

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_KEY, target) as unknown[]) ?? [];
}

describe('PlatformStaffController — wiring', () => {
  const reflector = new Reflector();

  it('requires platform-staff:manage', () => {
    expect(
      reflector.get(PLATFORM_PERMISSIONS_KEY, PlatformStaffController),
    ).toEqual({ permissions: ['platform-staff:manage'], mode: 'all' });
  });

  it('is guarded by JwtAuthGuard + PlatformPermissionsGuard only', () => {
    // Deliberately NOT TenantGuard/PermissionsGuard/SubscriptionGuard: staff
    // belong to no organization, and a subscription gate would make platform
    // capability depend on the actor's personal workspace plan.
    expect(guardsOf(PlatformStaffController)).toEqual([
      JwtAuthGuard,
      PlatformPermissionsGuard,
    ]);
  });

  it('carries no TENANT permission metadata that PermissionsGuard could read', () => {
    expect(reflector.get(PERMISSIONS_KEY, PlatformStaffController)).toBeUndefined();
    for (const guard of guardsOf(PlatformStaffController)) {
      expect(guard).not.toBe(TenantGuard);
      expect(guard).not.toBe(PermissionsGuard);
      expect(guard).not.toBe(SubscriptionGuard);
    }
  });
});

describe('PlatformStaffController — behaviour', () => {
  function build() {
    const platformGrants = {
      listGrants: jest
        .fn()
        .mockResolvedValue({ items: [], meta: { hasNext: false, limit: 20 } }),
      searchCandidates: jest.fn().mockResolvedValue([]),
      getGrantsForUser: jest.fn().mockResolvedValue([]),
      grant: jest.fn().mockResolvedValue({ id: 'g-1', roleSlug: 'reviewer' }),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    return {
      controller: new PlatformStaffController(platformGrants as never),
      platformGrants,
    };
  }

  it('paginates the staff list by cursor', async () => {
    const { controller, platformGrants } = build();

    await controller.list({ cursor: 'grant-9', limit: 50 });

    expect(platformGrants.listGrants).toHaveBeenCalledWith({
      cursor: 'grant-9',
      limit: 50,
    });
  });

  it('omits absent pagination params rather than passing undefined', async () => {
    const { controller, platformGrants } = build();

    await controller.list({});

    expect(platformGrants.listGrants).toHaveBeenCalledWith({});
  });

  it('searches existing accounts only', async () => {
    const { controller, platformGrants } = build();

    await controller.searchCandidates({ q: 'jane', limit: 5 });

    expect(platformGrants.searchCandidates).toHaveBeenCalledWith('jane', 5);
  });

  it('passes the ACTOR as the grantor, never a client-supplied value', async () => {
    const { controller, platformGrants } = build();

    await controller.grant(
      'u-target',
      { roleDefinitionId: 'rd-reviewer' },
      { sub: 'u-actor' },
    );

    expect(platformGrants.grant).toHaveBeenCalledWith(
      'u-target',
      'rd-reviewer',
      'u-actor',
      undefined,
    );
  });

  it('converts an expiry string into a Date', async () => {
    const { controller, platformGrants } = build();

    await controller.grant(
      'u-target',
      { roleDefinitionId: 'rd-reviewer', expiresAt: '2026-12-31T00:00:00.000Z' },
      { sub: 'u-actor' },
    );

    const [, , , expiry] = platformGrants.grant.mock.calls[0] as unknown[];
    expect(expiry).toEqual(new Date('2026-12-31T00:00:00.000Z'));
  });

  it('revokes by user id and role id', async () => {
    const { controller, platformGrants } = build();

    const res = await controller.revoke('u-target', 'rd-reviewer', {
      sub: 'u-actor',
    });

    expect(platformGrants.revoke).toHaveBeenCalledWith(
      'u-target',
      'rd-reviewer',
      'u-actor',
    );
    expect(res).toEqual({ success: true });
  });
});

import { Reflector } from '@nestjs/core';

import { PlatformRolesController } from './platform-roles.controller';
import { PLATFORM_PERMISSIONS_KEY } from '../../../common/decorators/platform-permissions.decorator';
import {
  JwtAuthGuard,
  PlatformPermissionsGuard,
} from '../../../common/guards';

const GUARDS_KEY = '__guards__';

describe('PlatformRolesController — wiring', () => {
  const reflector = new Reflector();

  it('requires platform-roles:manage', () => {
    expect(
      reflector.get(PLATFORM_PERMISSIONS_KEY, PlatformRolesController),
    ).toEqual({ permissions: ['platform-roles:manage'], mode: 'all' });
  });

  it('is guarded by JwtAuthGuard + PlatformPermissionsGuard only', () => {
    expect(Reflect.getMetadata(GUARDS_KEY, PlatformRolesController)).toEqual([
      JwtAuthGuard,
      PlatformPermissionsGuard,
    ]);
  });
});

describe('PlatformRolesController — behaviour', () => {
  const CATALOGUE = [
    { id: 'p1', code: 'digests:review', resource: 'digests', action: 'review', category: 'digests', description: null },
    { id: 'p2', code: 'digests:approve', resource: 'digests', action: 'approve', category: 'digests', description: null },
    { id: 'p3', code: 'admin:dashboard', resource: 'admin', action: 'dashboard', category: 'admin', description: null },
  ];

  function build() {
    const platformGrants = {
      listGrantableRoles: jest.fn().mockResolvedValue([]),
      getPlatformRole: jest.fn().mockResolvedValue({ id: 'rd-1' }),
      createPlatformRole: jest.fn().mockResolvedValue({ id: 'rd-new' }),
      updatePlatformRole: jest.fn().mockResolvedValue({ id: 'rd-1' }),
      deletePlatformRole: jest.fn().mockResolvedValue(undefined),
    };
    const permissions = {
      getAllPermissions: jest.fn().mockResolvedValue(CATALOGUE),
    };
    return {
      controller: new PlatformRolesController(
        platformGrants as never,
        permissions as never,
      ),
      platformGrants,
      permissions,
    };
  }

  it('groups the permission catalogue by category and resource', async () => {
    // The picker is rendered from this, so a new permission appears in the UI
    // with no deploy.
    const { controller } = build();

    const res = await controller.catalogue();

    expect(res.data.permissions).toHaveLength(3);
    expect(res.data.groups).toEqual([
      {
        category: 'digests',
        resources: [
          {
            resource: 'digests',
            permissions: [CATALOGUE[0], CATALOGUE[1]],
          },
        ],
      },
      {
        category: 'admin',
        resources: [{ resource: 'admin', permissions: [CATALOGUE[2]] }],
      },
    ]);
  });

  it('passes the actor through on create, update and delete', async () => {
    const { controller, platformGrants } = build();
    const actor = { sub: 'u-actor' };

    await controller.createRole(
      { name: 'Corpus Reviewer', slug: 'corpus-reviewer', permissionIds: ['p1'] },
      actor,
    );
    await controller.updateRole('rd-1', { name: 'Renamed' }, actor);
    await controller.deleteRole('rd-1', actor);

    expect(platformGrants.createPlatformRole).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'corpus-reviewer' }),
      'u-actor',
    );
    expect(platformGrants.updatePlatformRole).toHaveBeenCalledWith(
      'rd-1',
      { name: 'Renamed' },
      'u-actor',
    );
    expect(platformGrants.deletePlatformRole).toHaveBeenCalledWith(
      'rd-1',
      'u-actor',
    );
  });

  it('lists only platform-grantable roles', async () => {
    const { controller, platformGrants } = build();

    await controller.listRoles();

    expect(platformGrants.listGrantableRoles).toHaveBeenCalled();
  });
});

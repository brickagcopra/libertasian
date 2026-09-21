import { SelfPermissionsController } from './self-permissions.controller';

/**
 * GET /rbac/me/permissions — P5: any authenticated user may read their OWN
 * permissions, with no permission required.
 */
describe('SelfPermissionsController', () => {
  function build(opts: {
    memberId?: string | null;
    tenantPermissions?: string[];
    platformPermissions?: string[];
  }) {
    const permissions = {
      resolveMemberId: jest.fn().mockResolvedValue(opts.memberId ?? null),
      getEffectivePermissions: jest
        .fn()
        .mockResolvedValue(opts.tenantPermissions ?? []),
    };
    const platformGrants = {
      getPlatformPermissions: jest
        .fn()
        .mockResolvedValue(opts.platformPermissions ?? []),
    };
    return {
      controller: new SelfPermissionsController(
        permissions as never,
        platformGrants as never,
      ),
      permissions,
      platformGrants,
    };
  }

  it('returns tenant and platform permissions as separate sets', async () => {
    const { controller } = build({
      memberId: 'member-1',
      tenantPermissions: ['documents:read', 'notes:create'],
      platformPermissions: ['digests:review'],
    });

    const res = await controller.myPermissions({
      sub: 'u-1',
      organizationId: 'org-1',
    });

    expect(res.data).toEqual({
      tenantPermissions: ['documents:read', 'notes:create'],
      platformPermissions: ['digests:review'],
      isPlatformStaff: true,
    });
  });

  it('a reviewer with no members:read still gets their own permissions', async () => {
    // This is the bug the endpoint exists to fix. The web client used to
    // resolve its own permissions via GET /rbac/members, which needs
    // members:read — so a reviewer 403'd, the hook returned [], and
    // PermissionGate hid everything from them. Nothing here consults
    // members:read at all.
    const { controller } = build({
      memberId: 'member-reviewer',
      tenantPermissions: ['documents:read'], // note: no members:read
      platformPermissions: ['digests:review', 'digests:approve'],
    });

    const res = await controller.myPermissions({
      sub: 'u-reviewer',
      organizationId: 'org-personal',
    });

    expect(res.data.tenantPermissions).not.toContain('members:read');
    expect(res.data.platformPermissions).toContain('digests:review');
    expect(res.data.isPlatformStaff).toBe(true);
  });

  it('a user with no membership in their JWT org still gets platform permissions', async () => {
    const { controller } = build({
      memberId: null,
      platformPermissions: ['platform-staff:manage'],
    });

    const res = await controller.myPermissions({
      sub: 'u-staff',
      organizationId: 'org-stale',
    });

    expect(res.data.tenantPermissions).toEqual([]);
    expect(res.data.platformPermissions).toEqual(['platform-staff:manage']);
  });

  it('a JWT with no organizationId does not fail — it just has no tenant set', async () => {
    const { controller, permissions } = build({
      platformPermissions: ['digests:review'],
    });

    const res = await controller.myPermissions({ sub: 'u-1' });

    expect(permissions.resolveMemberId).not.toHaveBeenCalled();
    expect(res.data.tenantPermissions).toEqual([]);
    expect(res.data.isPlatformStaff).toBe(true);
  });

  it('an ordinary user holding no grant is not platform staff', async () => {
    const { controller } = build({
      memberId: 'member-owner',
      tenantPermissions: ['documents:read', 'digests:create'],
      platformPermissions: [],
    });

    const res = await controller.myPermissions({
      sub: 'u-john',
      organizationId: 'org-personal',
    });

    expect(res.data.isPlatformStaff).toBe(false);
    expect(res.data.platformPermissions).toEqual([]);
  });
});

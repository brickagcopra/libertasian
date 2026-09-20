import { PermissionsService } from '../permissions.service';
import { SelfPermissionsController } from './self-permissions.controller';

/**
 * GET /rbac/me/permissions — P4: any authenticated user may read their OWN
 * effective permissions with no permission required.
 *
 * The regression this exists to prevent: the web client resolved its own
 * permissions by calling GET /rbac/members (gated on `members:read`) and then
 * GET /rbac/members/:id/permissions. reviewer@libertasian.com got 403 on the
 * first hop — verified on prod — so useMyPermissions returned [] and
 * PermissionGate denied the reviewer every surface in the product, including
 * the review queue they exist to work.
 */
describe('SelfPermissionsController', () => {
  const PLATFORM_ORG = '00000000-0000-0000-0000-000000000001';

  function build(opts: {
    orgMemberId?: string | null;
    orgPermissions?: string[];
    platformMemberId?: string | null;
    platformPermissions?: string[];
  }) {
    const permissions = {
      resolveMemberId: jest.fn().mockResolvedValue(opts.orgMemberId ?? null),
      getEffectivePermissions: jest
        .fn()
        .mockResolvedValue(opts.orgPermissions ?? []),
      resolvePlatformMemberId: jest
        .fn()
        .mockResolvedValue(opts.platformMemberId ?? null),
      getPlatformPermissions: jest
        .fn()
        .mockResolvedValue(opts.platformPermissions ?? []),
    };
    const controller = new SelfPermissionsController(
      permissions as unknown as PermissionsService,
    );
    return { controller, permissions };
  }

  it('returns the caller’s own org permissions with no permission required', async () => {
    const { controller } = build({
      orgMemberId: 'm-1',
      orgPermissions: ['documents:read', 'digests:read'],
    });

    const res = await controller.getMyPermissions({
      sub: 'u-1',
      organizationId: 'org-1',
    });

    expect(res.data.permissions).toEqual(['documents:read', 'digests:read']);
  });

  it('serves a role that holds NO members:read', async () => {
    // reviewer holds digests:review but not members:read. Under the old
    // two-hop lookup this user resolved to [] and lost the whole UI.
    const { controller } = build({
      orgMemberId: 'm-rev',
      orgPermissions: ['digests:read'],
      platformMemberId: 'm-rev',
      platformPermissions: ['digests:review', 'digests:read'],
    });

    const res = await controller.getMyPermissions({
      sub: 'u-rev',
      organizationId: PLATFORM_ORG,
    });

    expect(res.data.permissions).not.toContain('members:read');
    expect(res.data.platformPermissions).toContain('digests:review');
  });

  it('reports platformMember=false and empty platform permissions for an ordinary signup', async () => {
    const { controller } = build({
      orgMemberId: 'm-own',
      orgPermissions: ['documents:read', 'members:read'],
      platformMemberId: null,
      platformPermissions: [],
    });

    const res = await controller.getMyPermissions({
      sub: 'u-own',
      organizationId: 'org-personal',
    });

    expect(res.data.platformMember).toBe(false);
    expect(res.data.platformPermissions).toEqual([]);
    expect(res.data.isPlatformAdmin).toBe(false);
  });

  it('keeps tenant and platform permissions in separate fields', async () => {
    // P2: owning a personal workspace must contribute nothing to platform
    // capability. Merging the two server-side would erase that distinction
    // before the client ever sees it.
    const { controller } = build({
      orgMemberId: 'm-own',
      orgPermissions: ['documents:read'],
      platformMemberId: 'm-staff',
      platformPermissions: ['admin:dashboard'],
    });

    const res = await controller.getMyPermissions({
      sub: 'u-dual',
      organizationId: 'org-personal',
    });

    expect(res.data.permissions).toEqual(['documents:read']);
    expect(res.data.platformPermissions).toEqual(['admin:dashboard']);
  });

  it('derives isPlatformAdmin from PLATFORM permissions only', async () => {
    const { controller } = build({
      orgMemberId: 'm-own',
      // An admin:* code on the caller's own workspace must NOT make them one.
      orgPermissions: ['admin:billing'],
      platformMemberId: null,
      platformPermissions: [],
    });

    const res = await controller.getMyPermissions({
      sub: 'u-x',
      organizationId: 'org-personal',
    });

    expect(res.data.isPlatformAdmin).toBe(false);
  });

  it('sets isPlatformAdmin=true on any admin:* platform code', async () => {
    const { controller } = build({
      platformMemberId: 'm-staff',
      platformPermissions: ['digests:read', 'admin:review-queue'],
    });

    const res = await controller.getMyPermissions({
      sub: 'u-staff',
      organizationId: PLATFORM_ORG,
    });

    expect(res.data.isPlatformAdmin).toBe(true);
    expect(res.data.platformMember).toBe(true);
  });

  it('returns an empty org set when the caller is no longer a member of the token org', async () => {
    const { controller, permissions } = build({
      orgMemberId: null,
      platformMemberId: null,
    });

    const res = await controller.getMyPermissions({
      sub: 'u-gone',
      organizationId: 'org-revoked',
    });

    expect(res.data.permissions).toEqual([]);
    expect(permissions.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('tolerates a token with no organization context', async () => {
    const { controller, permissions } = build({ platformMemberId: null });

    const res = await controller.getMyPermissions({ sub: 'u-noorg' });

    expect(res.data.permissions).toEqual([]);
    expect(permissions.resolveMemberId).not.toHaveBeenCalled();
  });
});

import { PATH_METADATA } from '@nestjs/common/constants';

import { DigestsAdminController } from './digests-admin.controller';
import {
  JwtAuthGuard,
  MfaGuard,
  PermissionsGuard,
  PlatformPermissionsGuard,
  SubscriptionGuard,
  TenantGuard,
} from '../../common/guards';
import { PLATFORM_PERMISSIONS_KEY } from '../../common/decorators/platform-permissions.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

/**
 * The review queue's guard chain, asserted against the REAL controller.
 *
 * PlatformRosterHealthService finds this controller by its `@Controller` path
 * and reads its `__guards__` metadata through DiscoveryService, so that the
 * empty-roster warning retires itself if the controller is ever repointed
 * back at tenant permissions. That indirection is only safe if the path and
 * the metadata key are what the health check expects — this pins both.
 */
describe('DigestsAdminController — guard chain', () => {
  it('serves the path the roster health check looks for', () => {
    expect(Reflect.getMetadata(PATH_METADATA, DigestsAdminController)).toBe(
      'admin/digests',
    );
  });

  it('is guarded by JwtAuthGuard + MfaGuard + PlatformPermissionsGuard', () => {
    expect(Reflect.getMetadata('__guards__', DigestsAdminController)).toEqual([
      JwtAuthGuard,
      MfaGuard,
      PlatformPermissionsGuard,
    ]);
  });

  it('has no TenantGuard — a platform admin has no org context to require', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      DigestsAdminController,
    ) as unknown[];

    // TenantGuard throws 'No organization context' BEFORE the permission
    // check runs, which would 403 exactly the people this controller is for.
    expect(guards).not.toContain(TenantGuard);
    expect(guards).not.toContain(PermissionsGuard);
    expect(guards).not.toContain(SubscriptionGuard);
  });

  it('requires digests:review OR admin:review-queue as PLATFORM permissions', () => {
    expect(
      Reflect.getMetadata(PLATFORM_PERMISSIONS_KEY, DigestsAdminController),
    ).toEqual({
      permissions: ['digests:review', 'admin:review-queue'],
      mode: 'any',
    });
  });

  it('carries no TENANT permission metadata left over from the old chain', () => {
    // A stale @RequiredPermissions would be inert here (no PermissionsGuard
    // to read it) and would mislead anyone reading the file.
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, DigestsAdminController),
    ).toBeUndefined();
  });
});

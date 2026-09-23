import { Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';

import { PlatformPermissionsGuard } from '../../common/guards/platform-permissions.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  BOOTSTRAP_COMMAND,
  PlatformRosterHealthService,
} from './platform-roster.health';

/**
 * The one failure mode of the #497 deploy order: the review queue guarded by
 * platform capability while nobody holds any. Everyone 403s, including
 * whoever would have to grant the access back.
 *
 * This check warns. It must NEVER prevent the application from starting —
 * refusing to boot would trade a contained failure (the review queue needs one
 * CLI command) for a total one (search, auth, mobile, billing webhooks). Most
 * of what follows is about that guarantee.
 */
describe('PlatformRosterHealthService', () => {
  /** A stand-in controller carrying real Nest metadata. */
  function controller(path: string, guards: unknown[]) {
    class FakeController {}
    Reflect.defineMetadata(PATH_METADATA, path, FakeController);
    Reflect.defineMetadata('__guards__', guards, FakeController);
    return { metatype: FakeController };
  }

  function build(opts: {
    controllers?: Array<{ metatype: unknown }>;
    grantCount?: number;
    liveGrantCount?: number;
    countThrows?: boolean;
    discoveryThrows?: boolean;
  }) {
    const prisma = {
      platformRoleGrant: {
        count: jest
          .fn()
          .mockImplementation((args?: { where?: unknown }) => {
            if (opts.countThrows) {
              return Promise.reject(new Error('relation does not exist'));
            }
            return Promise.resolve(
              args?.where ? (opts.liveGrantCount ?? 0) : (opts.grantCount ?? 0),
            );
          }),
      },
    };
    const discovery = {
      getControllers: jest.fn().mockImplementation(() => {
        if (opts.discoveryThrows) throw new Error('container not ready');
        return (
          opts.controllers ?? [
            controller('admin/digests', [PlatformPermissionsGuard]),
          ]
        );
      }),
    };
    return {
      service: new PlatformRosterHealthService(
        prisma as never,
        discovery as never,
      ),
      prisma,
      discovery,
    };
  }

  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('never fatal', () => {
    it('resolves rather than throwing when the roster is empty', async () => {
      const { service } = build({ grantCount: 0 });

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it('resolves when the grant count query itself fails', async () => {
      // A broken or un-migrated database must not stop the API from booting.
      const { service } = build({ countThrows: true });

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it('resolves when controller discovery blows up', async () => {
      const { service } = build({ discoveryThrows: true, grantCount: 0 });

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it('resolves when the expected controller is missing entirely', async () => {
      const { service } = build({ controllers: [], grantCount: 0 });

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });

  describe('the warning', () => {
    it('logs ONE structured error naming the bootstrap command', async () => {
      const { service } = build({ grantCount: 0 });

      await service.onApplicationBootstrap();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const payload = errorSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload).toMatchObject({
        event: 'platform_roster_empty',
        grantCount: 0,
        remediation: BOOTSTRAP_COMMAND,
      });
      expect(BOOTSTRAP_COMMAND).toContain('platform:grant');
    });

    it('points at the diagnostics endpoint, not just the logs', async () => {
      const { service } = build({ grantCount: 0 });

      await service.onApplicationBootstrap();

      const payload = errorSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload['diagnostics']).toContain('/admin/diagnostics/platform-roster');
    });

    it('says nothing when somebody holds a grant', async () => {
      const { service } = build({ grantCount: 1, liveGrantCount: 1 });

      await service.onApplicationBootstrap();

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('says nothing when the queue is deliberately NOT platform-guarded', async () => {
      // Read from live metadata, so the warning retires itself if the
      // controller is ever repointed back at tenant permissions.
      const { service } = build({
        controllers: [controller('admin/digests', [PermissionsGuard])],
        grantCount: 0,
      });

      await service.onApplicationBootstrap();

      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns on its own when the expected controller is NOT FOUND', async () => {
      // Silence here would be indistinguishable from a healthy platform: the
      // check has not verified anything, it simply could not look.
      const { service } = build({ controllers: [], grantCount: 0 });

      await service.onApplicationBootstrap();

      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const payload = warnSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload).toMatchObject({
        event: 'platform_roster_check_skipped',
        reason: 'controller_not_found',
        expectedControllerPath: 'admin/digests',
      });
      // It names the path it looked for, so a rename is actionable from the log.
      expect(payload['expectedControllerPath']).toBe('admin/digests');
      expect(String(payload['message'])).toMatch(/REVIEW_QUEUE_CONTROLLER_PATH/);
    });

    it('warns when guard introspection fails, rather than assuming not-guarded', async () => {
      const { service } = build({ discoveryThrows: true, grantCount: 0 });

      await service.onApplicationBootstrap();

      expect(errorSpy).not.toHaveBeenCalled();
      const payload = warnSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload).toMatchObject({
        event: 'platform_roster_check_skipped',
        reason: 'introspection_failed',
      });
    });

    it('still names the diagnostics endpoint when it skips', async () => {
      const { service } = build({ controllers: [], grantCount: 0 });

      await service.onApplicationBootstrap();

      const payload = warnSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload['diagnostics']).toContain(
        '/admin/diagnostics/platform-roster',
      );
    });

    it('warns rather than errors when the check could not run', async () => {
      const { service } = build({ countThrows: true });

      await service.onApplicationBootstrap();

      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('reports unhealthy with remediation when guarded and empty', async () => {
      const { service } = build({ grantCount: 0 });

      await expect(service.getStatus()).resolves.toEqual({
        reviewQueueGuardState: 'platform_guarded',
        reviewQueuePlatformGuarded: true,
        checkRan: true,
        grantCount: 0,
        liveGrantCount: 0,
        healthy: false,
        remediation: BOOTSTRAP_COMMAND,
      });
    });

    it('reports healthy with no remediation once somebody holds a grant', async () => {
      const { service } = build({ grantCount: 3, liveGrantCount: 2 });

      const status = await service.getStatus();

      expect(status).toEqual({
        reviewQueueGuardState: 'platform_guarded',
        reviewQueuePlatformGuarded: true,
        checkRan: true,
        grantCount: 3,
        liveGrantCount: 2,
        healthy: true,
      });
    });

    it('separates total grants from live ones, so an all-expired roster is visible', async () => {
      const { service } = build({ grantCount: 4, liveGrantCount: 0 });

      const status = await service.getStatus();

      expect(status.grantCount).toBe(4);
      expect(status.liveGrantCount).toBe(0);
    });

    it('reports the error instead of inventing a count', async () => {
      const { service } = build({ countThrows: true });

      const status = await service.getStatus();

      expect(status.error).toMatch(/relation does not exist/);
      expect(status.grantCount).toBe(-1);
      // "no problem detected", not "verified fine" — the error field says which.
      expect(status.healthy).toBe(true);
    });

    it('distinguishes a DELIBERATELY tenant-guarded queue from a missing one', async () => {
      // Both mean "no roster warning" and used to be the same boolean. They
      // mean opposite things: one is a configuration, the other is the check
      // failing to run.
      const tenant = build({
        controllers: [controller('admin/digests', [PermissionsGuard])],
        grantCount: 0,
      });
      const missing = build({ controllers: [], grantCount: 0 });

      const tenantStatus = await tenant.service.getStatus();
      const missingStatus = await missing.service.getStatus();

      expect(tenantStatus.reviewQueueGuardState).toBe('tenant_guarded');
      expect(tenantStatus.checkRan).toBe(true);
      expect(tenantStatus.error).toBeUndefined();

      expect(missingStatus.reviewQueueGuardState).toBe('controller_not_found');
      expect(missingStatus.checkRan).toBe(false);
      expect(missingStatus.error).toMatch(/admin\/digests/);

      // Both are reviewQueuePlatformGuarded: false — which is exactly why the
      // boolean alone was not enough.
      expect(tenantStatus.reviewQueuePlatformGuarded).toBe(false);
      expect(missingStatus.reviewQueuePlatformGuarded).toBe(false);
    });

    it('reports introspection failure as inconclusive, not as not-guarded', async () => {
      const { service } = build({ discoveryThrows: true, grantCount: 0 });

      const status = await service.getStatus();

      expect(status.reviewQueueGuardState).toBe('introspection_failed');
      expect(status.checkRan).toBe(false);
      expect(status.error).toBeDefined();
    });
  });
});

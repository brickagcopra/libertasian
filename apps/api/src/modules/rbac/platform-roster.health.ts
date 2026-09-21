import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';

import { PrismaService } from '../../prisma/prisma.service';
import { PlatformPermissionsGuard } from '../../common/guards/platform-permissions.guard';

/** The controller path whose guard chain this check is about. */
const REVIEW_QUEUE_CONTROLLER_PATH = 'admin/digests';

/** What an operator has to run to fix an empty roster. */
export const BOOTSTRAP_COMMAND =
  'pnpm --filter api platform:grant -- --email <email> --role admin';

export interface PlatformRosterStatus {
  /** Is the review queue actually behind PlatformPermissionsGuard right now? */
  reviewQueuePlatformGuarded: boolean;
  /** Total rows in platform_role_grants, expired included. */
  grantCount: number;
  /** Grants that confer anything today (expires_at null or in the future). */
  liveGrantCount: number;
  /** false when the queue is platform-guarded and nobody holds a grant. */
  healthy: boolean;
  /** Present only when unhealthy. */
  remediation?: string;
  /** Set when the check could not run; `healthy` is then reported optimistically. */
  error?: string;
}

/**
 * Warns when the review queue is guarded by platform capability and nobody
 * holds any.
 *
 * This is the one failure mode of the #497 deploy order: merge before the
 * staff roster is populated and the review queue 403s for everyone, including
 * whoever would have to grant it back.
 *
 * It is deliberately NOT a boot assertion. Refusing to start would trade a
 * contained failure — the review queue needs one CLI command — for a total
 * one: search, auth, mobile and billing webhooks all go down with it. A
 * review-queue misconfiguration must never take down the platform. So this
 * logs, records, and returns.
 *
 * The guard check is read from the live controller metadata through
 * DiscoveryService rather than hardcoded, so the warning disappears by itself
 * if the controller is ever repointed back at tenant permissions — and so
 * this file needs no import of the digests module.
 */
@Injectable()
export class PlatformRosterHealthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformRosterHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Nothing in here may prevent the application from starting.
    try {
      const status = await this.getStatus();

      if (status.error) {
        // getStatus() swallows its own query failure so the diagnostics
        // endpoint still answers. At boot that must not be silent, or an
        // unreadable roster looks exactly like a healthy one.
        this.logger.warn(
          `Platform roster check could not run: ${status.error}`,
        );
        return;
      }

      if (status.healthy) return;

      this.logger.error({
        event: 'platform_roster_empty',
        message:
          'The digests review queue is guarded by PLATFORM capability and platform_role_grants is EMPTY. Nobody can open the review queue, and nobody can grant the access that would fix it from the panel.',
        controller: REVIEW_QUEUE_CONTROLLER_PATH,
        grantCount: status.grantCount,
        remediation: BOOTSTRAP_COMMAND,
        diagnostics: 'GET /api/v1/admin/diagnostics/platform-roster',
      });
    } catch (err) {
      // A failed check is not a reason to fail a boot.
      this.logger.warn(
        `Platform roster check could not run: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Same condition the boot log reports, for
   * GET /admin/diagnostics/platform-roster — so an operator can see it
   * without reading container logs.
   */
  async getStatus(): Promise<PlatformRosterStatus> {
    const reviewQueuePlatformGuarded = this.isReviewQueuePlatformGuarded();

    try {
      const [grantCount, liveGrantCount] = await Promise.all([
        this.prisma.platformRoleGrant.count(),
        this.prisma.platformRoleGrant.count({
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        }),
      ]);

      const healthy = !reviewQueuePlatformGuarded || grantCount > 0;

      return {
        reviewQueuePlatformGuarded,
        grantCount,
        liveGrantCount,
        healthy,
        ...(healthy ? {} : { remediation: BOOTSTRAP_COMMAND }),
      };
    } catch (err) {
      // Report the failure rather than inventing a number. `healthy: true`
      // here means "no problem detected", not "verified fine" — the `error`
      // field says which.
      return {
        reviewQueuePlatformGuarded,
        grantCount: -1,
        liveGrantCount: -1,
        healthy: true,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Read the live guard chain off whichever controller serves
   * `admin/digests`. Reading it beats asserting it: if the controller is
   * repointed at tenant permissions again, this check retires itself.
   */
  private isReviewQueuePlatformGuarded(): boolean {
    try {
      for (const wrapper of this.discovery.getControllers()) {
        const metatype = wrapper.metatype;
        if (!metatype) continue;

        const path = Reflect.getMetadata(PATH_METADATA, metatype) as
          | string
          | undefined;
        if (path !== REVIEW_QUEUE_CONTROLLER_PATH) continue;

        const guards =
          (Reflect.getMetadata('__guards__', metatype) as unknown[]) ?? [];
        return guards.includes(PlatformPermissionsGuard);
      }
    } catch {
      // Metadata introspection is best-effort; a failure here must not
      // propagate into boot.
    }
    return false;
  }
}

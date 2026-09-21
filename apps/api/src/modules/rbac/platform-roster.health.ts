import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';

import { PrismaService } from '../../prisma/prisma.service';
import { PlatformPermissionsGuard } from '../../common/guards/platform-permissions.guard';

/**
 * The controller path whose guard chain this check is about.
 *
 * Pinned by review-queue-guard-contract.spec.ts, so renaming the path fails
 * the build rather than silently retiring this check.
 */
const REVIEW_QUEUE_CONTROLLER_PATH = 'admin/digests';

/** What an operator has to run to fix an empty roster. */
export const BOOTSTRAP_COMMAND =
  'pnpm --filter api platform:grant -- --email <email> --role admin';

/**
 * What introspection found when it looked for the review-queue controller.
 *
 * `tenant_guarded` and `controller_not_found` both mean "no roster warning",
 * but for opposite reasons: the first is a deliberate configuration, the
 * second is the check failing to run. Collapsing them into one boolean made a
 * broken check indistinguishable from a healthy platform.
 */
export type ReviewQueueGuardState =
  /** Found, behind PlatformPermissionsGuard — the roster matters. */
  | 'platform_guarded'
  /** Found, on the tenant chain — the roster is irrelevant, stay quiet. */
  | 'tenant_guarded'
  /** No controller serves the expected path. The check could not run. */
  | 'controller_not_found'
  /** Metadata introspection threw. The check could not run. */
  | 'introspection_failed';

/** States in which this check has not actually verified anything. */
const INCONCLUSIVE_STATES: ReadonlySet<ReviewQueueGuardState> = new Set([
  'controller_not_found',
  'introspection_failed',
]);

export interface PlatformRosterStatus {
  /** What introspection found. Distinguishes "not guarded" from "not found". */
  reviewQueueGuardState: ReviewQueueGuardState;
  /** Convenience: true only for `platform_guarded`. */
  reviewQueuePlatformGuarded: boolean;
  /** false when the check could not determine whether the roster matters. */
  checkRan: boolean;
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

      if (!status.checkRan) {
        // The check did not run. Saying nothing here would look exactly like
        // a healthy platform, which is the failure this branch exists to
        // prevent: a check that cannot run must say so.
        this.logger.warn({
          event: 'platform_roster_check_skipped',
          reason: status.reviewQueueGuardState,
          expectedControllerPath: REVIEW_QUEUE_CONTROLLER_PATH,
          message:
            status.reviewQueueGuardState === 'controller_not_found'
              ? 'No controller serves the expected path, so whether the review queue is behind platform capability could not be determined. If the path was renamed, update REVIEW_QUEUE_CONTROLLER_PATH — this check is inert until then.'
              : 'Guard metadata for the expected path could not be read, so whether the review queue is behind platform capability could not be determined.',
          grantCount: status.grantCount,
          diagnostics: 'GET /api/v1/admin/diagnostics/platform-roster',
        });
        return;
      }

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
    const reviewQueueGuardState = this.resolveReviewQueueGuardState();
    const reviewQueuePlatformGuarded =
      reviewQueueGuardState === 'platform_guarded';
    const checkRan = !INCONCLUSIVE_STATES.has(reviewQueueGuardState);

    try {
      const [grantCount, liveGrantCount] = await Promise.all([
        this.prisma.platformRoleGrant.count(),
        this.prisma.platformRoleGrant.count({
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        }),
      ]);

      const healthy = !reviewQueuePlatformGuarded || grantCount > 0;

      return {
        reviewQueueGuardState,
        reviewQueuePlatformGuarded,
        checkRan,
        grantCount,
        liveGrantCount,
        healthy,
        ...(healthy ? {} : { remediation: BOOTSTRAP_COMMAND }),
        ...(checkRan ? {} : { error: this.inconclusiveReason(reviewQueueGuardState) }),
      };
    } catch (err) {
      // Report the failure rather than inventing a number. `healthy: true`
      // here means "no problem detected", not "verified fine" — the `error`
      // field says which.
      return {
        reviewQueueGuardState,
        reviewQueuePlatformGuarded,
        checkRan: false,
        grantCount: -1,
        liveGrantCount: -1,
        healthy: true,
        error: (err as Error).message,
      };
    }
  }

  /** Why this check could not conclude anything, for the status payload. */
  private inconclusiveReason(state: ReviewQueueGuardState): string {
    return state === 'controller_not_found'
      ? `No controller serves "${REVIEW_QUEUE_CONTROLLER_PATH}" — cannot tell whether the review queue needs a platform roster.`
      : `Guard metadata for "${REVIEW_QUEUE_CONTROLLER_PATH}" could not be read — cannot tell whether the review queue needs a platform roster.`;
  }

  /**
   * Read the live guard chain off whichever controller serves
   * `admin/digests`. Reading it beats asserting it: if the controller is
   * repointed at tenant permissions again, this check retires itself.
   *
   * Returns a STATE rather than a boolean, because "found and deliberately on
   * the tenant chain" and "not found at all" both mean "no warning" while
   * meaning opposite things. As a boolean the second looked like a healthy
   * platform.
   */
  private resolveReviewQueueGuardState(): ReviewQueueGuardState {
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
        return guards.includes(PlatformPermissionsGuard)
          ? 'platform_guarded'
          : 'tenant_guarded';
      }
    } catch {
      // Metadata introspection is best-effort; a failure here must not
      // propagate into boot — but it must not pass for a clean bill either.
      return 'introspection_failed';
    }
    return 'controller_not_found';
  }
}

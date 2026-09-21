import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PlatformRosterHealthService } from '../rbac/platform-roster.health';
import { SearchService } from './search.service';
import { SuppressedDocsService } from './suppressed-docs.service';

/**
 * Admin diagnostics for the search subsystem. First endpoint returns the
 * size of the dedup-suppression set so editorial can confirm the filter is
 * loaded and roughly correct in volume after a refresh.
 *
 * The refresh endpoint is intentionally kept here (not in /admin/duplicates)
 * because the duplicates UI is a separate PR per the brief.
 */
@ApiTags('Admin — Diagnostics')
@Controller('admin/diagnostics')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('admin:settings')
@Throttle({ default: { ttl: 60_000, limit: 100 } })
@ApiBearerAuth()
export class AdminDiagnosticsController {
  constructor(
    private readonly suppressedDocs: SuppressedDocsService,
    private readonly searchService: SearchService,
    // RbacModule is @Global, so this needs no module edge from search.
    private readonly platformRoster: PlatformRosterHealthService,
  ) {}

  @Get('suppressed-docs')
  @ApiOperation({
    summary: 'Return the count of doc IDs currently filtered from search',
    description:
      'Reads the Redis-backed dedup suppression set. Returns 0 if the set ' +
      'is missing or Redis is unreachable (search falls back to no filter).',
  })
  async getSuppressedDocsCount() {
    const count = await this.suppressedDocs.getCount();
    return { success: true, data: { suppressedDocCount: count } };
  }

  @Get('vector-index')
  @ApiOperation({
    summary: 'Live vector-indexing failure counters for this API process',
    description:
      'The vector index sat at 18.6% of the keyword index because ' +
      'indexLegalDocument swallowed every vector failure into a .catch(warn) ' +
      'and a bare `continue`. These counters make the live path observable. ' +
      'They are in-process and reset on restart — for the absolute gap use ' +
      'GET /admin/vector-backfill/gap, which measures it against OpenSearch.',
  })
  getVectorIndexHealth() {
    return { success: true, data: this.searchService.getVectorIndexStats() };
  }

  /**
   * Deliberately on THIS controller, behind the tenant-resolved
   * `admin:settings`, and NOT on the platform-staff controller behind
   * `platform-staff:manage`.
   *
   * A diagnostic must not depend on the subsystem it diagnoses. If this route
   * required a platform permission, then in the exact condition it exists to
   * report — an empty `platform_role_grants` — nobody would hold that
   * permission and the diagnostic would be unreadable. Keeping it on the
   * tenant path is what makes it answerable precisely when platform auth is
   * broken.
   *
   * Verified this holds: the `admin` role carries `admin:settings` among its
   * 13 admin:* permissions, and subscription.guard.ts:61 short-circuits the
   * plan gate on `isPlatformAdmin === true`, so neither gate bites. The
   * structured boot log remains the primary channel regardless.
   */
  @Get('platform-roster')
  @ApiOperation({
    summary: 'Whether anybody can actually open the review queue',
    description:
      'The review queue is guarded by PLATFORM capability. If platform_role_grants is empty, it 403s for everyone — including whoever would have to grant the access back. The same condition is logged once at boot; this endpoint exists so an operator can see it without reading container logs. Gated on the TENANT permission admin:settings on purpose: a diagnostic gated on the thing it diagnoses is unreadable exactly when it matters. It is NEVER fatal — a review-queue misconfiguration must not stop search, auth, mobile or billing webhooks from starting. reviewQueueGuardState distinguishes a deliberately tenant-guarded queue from a controller the check could not find at all.',
  })
  async getPlatformRosterHealth() {
    const status = await this.platformRoster.getStatus();
    return { success: true, data: status };
  }

  @Post('suppressed-docs/refresh')
  @ApiOperation({
    summary: 'Recompute the dedup suppression set from document_similarities',
    description:
      'Rebuilds the Redis set used by the search dedup post-filter. Safe to ' +
      'run any time; idempotent. Returns the new cardinality.',
  })
  async refreshSuppressedDocs() {
    const result = await this.suppressedDocs.refresh();
    return { success: true, data: result };
  }
}

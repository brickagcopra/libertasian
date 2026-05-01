import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
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
  constructor(private readonly suppressedDocs: SuppressedDocsService) {}

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

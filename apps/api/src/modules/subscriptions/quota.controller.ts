import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { UsageQuotaService } from './usage-quota.service';
import { EntitlementService } from './entitlement.service';

@ApiTags('Quotas')
@Controller('quotas')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
export class QuotaController {
  constructor(
    private readonly usageQuota: UsageQuotaService,
    private readonly entitlementService: EntitlementService,
  ) {}

  /**
   * `previewOnly` is the first-class answer to "can this account reach the paid
   * corpora", and it is the SAME value `DocumentsController.resolvePreviewOnly`
   * and `SearchController.resolvePreviewOnly` gate on — read straight off
   * `resolveEffectiveEntitlements`, never inferred from quota numbers.
   *
   * It exists because clients were otherwise forced to guess. The mobile app
   * read `cameraScansPerMonth` and `digestsPerMonth` both being 0 as a proxy
   * for the free tier, which is right for the current plan table and wrong the
   * moment a plan has positive generation quotas but no corpus entitlement.
   * Shipping the real flag means the client hides exactly what the server gates.
   *
   * The platform-admin bypass is mirrored from those controllers so an admin on
   * a free org is not shown a client stripped of surfaces the API will happily
   * serve them. No `AdminBypassAuditService.record()` here: that audit exists to
   * trace admin READS OF PAID CONTENT, and this endpoint returns the caller's
   * own usage counters, nothing gated.
   */
  @Get('usage')
  @ApiOperation({ summary: 'Get full usage summary with bonuses and billing period' })
  async getUsage(@CurrentUser() user: JwtPayload) {
    const [summary, activeBonuses, entitlements] = await Promise.all([
      this.usageQuota.getUsageSummaryV2(user.organizationId, user.sub),
      this.entitlementService.getActiveBonuses(user.organizationId),
      this.entitlementService.resolveEffectiveEntitlements(user.organizationId),
    ]);

    const previewOnly =
      user.isPlatformAdmin === true ? false : entitlements.previewOnly === true;

    return {
      success: true,
      data: {
        quotas: summary.quotas,
        billingPeriodStart: summary.billingPeriodStart,
        billingPeriodEnd: summary.billingPeriodEnd,
        activeBonuses,
        previewOnly,
      },
    };
  }
}

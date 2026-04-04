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

  @Get('usage')
  @ApiOperation({ summary: 'Get full usage summary with bonuses and billing period' })
  async getUsage(@CurrentUser() user: JwtPayload) {
    const [summary, activeBonuses] = await Promise.all([
      this.usageQuota.getUsageSummaryV2(user.organizationId, user.sub),
      this.entitlementService.getActiveBonuses(user.organizationId),
    ]);

    return {
      success: true,
      data: {
        quotas: summary.quotas,
        billingPeriodStart: summary.billingPeriodStart,
        billingPeriodEnd: summary.billingPeriodEnd,
        activeBonuses,
      },
    };
  }
}

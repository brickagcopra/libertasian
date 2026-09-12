import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AiSettingsService } from './ai-settings.service';
import { UpdateBudgetSettingsDto } from './update-budget-settings.dto';

@ApiTags('Admin — Budget')
@Controller('admin/budget')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['admin:ai-settings'], mode: 'any' })
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class BudgetController {
  constructor(private readonly aiSettings: AiSettingsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get current budget snapshot and spend breakdown' })
  async getCurrent() {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const [snapshot, byScope, scopeBudgets] = await Promise.all([
      this.aiSettings.getBudgetSnapshot(),
      this.aiSettings.getLedgerByScope(month),
      // Live per-category ceilings + Redis spend. `byScope` above is the
      // Postgres ledger view, which is the accounting record; this is what
      // actually gates generation.
      this.aiSettings.getScopeBudgetStatus(),
    ]);
    return { snapshot, byScope, scopeBudgets };
  }

  /**
   * Kept for the existing callers of PATCH /admin/budget/settings. New
   * work should use PATCH /admin/ai-settings/budget, which is the single
   * place budgets are set and the only one that accepts per-category
   * ceilings.
   *
   * The `as` cast this used to carry lied to the type system: omitting
   * monthlyCeilingUsd produced `{ monthlyBudgetUsd: undefined }`, which
   * the service upserted as `{ amount: undefined }` — read back as "no
   * ceiling", i.e. an omitted field silently removed the global cap.
   * updateBudget now takes both fields as genuinely optional.
   */
  @Patch('settings')
  @ApiOperation({ summary: 'Update monthly and/or daily budget ceilings' })
  async updateSettings(
    @Body() dto: UpdateBudgetSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.aiSettings.updateBudget(
      {
        ...(dto.monthlyCeilingUsd !== undefined && {
          monthlyBudgetUsd: dto.monthlyCeilingUsd,
        }),
        ...(dto.dailyCeilingUsd !== undefined && {
          dailyBudgetUsd: dto.dailyCeilingUsd,
        }),
      },
      user.sub,
    );
    return { success: true };
  }

  @Get('history')
  @ApiOperation({ summary: 'Get monthly ledger history' })
  async getHistory(@Query('months') months?: string) {
    const n = months ? parseInt(months, 10) : 12;
    return this.aiSettings.getLedgerHistory(Math.min(Math.max(n, 1), 24));
  }
}

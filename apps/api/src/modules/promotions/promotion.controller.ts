import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PromotionRuleEngineService } from './promotion-rule-engine.service';
import { CheckPromotionEligibilityDto } from './dto';

/**
 * User-facing promotion controller.
 * Provides promotion eligibility checks for checkout and pricing page data.
 */
@ApiTags('Promotions')
@Controller('promotions')
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 30 } })
export class PromotionController {
  constructor(private readonly ruleEngine: PromotionRuleEngineService) {}

  @Post('eligible')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({
    summary: 'Find eligible promotions for checkout',
    description:
      'Returns all active promotions the current user/organization is eligible for, with discount previews.',
  })
  async findEligiblePromotions(
    @Body() dto: CheckPromotionEligibilityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const results = await this.ruleEngine.findEligiblePromotions(
      user.organizationId,
      user.sub,
      dto.planCode,
      dto.billingPeriod,
    );
    return { success: true, data: results };
  }

  @Get('active')
  @ApiOperation({
    summary: 'Get active promotions for pricing page',
    description:
      'Returns all active promotions that are flagged for display on the pricing page. Public endpoint (no auth required for pricing display).',
  })
  async getActivePromotionsForPricing() {
    const promotions = await this.ruleEngine.getActivePromotionsForPricing();
    return { success: true, data: promotions };
  }
}

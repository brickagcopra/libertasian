import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { PlansService } from './plans.service';

/**
 * Public plans controller — no authentication required.
 * Returns visible plans with prices for the pricing page.
 */
@ApiTags('Plans')
@Controller('plans')
@Throttle({ default: { ttl: 60000, limit: 60 } })
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @ApiOperation({
    summary: 'List visible plans with prices (public)',
    description: 'Returns all active, visible plans with their active prices and entitlements. Cached for 5 minutes.',
  })
  async listVisiblePlans() {
    const plans = await this.plansService.findVisible();
    return { success: true, data: plans };
  }
}

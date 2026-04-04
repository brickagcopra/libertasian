import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CouponService } from './coupon.service';
import { ValidateCouponDto } from './dto';

/**
 * User-facing coupon controller.
 * Provides coupon validation for the checkout flow.
 */
@ApiTags('Coupons')
@Controller('coupons')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 30 } })
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  @Post('validate')
  @ApiOperation({
    summary: 'Validate a coupon code for checkout',
    description:
      'Validates a coupon code against the current user, organization, selected plan, and billing period. Returns discount preview if valid.',
  })
  async validateCoupon(
    @Body() dto: ValidateCouponDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.couponService.validateCoupon(
      dto.code,
      user.organizationId,
      user.sub,
      dto.planCode,
      dto.billingPeriod,
    );
    return { success: true, data: result };
  }
}

import { Module } from '@nestjs/common';

import { CouponService } from './coupon.service';
import { CouponAdminController } from './coupon-admin.controller';
import { CouponController } from './coupon.controller';
import { CouponReservationScheduler } from './coupon-reservation.scheduler';

@Module({
  controllers: [CouponAdminController, CouponController],
  providers: [CouponService, CouponReservationScheduler],
  exports: [CouponService],
})
export class CouponsModule {}

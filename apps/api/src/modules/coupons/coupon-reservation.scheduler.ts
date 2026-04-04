import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { CouponService } from './coupon.service';

@Injectable()
export class CouponReservationScheduler {
  private readonly logger = new Logger(CouponReservationScheduler.name);

  constructor(private readonly couponService: CouponService) {}

  /**
   * Expire stale coupon reservations every 5 minutes.
   * Reservations older than 30 minutes are marked expired and counters decremented.
   */
  @Cron('*/5 * * * *')
  async handleExpireStaleReservations() {
    try {
      const count = await this.couponService.expireStaleReservations();
      if (count > 0) {
        this.logger.log(`Expired ${count} stale coupon reservation(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to expire stale coupon reservations', error);
    }
  }
}

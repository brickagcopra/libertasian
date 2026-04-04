import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PromotionService } from './promotion.service';

@Injectable()
export class PromotionScheduler {
  private readonly logger = new Logger(PromotionScheduler.name);

  constructor(private readonly promotionService: PromotionService) {}

  /**
   * Activate scheduled promotions and expire ended promotions every 5 minutes.
   * Mirrors the coupon reservation scheduler cadence.
   */
  @Cron('*/5 * * * *')
  async handleActivateAndExpire(): Promise<void> {
    try {
      const activated = await this.promotionService.activateScheduledPromotions();
      if (activated > 0) {
        this.logger.log(`Activated ${activated} scheduled promotion(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to activate scheduled promotions', error);
    }

    try {
      const expired = await this.promotionService.expireEndedPromotions();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} ended promotion(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to expire ended promotions', error);
    }
  }
}

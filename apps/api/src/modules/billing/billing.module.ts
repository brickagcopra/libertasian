import { Module } from '@nestjs/common';

import { CouponsModule } from '../coupons/coupons.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { XenditService } from './xendit.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [CouponsModule, PromotionsModule],
  controllers: [BillingController, WebhookController],
  providers: [BillingService, XenditService],
  exports: [BillingService],
})
export class BillingModule {}

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
  // XenditService is exported for AccountDeletionModule, which cancels a
  // deleted user's plan directly rather than going through the full
  // cancellation flow (emails, state machine, free-tier fallback).
  exports: [BillingService, XenditService],
})
export class BillingModule {}

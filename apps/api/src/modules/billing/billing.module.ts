import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CouponsModule } from '../coupons/coupons.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.interface';
import { XenditService, XENDIT_PROVIDER_SLUG } from './xendit.service';
import { WebhookController } from './webhook.controller';

/**
 * The ONLY place a concrete gateway is named. Adding PayMongo / Maya /
 * Dragonpay means writing an adapter, injecting it here, and adding one case —
 * no call site changes.
 */
const paymentProviderFactory = {
  provide: PAYMENT_PROVIDER,
  inject: [ConfigService, XenditService],
  useFactory: (config: ConfigService, xendit: XenditService): PaymentProvider => {
    const slug = config.get<string>('PAYMENT_PROVIDER', XENDIT_PROVIDER_SLUG);
    switch (slug) {
      case XENDIT_PROVIDER_SLUG:
        return xendit;
      default:
        // Fail at boot rather than at the first checkout.
        throw new Error(`Unsupported PAYMENT_PROVIDER: ${slug}`);
    }
  },
};

@Module({
  imports: [CouponsModule, PromotionsModule],
  controllers: [BillingController, WebhookController],
  providers: [BillingService, XenditService, paymentProviderFactory],
  // PAYMENT_PROVIDER is exported for AccountDeletionModule, which cancels a
  // deleted user's plan directly rather than going through the full
  // cancellation flow (emails, state machine, free-tier fallback).
  exports: [BillingService, PAYMENT_PROVIDER],
})
export class BillingModule {}

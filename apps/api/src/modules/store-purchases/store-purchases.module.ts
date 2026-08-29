import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RevenueCatService, REVENUECAT_CONDUIT_SLUG } from './revenuecat.service';
import {
  STORE_PURCHASE_PROVIDER,
  type StorePurchaseProvider,
} from './store-purchase-provider.interface';
import {
  StorePurchasesAdminController,
  StorePurchasesController,
} from './store-purchases.controller';
import { StorePurchasesService } from './store-purchases.service';
import { StoreReconciliationScheduler } from './store-reconciliation.scheduler';
import { StoreWebhookController } from './store-webhook.controller';

/**
 * The ONLY place a concrete conduit is named.
 *
 * Note what this factory is NOT: it is not the `PAYMENT_PROVIDER` factory in
 * billing.module.ts. That one is an exclusive-or — one gateway, chosen by env
 * var, for everybody. This token resolves ALONGSIDE it, at the same time, for
 * different subscribers. That is the structural reason IAP is a parallel port
 * rather than a third `PaymentProvider` adapter (D1), and it does not depend on
 * the method-count argument at all.
 *
 * Swapping conduits later (RevenueCat → something else) means writing one more
 * class that implements `StorePurchaseProvider` and adding a case here. It does
 * NOT rewrite subscription rows, because `subscriptions.provider` holds the
 * STORE slug (`app_store` / `play_store`), never the conduit slug.
 */
const storePurchaseProviderFactory = {
  provide: STORE_PURCHASE_PROVIDER,
  inject: [ConfigService, RevenueCatService],
  useFactory: (config: ConfigService, revenuecat: RevenueCatService): StorePurchaseProvider => {
    const slug = config.get<string>('STORE_PURCHASE_CONDUIT', REVENUECAT_CONDUIT_SLUG);
    switch (slug) {
      case REVENUECAT_CONDUIT_SLUG:
        return revenuecat;
      default:
        // Fail at boot rather than at the first webhook.
        throw new Error(`Unsupported STORE_PURCHASE_CONDUIT: ${slug}`);
    }
  },
};

@Module({
  controllers: [StoreWebhookController, StorePurchasesController, StorePurchasesAdminController],
  providers: [
    RevenueCatService,
    storePurchaseProviderFactory,
    StorePurchasesService,
    StoreReconciliationScheduler,
  ],
  exports: [StorePurchasesService, STORE_PURCHASE_PROVIDER],
})
export class StorePurchasesModule {}

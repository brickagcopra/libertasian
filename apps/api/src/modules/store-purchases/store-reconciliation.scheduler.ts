import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { StorePurchasesService } from './store-purchases.service';

/**
 * §9 use 2 — the nightly drift sweep.
 *
 * Webhooks are best-effort: the conduit retries a non-2xx five times over
 * ~155 minutes and then gives up. A paying user stranded on `free` because our
 * API was down for three hours is not acceptable, so every org holding a store
 * subscription in a non-terminal state gets pulled once a night and reconciled
 * against the conduit's own answer.
 *
 * Every correction is audited as `billing.iap.reconciliation_drift`, so drift
 * is MEASURED rather than assumed absent.
 */
@Injectable()
export class StoreReconciliationScheduler {
  private readonly logger = new Logger(StoreReconciliationScheduler.name);

  constructor(
    private readonly storePurchasesService: StorePurchasesService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 3 * * *')
  async handleNightlyReconciliation(): Promise<void> {
    // The sweep makes one outbound call per store subscriber. With no conduit
    // credential configured there is nothing to call, and running it would only
    // produce a log line per org.
    if (!this.config.get<string>('REVENUECAT_API_KEY')) {
      return;
    }

    try {
      const { checked, corrected } = await this.storePurchasesService.reconcileAllStoreSubscriptions();
      if (corrected > 0) {
        this.logger.warn(
          `Store reconciliation corrected ${corrected} of ${checked} organization(s)`,
        );
      } else {
        this.logger.log(`Store reconciliation: ${checked} organization(s) in sync`);
      }
    } catch (err) {
      this.logger.error('Nightly store reconciliation failed', err);
    }
  }
}

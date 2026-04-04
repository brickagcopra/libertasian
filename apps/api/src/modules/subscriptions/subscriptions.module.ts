import { Global, Module } from '@nestjs/common';

import { EntitlementService } from './entitlement.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionOperationsService } from './subscription-operations.service';
import { SubscriptionAdminService } from './subscription-admin.service';
import { ProrationService } from './proration.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageQuotaService } from './usage-quota.service';
import { SubscriptionOperationsController } from './subscription-operations.controller';
import { SubscriptionAdminController } from './subscription-admin.controller';
import { QuotaController } from './quota.controller';

@Global()
@Module({
  controllers: [SubscriptionOperationsController, SubscriptionAdminController, QuotaController],
  providers: [
    SubscriptionsService,
    EntitlementService,
    UsageQuotaService,
    SubscriptionLifecycleService,
    SubscriptionOperationsService,
    SubscriptionAdminService,
    ProrationService,
  ],
  exports: [
    SubscriptionsService,
    EntitlementService,
    UsageQuotaService,
    SubscriptionLifecycleService,
    SubscriptionOperationsService,
    SubscriptionAdminService,
    ProrationService,
  ],
})
export class SubscriptionsModule {}

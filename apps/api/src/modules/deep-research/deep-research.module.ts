import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { DeepResearchController } from './deep-research.controller';
import { DeepResearchService } from './deep-research.service';

@Module({
  // UsageQuotaService / SubscriptionsService come from the @Global
  // SubscriptionsModule; AuditService and AdminBypassAuditService (used by
  // SubscriptionGuard) from the @Global AuditModule.
  imports: [PrismaModule],
  controllers: [DeepResearchController],
  providers: [DeepResearchService],
  exports: [DeepResearchService],
})
export class DeepResearchModule {}

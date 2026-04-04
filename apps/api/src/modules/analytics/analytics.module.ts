import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsDashboardController } from './analytics-dashboard.controller';
import { AnalyticsDashboardService } from './analytics-dashboard.service';
import { AnalyticsProcessor } from './analytics.processor';
import { AnalyticsRetentionService } from './analytics-retention.service';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'analytics:events' }),
    PrismaModule,
  ],
  controllers: [AnalyticsController, AnalyticsDashboardController],
  providers: [
    AnalyticsService,
    AnalyticsDashboardService,
    AnalyticsAggregationService,
    AnalyticsRetentionService,
    AnalyticsProcessor,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}

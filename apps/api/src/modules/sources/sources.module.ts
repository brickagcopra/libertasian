import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from '../../prisma/prisma.module';
import { AiSettingsModule } from '../ai-settings/ai-settings.module';
import { StudyModule } from '../study/study.module';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';
import { SourcesScheduler } from './sources.scheduler';
import { SourcesHealthProcessor } from './sources-health.processor';
import { IngestionSchedulerService } from './ingestion-scheduler.service';

@Module({
  imports: [
    PrismaModule,
    AiSettingsModule,
    StudyModule,
    BullModule.registerQueue({ name: 'source-health' }),
  ],
  controllers: [SourcesController],
  providers: [SourcesService, SourcesScheduler, SourcesHealthProcessor, IngestionSchedulerService],
  exports: [SourcesService],
})
export class SourcesModule {}

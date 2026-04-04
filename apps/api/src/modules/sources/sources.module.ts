import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from '../../prisma/prisma.module';
import { StudyModule } from '../study/study.module';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';
import { SourcesScheduler } from './sources.scheduler';
import { SourcesHealthProcessor } from './sources-health.processor';

@Module({
  imports: [
    PrismaModule,
    StudyModule,
    BullModule.registerQueue({ name: 'source-health' }),
  ],
  controllers: [SourcesController],
  providers: [SourcesService, SourcesScheduler, SourcesHealthProcessor],
  exports: [SourcesService],
})
export class SourcesModule {}

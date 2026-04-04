import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { TimelinesController } from './timelines.controller';
import { TimelinesProcessor } from './timelines.processor';
import { TimelinesService } from './timelines.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'timelines' }),
    PrismaModule,
  ],
  controllers: [TimelinesController],
  providers: [TimelinesService, TimelinesProcessor],
  exports: [TimelinesService],
})
export class TimelinesModule {}

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ContradictionsController } from './contradictions.controller';
import { ContradictionsProcessor } from './contradictions.processor';
import { ContradictionsService } from './contradictions.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'contradictions' }),
    PrismaModule,
  ],
  controllers: [ContradictionsController],
  providers: [ContradictionsService, ContradictionsProcessor],
  exports: [ContradictionsService],
})
export class ContradictionsModule {}

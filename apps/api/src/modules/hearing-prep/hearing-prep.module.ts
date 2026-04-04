import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { HearingPrepController } from './hearing-prep.controller';
import { HearingPrepProcessor } from './hearing-prep.processor';
import { HearingPrepService } from './hearing-prep.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'hearing-prep' }),
    PrismaModule,
  ],
  controllers: [HearingPrepController],
  providers: [HearingPrepService, HearingPrepProcessor],
  exports: [HearingPrepService],
})
export class HearingPrepModule {}

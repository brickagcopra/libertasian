import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { PleadingsController } from './pleadings.controller';
import { PleadingsProcessor } from './pleadings.processor';
import { PleadingsService } from './pleadings.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'pleadings' }),
    PrismaModule,
  ],
  controllers: [PleadingsController],
  providers: [PleadingsService, PleadingsProcessor],
  exports: [PleadingsService],
})
export class PleadingsModule {}

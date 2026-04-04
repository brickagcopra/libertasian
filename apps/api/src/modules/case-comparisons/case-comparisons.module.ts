import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { CaseComparisonsController } from './case-comparisons.controller';
import { CaseComparisonsProcessor } from './case-comparisons.processor';
import { CaseComparisonsService } from './case-comparisons.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'case-comparisons' }),
    PrismaModule,
  ],
  controllers: [CaseComparisonsController],
  providers: [CaseComparisonsService, CaseComparisonsProcessor],
  exports: [CaseComparisonsService],
})
export class CaseComparisonsModule {}

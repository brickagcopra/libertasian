import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { DigestsAdminController } from './digests-admin.controller';
import { DigestsController } from './digests.controller';
import { DigestsProcessor } from './digests.processor';
import { DigestsService } from './digests.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'digests' }),
    PrismaModule,
  ],
  controllers: [DigestsController, DigestsAdminController],
  providers: [DigestsService, DigestsProcessor],
  exports: [DigestsService],
})
export class DigestsModule {}

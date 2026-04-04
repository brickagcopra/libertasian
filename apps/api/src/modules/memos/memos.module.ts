import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { MemosController } from './memos.controller';
import { MemosProcessor } from './memos.processor';
import { MemosService } from './memos.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'memos' }),
    PrismaModule,
  ],
  controllers: [MemosController],
  providers: [MemosService, MemosProcessor],
  exports: [MemosService],
})
export class MemosModule {}

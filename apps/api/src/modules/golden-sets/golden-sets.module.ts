import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { GoldenSetsController } from './golden-sets.controller';
import { GoldenSetsService } from './golden-sets.service';

@Module({
  imports: [PrismaModule],
  controllers: [GoldenSetsController],
  providers: [GoldenSetsService],
  exports: [GoldenSetsService],
})
export class GoldenSetsModule {}

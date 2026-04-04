import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { DuplicatesController } from './duplicates.controller';
import { DuplicatesService } from './duplicates.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [DuplicatesController],
  providers: [DuplicatesService],
  exports: [DuplicatesService],
})
export class DuplicatesModule {}

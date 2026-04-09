import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AdsAdminController } from './ads-admin.controller';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';

@Module({
  imports: [PrismaModule, AuditModule, UploadsModule],
  controllers: [AdsController, AdsAdminController],
  providers: [AdsService],
  exports: [AdsService],
})
export class AdsModule {}

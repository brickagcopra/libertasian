import { Module } from '@nestjs/common';

import { ReportingAdminController } from './reporting-admin.controller';
import { ReportingService } from './reporting.service';

@Module({
  controllers: [ReportingAdminController],
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}

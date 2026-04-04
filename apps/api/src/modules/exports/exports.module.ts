import { Module } from '@nestjs/common';

import { UploadsModule } from '../uploads/uploads.module';
import { ExportGeneratorService } from './export-generator.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [UploadsModule],
  controllers: [ExportsController],
  providers: [ExportsService, ExportGeneratorService],
  exports: [ExportsService],
})
export class ExportsModule {}

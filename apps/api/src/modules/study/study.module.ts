import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { BarSubjectCategorizerService } from './bar-subject-categorizer.service';
import { StudyController } from './study.controller';
import { StudyExportService } from './study-export.service';
import { StudyService } from './study.service';

@Module({
  imports: [PrismaModule],
  controllers: [StudyController],
  providers: [StudyService, StudyExportService, BarSubjectCategorizerService],
  exports: [StudyService, StudyExportService, BarSubjectCategorizerService],
})
export class StudyModule {}

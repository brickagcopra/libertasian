import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [PrismaModule],
  controllers: [DocumentsController, ClassificationController],
  providers: [DocumentsService, ClassificationService],
  exports: [DocumentsService, ClassificationService],
})
export class DocumentsModule {}

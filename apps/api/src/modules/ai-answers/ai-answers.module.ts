import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { DocumentsModule } from '../documents/documents.module';
import { AiAnswersController } from './ai-answers.controller';
import { AiAnswersService } from './ai-answers.service';

@Module({
  // DocumentsService owns the read gate for the legal corpus. Scoping an answer
  // to a document is authorized by reusing that gate verbatim rather than
  // restating who may read what — see AiAnswersController.assertDocumentReadable.
  // EntitlementService and UsageQuotaService come from the @Global
  // SubscriptionsModule, AuditService from the @Global AuditModule.
  imports: [PrismaModule, DocumentsModule],
  controllers: [AiAnswersController],
  providers: [AiAnswersService],
  exports: [AiAnswersService],
})
export class AiAnswersModule {}

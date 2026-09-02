import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { SearchModule } from '../search/search.module';
import { VECTOR_BACKFILL_QUEUE } from './vector-backfill.constants';
import { VectorBackfillController } from './vector-backfill.controller';
import { VectorBackfillProcessor } from './vector-backfill.processor';
import { VectorBackfillService } from './vector-backfill.service';

/**
 * Backfills the OpenSearch vector index from PostgreSQL.
 *
 * Deliberately in NestJS rather than worker-service: `VectorDocumentPayload`,
 * `withVectorDerivedFields`, alias handling and `bulkIndexVectorDocuments` all
 * live in `OpenSearchService`. A Python reimplementation would create a second
 * payload vocabulary free to drift from this one — the exact bug class that
 * produced `statute`/`code`/`rule` and `embedding`/`embedding_vector`.
 */
@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    AuditModule,
    SearchModule,
    BullModule.registerQueue({ name: VECTOR_BACKFILL_QUEUE }),
  ],
  controllers: [VectorBackfillController],
  providers: [VectorBackfillService, VectorBackfillProcessor],
  exports: [VectorBackfillService],
})
export class VectorBackfillModule {}

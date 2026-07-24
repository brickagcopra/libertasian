import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { AdminDiagnosticsController } from './admin-diagnostics.controller';
import { EmbeddingClientService } from './embedding-client.service';
import { IndexRebuildProcessor } from './index-rebuild.processor';
import { INDEX_REBUILD_QUEUE, IndexRebuildService } from './index-rebuild.service';
import { OpenSearchService } from './opensearch.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SuppressedDocsService } from './suppressed-docs.service';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    BullModule.registerQueue({ name: INDEX_REBUILD_QUEUE }),
  ],
  controllers: [SearchController, AdminDiagnosticsController],
  providers: [
    OpenSearchService,
    SearchService,
    EmbeddingClientService,
    SuppressedDocsService,
    IndexRebuildService,
    IndexRebuildProcessor,
  ],
  exports: [
    OpenSearchService,
    SearchService,
    EmbeddingClientService,
    SuppressedDocsService,
    IndexRebuildService,
  ],
})
export class SearchModule {}

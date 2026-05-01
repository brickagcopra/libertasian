import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AdminDiagnosticsController } from './admin-diagnostics.controller';
import { EmbeddingClientService } from './embedding-client.service';
import { OpenSearchService } from './opensearch.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SuppressedDocsService } from './suppressed-docs.service';

@Module({
  imports: [PrismaModule],
  controllers: [SearchController, AdminDiagnosticsController],
  providers: [
    OpenSearchService,
    SearchService,
    EmbeddingClientService,
    SuppressedDocsService,
  ],
  exports: [
    OpenSearchService,
    SearchService,
    EmbeddingClientService,
    SuppressedDocsService,
  ],
})
export class SearchModule {}

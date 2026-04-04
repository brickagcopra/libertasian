import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { EmbeddingClientService } from './embedding-client.service';
import { OpenSearchService } from './opensearch.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [PrismaModule],
  controllers: [SearchController],
  providers: [OpenSearchService, SearchService, EmbeddingClientService],
  exports: [OpenSearchService, SearchService, EmbeddingClientService],
})
export class SearchModule {}

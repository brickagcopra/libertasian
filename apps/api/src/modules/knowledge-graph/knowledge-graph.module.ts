import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import {
  KnowledgeGraphAdminController,
  KnowledgeGraphPublicController,
} from './knowledge-graph.controller';
import { KnowledgeGraphService } from './knowledge-graph.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [
    KnowledgeGraphPublicController,
    KnowledgeGraphAdminController,
  ],
  providers: [KnowledgeGraphService],
  exports: [KnowledgeGraphService],
})
export class KnowledgeGraphModule {}

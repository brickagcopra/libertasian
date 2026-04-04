import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from '../../prisma/prisma.module';
import {
  DoctrinesAdminController,
  DoctrinesDocumentController,
  DoctrinesPublicController,
} from './doctrines.controller';
import { DoctrinesService } from './doctrines.service';
import { DoctrinesProcessor } from './doctrines.processor';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    BullModule.registerQueue({ name: 'doctrines' }),
  ],
  controllers: [
    DoctrinesAdminController,
    DoctrinesPublicController,
    DoctrinesDocumentController,
  ],
  providers: [DoctrinesService, DoctrinesProcessor],
  exports: [DoctrinesService],
})
export class DoctrinesModule {}

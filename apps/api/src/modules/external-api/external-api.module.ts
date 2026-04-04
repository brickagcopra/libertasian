import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SearchModule } from '../search/search.module';
import { DocumentsModule } from '../documents/documents.module';
import { MemosModule } from '../memos/memos.module';
import { ExternalApiController } from './external-api.controller';

@Module({
  imports: [
    PrismaModule,
    SubscriptionsModule,
    SearchModule,
    DocumentsModule,
    MemosModule,
  ],
  controllers: [ExternalApiController],
})
export class ExternalApiModule {}

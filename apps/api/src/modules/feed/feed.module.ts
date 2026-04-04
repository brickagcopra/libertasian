import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { UploadsModule } from '../uploads/uploads.module';
import { FeedAdminController } from './feed-admin.controller';
import { FeedController } from './feed.controller';
import { FeedInteractionsService } from './feed-interactions.service';
import { FeedMediaProcessor } from './feed-media.processor';
import { FeedMediaService } from './feed-media.service';
import { FeedService } from './feed.service';

@Module({
  imports: [
    PrismaModule,
    UploadsModule,
    BullModule.registerQueue({ name: 'feed-media' }),
  ],
  controllers: [FeedController, FeedAdminController],
  providers: [FeedService, FeedMediaService, FeedMediaProcessor, FeedInteractionsService],
  exports: [FeedService],
})
export class FeedModule {}

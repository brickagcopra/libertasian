import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { BookmarksController } from './bookmarks.controller';
import { BookmarksService } from './bookmarks.service';

@Module({
  imports: [PrismaModule],
  controllers: [BookmarksController],
  providers: [BookmarksService],
  exports: [BookmarksService],
})
export class BookmarksModule {}

import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredSubscription } from '../../common/decorators/subscription.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { AuditService } from '../audit/audit.service';
import { BookmarksService } from './bookmarks.service';
import { CreateBookmarkDto, ListBookmarksQueryDto } from './dto';

/**
 * Bookmarks controller — user-scoped, all endpoints require authentication.
 * Ownership enforced at service layer (user can only manage own bookmarks).
 * MfaGuard not needed: personal user feature, no admin/editor role requirement.
 */
@ApiTags('Bookmarks')
@Controller('bookmarks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BookmarksController {
  constructor(
    private readonly bookmarksService: BookmarksService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @UseGuards(SubscriptionGuard)
  @RequiredSubscription('edu')
  @ApiOperation({
    summary: 'Create a bookmark on a legal document (Edu plan or higher)',
  })
  async create(
    @Body() dto: CreateBookmarkDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const bookmark = await this.bookmarksService.create(dto, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'bookmark.create',
      entityType: 'bookmark',
      entityId: bookmark.id,
      metadata: { ip, legalDocumentId: dto.legalDocumentId },
    });
    return { success: true, data: bookmark };
  }

  @Get()
  @ApiOperation({ summary: 'List user bookmarks with cursor pagination' })
  async list(
    @Query() query: ListBookmarksQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.bookmarksService.list(user.sub, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a bookmark' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.bookmarksService.delete(id, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'bookmark.delete',
      entityType: 'bookmark',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Bookmark deleted' } };
  }
}

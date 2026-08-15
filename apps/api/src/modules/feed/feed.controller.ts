import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AuditService } from '../audit/audit.service';
import { FeedService } from './feed.service';
import { FeedMediaService } from './feed-media.service';
import { FeedInteractionsService } from './feed-interactions.service';
import { FeedBlocksService } from './feed-blocks.service';
import { CreatePostDto, UpdatePostDto, FeedQueryDto, CreateCommentDto, UpdateCommentDto, ReportPostDto } from './dto';

@ApiTags('Feed')
@Controller('feed')
export class FeedController {
  constructor(
    private readonly feedService: FeedService,
    private readonly feedMediaService: FeedMediaService,
    private readonly interactionsService: FeedInteractionsService,
    private readonly blocksService: FeedBlocksService,
    private readonly auditService: AuditService,
  ) {}

  // =========================================================================
  // Feed Queries
  // =========================================================================

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get public community feed' })
  async getPublicFeed(
    @CurrentUser() user: JwtPayload,
    @Query() query: FeedQueryDto,
  ) {
    const result = await this.feedService.getPublicFeed(query, user.sub);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Get('organization')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get organization feed' })
  async getOrganizationFeed(
    @CurrentUser() user: JwtPayload,
    @Query() query: FeedQueryDto,
  ) {
    const result = await this.feedService.getOrganizationFeed(query, user.organizationId, user.sub);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user profile feed' })
  async getUserProfileFeed(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) profileUserId: string,
    @Query() query: FeedQueryDto,
  ) {
    const result = await this.feedService.getUserProfileFeed(query, profileUserId, user.sub);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Get('bookmarks')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bookmarked posts' })
  async getBookmarkedPosts(
    @CurrentUser() user: JwtPayload,
    @Query() query: FeedQueryDto,
  ) {
    const result = await this.feedService.getBookmarkedPosts(
      query,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  // =========================================================================
  // Blocking
  //
  // No TenantGuard on any of these: a block is cross-org by design, because
  // the public feed is. Requiring an org context would make it impossible to
  // block an author you met on the public feed from another tenant.
  // =========================================================================

  @Get('blocks')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List users you have blocked' })
  async getBlockedUsers(
    @CurrentUser() user: JwtPayload,
    @Query() query: FeedQueryDto,
  ) {
    const result = await this.blocksService.listBlockedUsers(user.sub, query);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Post('users/:userId/block')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  // Deliberately throttled, unlike the report route above: blocking is a
  // cheap write that fans out into every feed query, so it needs a ceiling.
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Block a user' })
  async blockUser(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.blocksService.blockUser(user.sub, userId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_user.block',
      entityType: 'feed_user_block',
      entityId: userId,
      metadata: { blockedUserId: userId },
    });
  }

  @Delete('users/:userId/block')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unblock a user' })
  async unblockUser(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.blocksService.unblockUser(user.sub, userId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_user.unblock',
      entityType: 'feed_user_block',
      entityId: userId,
      metadata: { blockedUserId: userId },
    });
  }

  // =========================================================================
  // Post CRUD
  // =========================================================================

  @Get('posts/:postId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get single post detail' })
  async getPost(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
  ) {
    const data = await this.feedService.getPost(
      postId,
      user.sub,
      user.organizationId,
    );
    return { success: true, data };
  }

  @Post('posts')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a feed post' })
  async createPost(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePostDto,
  ) {
    const data = await this.feedService.createPost(dto, user.sub, user.organizationId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_post.create',
      entityType: 'feed_post',
      entityId: data.id,
      metadata: { visibility: data.visibility, hasMedia: !!data.media },
    });
    return { success: true, data };
  }

  @Patch('posts/:postId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update own post' })
  async updatePost(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: UpdatePostDto,
  ) {
    const data = await this.feedService.updatePost(postId, dto, user.sub, user.organizationId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_post.update',
      entityType: 'feed_post',
      entityId: postId,
      metadata: { changedFields: Object.keys(dto) },
    });
    return { success: true, data };
  }

  @Delete('posts/:postId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete own post' })
  async deletePost(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
  ) {
    await this.feedService.deletePost(postId, user.sub, user.organizationId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_post.delete',
      entityType: 'feed_post',
      entityId: postId,
    });
  }

  // =========================================================================
  // Media Upload
  // =========================================================================

  @Post('media/upload')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 3600000, limit: 20 } }) // 20 uploads per hour per user
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload a feed image (returns 202 with media ID)' })
  @ApiConsumes('multipart/form-data')
  async uploadMedia(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const data = await this.feedMediaService.initiateUpload(
      {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      },
      user.sub,
      user.organizationId,
    );

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_media.upload',
      entityType: 'feed_post_media',
      entityId: data.mediaId,
    });

    return { success: true, data };
  }

  @Get('media/:mediaId/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get media processing status' })
  async getMediaStatus(
    @CurrentUser() user: JwtPayload,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    const data = await this.feedMediaService.getMediaStatus(mediaId, user.sub, user.organizationId);
    return { success: true, data };
  }

  @Get('media/:mediaId/image')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get processed feed image' })
  async getMediaImage(
    @CurrentUser() user: JwtPayload,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Query('variant') variant: string,
    @Res() res: Response,
  ) {
    const validVariant = variant === 'thumb' ? 'thumb' : 'feed';
    const { buffer, mimeType } = await this.feedMediaService.getMediaImage(
      mediaId,
      validVariant,
      user.sub,
      user.organizationId,
    );

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': 'attachment',
      'Cache-Control': 'private, max-age=3600',
    });
    res.send(buffer);
  }

  @Delete('media/:mediaId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete unattached media' })
  async deleteMedia(
    @CurrentUser() user: JwtPayload,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    await this.feedMediaService.deleteMedia(mediaId, user.sub, user.organizationId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_media.delete',
      entityType: 'feed_post_media',
      entityId: mediaId,
    });
  }

  // =========================================================================
  // Interactions — Likes
  // =========================================================================

  @Post('posts/:postId/like')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Like a post' })
  async likePost(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
  ) {
    await this.interactionsService.likePost(postId, user.sub, user.organizationId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_post.like',
      entityType: 'feed_post',
      entityId: postId,
    });
  }

  @Delete('posts/:postId/like')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlike a post' })
  async unlikePost(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
  ) {
    await this.interactionsService.unlikePost(postId, user.sub);
  }

  // =========================================================================
  // Interactions — Bookmarks
  // =========================================================================

  @Post('posts/:postId/bookmark')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bookmark a post' })
  async bookmarkPost(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
  ) {
    await this.interactionsService.bookmarkPost(postId, user.sub, user.organizationId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_post.bookmark',
      entityType: 'feed_post',
      entityId: postId,
    });
  }

  @Delete('posts/:postId/bookmark')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove bookmark from a post' })
  async unbookmarkPost(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
  ) {
    await this.interactionsService.unbookmarkPost(postId, user.sub);
  }

  // =========================================================================
  // Interactions — Reports
  // =========================================================================

  @Post('posts/:postId/report')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report a post' })
  async reportPost(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: ReportPostDto,
  ) {
    const data = await this.interactionsService.reportPost(
      postId,
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_post.report',
      entityType: 'feed_post_report',
      entityId: data.id,
      metadata: { postId, reason: dto.reason },
    });
    return { success: true, data: { id: data.id } };
  }

  // =========================================================================
  // Comments
  // =========================================================================

  @Get('posts/:postId/comments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get comments for a post' })
  async getComments(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query() query: FeedQueryDto,
  ) {
    const result = await this.interactionsService.getComments(
      postId,
      query,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Post('posts/:postId/comments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a comment on a post' })
  async createComment(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: CreateCommentDto,
  ) {
    const data = await this.interactionsService.createComment(
      postId,
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_comment.create',
      entityType: 'feed_comment',
      entityId: data.id,
      metadata: { postId, hasParent: !!dto.parentId },
    });
    return { success: true, data };
  }

  @Patch('comments/:commentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update own comment' })
  async updateComment(
    @CurrentUser() user: JwtPayload,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
  ) {
    const data = await this.interactionsService.updateComment(
      commentId,
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_comment.update',
      entityType: 'feed_comment',
      entityId: commentId,
    });
    return { success: true, data };
  }

  @Delete('comments/:commentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete own comment' })
  async deleteComment(
    @CurrentUser() user: JwtPayload,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    await this.interactionsService.deleteComment(commentId, user.sub, user.organizationId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'feed_comment.delete',
      entityType: 'feed_comment',
      entityId: commentId,
    });
  }

  @Post('comments/:commentId/like')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Like a comment' })
  async likeComment(
    @CurrentUser() user: JwtPayload,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    await this.interactionsService.likeComment(commentId, user.sub, user.organizationId);
  }

  @Delete('comments/:commentId/like')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlike a comment' })
  async unlikeComment(
    @CurrentUser() user: JwtPayload,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    await this.interactionsService.unlikeComment(commentId, user.sub, user.organizationId);
  }
}

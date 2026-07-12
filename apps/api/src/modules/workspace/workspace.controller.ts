import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { RequiredSubscription } from '../../common/decorators/subscription.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TrackEvent } from '../analytics';
import { AuditService } from '../audit/audit.service';
import { WorkspaceService } from './workspace.service';
import {
  AccessSharedContentDto,
  AddMatterDocumentDto,
  CreateAnnotationDto,
  CreateMatterCommentDto,
  CreateMatterDto,
  CreateNoteDto,
  CreateShareDto,
  CreateTaskCommentDto,
  CreateTaskDto,
  ListMattersQueryDto,
  ListNotesQueryDto,
  ListActivityQueryDto,
  ListSharesQueryDto,
  ListTasksQueryDto,
  UpdateMatterDto,
  UpdateNoteDto,
  UpdateShareDto,
  UpdateTaskDto,
} from './dto';

/**
 * Workspace controller — org-scoped matters, notes, matter documents, and annotations.
 * All endpoints require authentication. Matters and notes are org-scoped via
 * JwtPayload.organizationId (tenant isolation per CLAUDE.md).
 * Annotations are user-scoped (personal highlights on legal documents).
 */
@ApiTags('Workspace')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@ApiBearerAuth()
@Controller()
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly auditService: AuditService,
  ) {}

  // ==========================================================================
  // MATTERS — /api/v1/matters
  // ==========================================================================

  @Post('matters')
  @ApiOperation({ summary: 'Create a matter' })
  @TrackEvent('matter_created', (req) => ({
    matter_type: (req.body?.['matterType'] as string) ?? 'general',
  }))
  async createMatter(
    @Body() dto: CreateMatterDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const matter = await this.workspaceService.createMatter(
      dto,
      user.organizationId,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'matter.create',
      entityType: 'matter',
      entityId: matter.id,
      metadata: { ip, title: dto.title },
    });

    return { success: true, data: matter };
  }

  @Get('matters')
  @ApiOperation({ summary: 'List matters (org-scoped, cursor pagination)' })
  async listMatters(
    @Query() query: ListMattersQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.workspaceService.listMatters(
      user.organizationId,
      query,
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('matters/:id')
  @ApiOperation({ summary: 'Get matter details (with documents and recent notes)' })
  async getMatter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const matter = await this.workspaceService.getMatter(
      id,
      user.organizationId,
    );
    return { success: true, data: matter };
  }

  @Patch('matters/:id')
  @ApiOperation({ summary: 'Update a matter' })
  async updateMatter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMatterDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const matter = await this.workspaceService.updateMatter(
      id,
      user.organizationId,
      dto,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'matter.update',
      entityType: 'matter',
      entityId: id,
      metadata: { ip, changes: dto },
    });

    return { success: true, data: matter };
  }

  @Delete('matters/:id')
  @RequiredPermissions('matters:delete')
  @ApiOperation({ summary: 'Delete a matter (admin/owner only, cascades to documents and notes)' })
  async deleteMatter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.workspaceService.deleteMatter(id, user.organizationId);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'matter.delete',
      entityType: 'matter',
      entityId: id,
      metadata: { ip },
    });

    return { success: true, data: { message: 'Matter deleted' } };
  }

  // ==========================================================================
  // MATTER DOCUMENTS — /api/v1/matters/:id/documents
  // ==========================================================================

  @Post('matters/:id/documents')
  @ApiOperation({ summary: 'Attach a document to a matter' })
  @TrackEvent('matter_document_attached', (req) => ({
    document_source: req.body?.['legalDocumentId'] ? 'corpus' : 'upload',
    role: (req.body?.['role'] as string) ?? 'reference',
  }))
  async addMatterDocument(
    @Param('id', ParseUUIDPipe) matterId: string,
    @Body() dto: AddMatterDocumentDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const doc = await this.workspaceService.addMatterDocument(
      matterId,
      user.organizationId,
      dto,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'matter_document.create',
      entityType: 'matter_document',
      entityId: doc.id,
      metadata: { ip, matterId, legalDocumentId: dto.legalDocumentId, userUploadId: dto.userUploadId },
    });

    return { success: true, data: doc };
  }

  @Get('matters/:id/documents')
  @ApiOperation({ summary: 'List documents attached to a matter' })
  async listMatterDocuments(
    @Param('id', ParseUUIDPipe) matterId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const docs = await this.workspaceService.listMatterDocuments(
      matterId,
      user.organizationId,
    );
    return { success: true, data: docs };
  }

  @Delete('matters/:matterId/documents/:docId')
  @ApiOperation({ summary: 'Remove a document from a matter' })
  async removeMatterDocument(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.workspaceService.removeMatterDocument(
      matterId,
      docId,
      user.organizationId,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'matter_document.delete',
      entityType: 'matter_document',
      entityId: docId,
      metadata: { ip, matterId },
    });

    return { success: true, data: { message: 'Document removed from matter' } };
  }

  // ==========================================================================
  // NOTES — /api/v1/notes
  // ==========================================================================

  @Post('notes')
  @ApiOperation({ summary: 'Create a note (optionally linked to a matter)' })
  @TrackEvent('note_created', (req) => ({
    word_count: (req.body?.['content'] as string)?.split(/\s+/).length ?? 0,
  }))
  async createNote(
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const note = await this.workspaceService.createNote(
      dto,
      user.organizationId,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'note.create',
      entityType: 'note',
      entityId: note.id,
      metadata: { ip, title: dto.title, matterId: dto.matterId },
    });

    return { success: true, data: note };
  }

  @Get('notes')
  @ApiOperation({ summary: 'List notes (own + org-visible, cursor pagination)' })
  async listNotes(
    @Query() query: ListNotesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.workspaceService.listNotes(
      user.organizationId,
      user.sub,
      query,
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('notes/:id')
  @ApiOperation({ summary: 'Get note details' })
  async getNote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const note = await this.workspaceService.getNote(
      id,
      user.organizationId,
      user.sub,
    );
    return { success: true, data: note };
  }

  @Patch('notes/:id')
  @ApiOperation({ summary: 'Update a note (owner only)' })
  async updateNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const note = await this.workspaceService.updateNote(
      id,
      user.organizationId,
      user.sub,
      dto,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'note.update',
      entityType: 'note',
      entityId: id,
      metadata: { ip },
    });

    return { success: true, data: note };
  }

  @Delete('notes/:id')
  @RequiredPermissions('notes:delete')
  @ApiOperation({ summary: 'Delete a note (admin/owner only)' })
  async deleteNote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.workspaceService.deleteNote(
      id,
      user.organizationId,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'note.delete',
      entityType: 'note',
      entityId: id,
      metadata: { ip },
    });

    return { success: true, data: { message: 'Note deleted' } };
  }

  // ==========================================================================
  // ANNOTATIONS — /api/v1/annotations
  // ==========================================================================

  @Post('annotations')
  @UseGuards(SubscriptionGuard)
  @RequiredSubscription('edu')
  @ApiOperation({
    summary:
      'Create an annotation/highlight on a legal document (Edu plan or higher)',
  })
  @TrackEvent('annotation_created', (req) => ({
    color: (req.body?.['color'] as string) ?? 'yellow',
    text_length: (req.body?.['selectedText'] as string)?.length ?? 0,
  }))
  async createAnnotation(
    @Body() dto: CreateAnnotationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const annotation = await this.workspaceService.createAnnotation(
      dto,
      user.sub,
    );

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'annotation.create',
      entityType: 'annotation',
      entityId: annotation.id,
      metadata: { ip, legalDocumentId: dto.legalDocumentId },
    });

    return { success: true, data: annotation };
  }

  @Get('annotations')
  @ApiOperation({
    summary: 'List user annotations (optionally filtered by document)',
  })
  async listAnnotations(
    @Query('legalDocumentId') legalDocumentId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const annotations = await this.workspaceService.listAnnotations(
      user.sub,
      legalDocumentId,
    );
    return { success: true, data: annotations };
  }

  @Delete('annotations/:id')
  @ApiOperation({ summary: 'Delete an annotation' })
  async deleteAnnotation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.workspaceService.deleteAnnotation(id, user.sub);

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'annotation.delete',
      entityType: 'annotation',
      entityId: id,
      metadata: { ip },
    });

    return { success: true, data: { message: 'Annotation deleted' } };
  }

  // ==========================================================================
  // TASKS — /api/v1/tasks
  // ==========================================================================

  @Post('tasks')
  @ApiOperation({ summary: 'Create a task (optionally linked to a matter)' })
  async createTask(
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const task = await this.workspaceService.createTask(
      dto,
      user.organizationId,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'task.create',
      entityType: 'task',
      entityId: task.id,
      metadata: { ip, title: dto.title, matterId: dto.matterId, assignedToUserId: dto.assignedToUserId },
    });

    return { success: true, data: task };
  }

  @Get('tasks')
  @ApiOperation({ summary: 'List tasks (org-scoped, cursor pagination, filters)' })
  async listTasks(
    @Query() query: ListTasksQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.workspaceService.listTasks(
      user.organizationId,
      query,
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Get task details (with comments)' })
  async getTask(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const task = await this.workspaceService.getTask(
      id,
      user.organizationId,
    );
    return { success: true, data: task };
  }

  @Patch('tasks/:id')
  @ApiOperation({ summary: 'Update a task (status, assignee, priority, due date, etc.)' })
  async updateTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const task = await this.workspaceService.updateTask(
      id,
      user.organizationId,
      dto,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'task.update',
      entityType: 'task',
      entityId: id,
      metadata: { ip, changes: dto },
    });

    return { success: true, data: task };
  }

  @Delete('tasks/:id')
  @RequiredPermissions('tasks:delete')
  @ApiOperation({ summary: 'Delete a task (admin/owner only, cascades to comments)' })
  async deleteTask(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.workspaceService.deleteTask(id, user.organizationId);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'task.delete',
      entityType: 'task',
      entityId: id,
      metadata: { ip },
    });

    return { success: true, data: { message: 'Task deleted' } };
  }

  // ==========================================================================
  // TASK COMMENTS — /api/v1/tasks/:id/comments
  // ==========================================================================

  @Post('tasks/:id/comments')
  @ApiOperation({ summary: 'Add a comment to a task' })
  async createTaskComment(
    @Param('id', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateTaskCommentDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const comment = await this.workspaceService.createTaskComment(
      taskId,
      user.organizationId,
      user.sub,
      dto,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'task_comment.create',
      entityType: 'task_comment',
      entityId: comment.id,
      metadata: { ip, taskId },
    });

    return { success: true, data: comment };
  }

  @Get('tasks/:id/comments')
  @ApiOperation({ summary: 'List comments on a task' })
  async listTaskComments(
    @Param('id', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const comments = await this.workspaceService.listTaskComments(
      taskId,
      user.organizationId,
    );
    return { success: true, data: comments };
  }

  @Delete('tasks/:taskId/comments/:commentId')
  @ApiOperation({ summary: 'Delete a task comment (owner only)' })
  async deleteTaskComment(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.workspaceService.deleteTaskComment(
      commentId,
      user.organizationId,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'task_comment.delete',
      entityType: 'task_comment',
      entityId: commentId,
      metadata: { ip, taskId },
    });

    return { success: true, data: { message: 'Comment deleted' } };
  }

  // ==========================================================================
  // MATTER COMMENTS — /api/v1/matters/:id/comments
  // ==========================================================================

  @Post('matters/:id/comments')
  @ApiOperation({ summary: 'Add a comment to a matter' })
  async createMatterComment(
    @Param('id', ParseUUIDPipe) matterId: string,
    @Body() dto: CreateMatterCommentDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const comment = await this.workspaceService.createMatterComment(
      matterId,
      user.organizationId,
      user.sub,
      dto,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'matter_comment.create',
      entityType: 'matter_comment',
      entityId: comment.id,
      metadata: { ip, matterId },
    });

    return { success: true, data: comment };
  }

  @Get('matters/:id/comments')
  @ApiOperation({ summary: 'List comments on a matter' })
  async listMatterComments(
    @Param('id', ParseUUIDPipe) matterId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const comments = await this.workspaceService.listMatterComments(
      matterId,
      user.organizationId,
    );
    return { success: true, data: comments };
  }

  @Delete('matters/:matterId/comments/:commentId')
  @ApiOperation({ summary: 'Delete a matter comment (owner only)' })
  async deleteMatterComment(
    @Param('matterId', ParseUUIDPipe) matterId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.workspaceService.deleteMatterComment(
      commentId,
      user.organizationId,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'matter_comment.delete',
      entityType: 'matter_comment',
      entityId: commentId,
      metadata: { ip, matterId },
    });

    return { success: true, data: { message: 'Comment deleted' } };
  }

  // ==========================================================================
  // ACTIVITY FEED — /api/v1/activity
  // ==========================================================================

  @Get('activity')
  @ApiOperation({ summary: 'List recent workspace activity from audit logs' })
  async listActivity(
    @Query() dto: ListActivityQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.workspaceService.listActivity(
      dto,
      user.organizationId,
    );
    return { success: true, ...result };
  }

  // ==========================================================================
  // WORKSPACE SHARES — /api/v1/shares
  // ==========================================================================

  @Post('shares')
  @ApiOperation({ summary: 'Create a share link for a workspace entity (matter)' })
  @TrackEvent('collaboration_action', (req) => ({
    action: 'share_created',
    target_type: (req.body?.['entityType'] as string) ?? 'matter',
  }))
  async createShare(
    @Body() dto: CreateShareDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.workspaceService.createShare(
      dto,
      user.organizationId,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'workspace_share.create',
      entityType: 'workspace_share',
      entityId: result.share['id'] as string,
      metadata: {
        ip,
        entityType: dto.entityType,
        entityId: dto.entityId,
        permission: dto.permission ?? 'view',
      },
    });

    return { success: true, data: result };
  }

  @Get('shares')
  @ApiOperation({ summary: 'List share links (optionally filter by entity)' })
  async listShares(
    @Query() query: ListSharesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const shares = await this.workspaceService.listShares(
      user.organizationId,
      query,
    );
    return { success: true, data: shares };
  }

  @Patch('shares/:id')
  @ApiOperation({ summary: 'Update a share link (permission, expiry, password, active status)' })
  async updateShare(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShareDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const share = await this.workspaceService.updateShare(
      id,
      user.organizationId,
      dto,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'workspace_share.update',
      entityType: 'workspace_share',
      entityId: id,
      metadata: { ip, changes: dto },
    });

    return { success: true, data: share };
  }

  @Delete('shares/:id')
  @ApiOperation({ summary: 'Revoke (delete) a share link' })
  async revokeShare(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.workspaceService.revokeShare(id, user.organizationId);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'workspace_share.revoke',
      entityType: 'workspace_share',
      entityId: id,
      metadata: { ip },
    });

    return { success: true, data: { message: 'Share link revoked' } };
  }
}

/**
 * Public controller for accessing shared workspace content.
 * No authentication required — access is controlled by share token.
 */
@ApiTags('Shared Content')
@Controller()
export class SharedContentController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get('shared/:token')
  @ApiOperation({
    summary: 'Access shared workspace content via share token (public, no auth required)',
  })
  async accessSharedContent(
    @Param('token') token: string,
    @Query() dto: AccessSharedContentDto,
  ) {
    const result = await this.workspaceService.accessSharedContent(
      token,
      dto.password,
    );
    return { success: true, data: result };
  }

  @Post('shared/:token')
  @ApiOperation({
    summary: 'Access password-protected shared content (submit password via body)',
  })
  async accessSharedContentWithPassword(
    @Param('token') token: string,
    @Body() dto: AccessSharedContentDto,
  ) {
    const result = await this.workspaceService.accessSharedContent(
      token,
      dto.password,
    );
    return { success: true, data: result };
  }
}

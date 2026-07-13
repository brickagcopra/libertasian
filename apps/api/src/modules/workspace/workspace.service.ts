import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes, createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { NOTIFICATION_EVENTS } from '../notifications/notification.events';
import type {
  TaskAssignedEvent,
  TaskCommentAddedEvent,
  MatterCommentAddedEvent,
} from '../notifications/notification.events';
import {
  AddMatterDocumentDto,
  CreateAnnotationDto,
  CreateMatterCommentDto,
  CreateMatterDto,
  CreateNoteDto,
  CreateShareDto,
  CreateTaskCommentDto,
  CreateTaskDto,
  ListActivityQueryDto,
  ListMattersQueryDto,
  ListNotesQueryDto,
  ListSharesQueryDto,
  ListTasksQueryDto,
  UpdateMatterDto,
  UpdateNoteDto,
  UpdateShareDto,
  UpdateTaskDto,
} from './dto';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly entitlementService: EntitlementService,
  ) {}

  // ==========================================================================
  // MATTERS
  // ==========================================================================

  async createMatter(
    dto: CreateMatterDto,
    organizationId: string,
    userId: string,
    opts?: { isPlatformAdmin?: boolean },
  ) {
    // Enforce the plan's maxMatters entitlement (static limit; -1 = unlimited).
    // Platform admins bypass plan entitlements (same policy as SubscriptionGuard
    // and usage quotas).
    if (opts?.isPlatformAdmin !== true) {
      const limit = await this.entitlementService.getEffectiveLimit(
        organizationId,
        'maxMatters',
      );
      if (limit !== -1) {
        const activeCount = await this.prisma
          .forTenant(organizationId)
          .matter.count({
            where: { status: { notIn: ['closed', 'archived'] } },
          });
        if (activeCount >= limit) {
          throw new ForbiddenException({
            message:
              limit === 0
                ? 'Matters are available on Pro plans and above.'
                : `Matter limit reached. Your plan allows ${limit} active matters.`,
            quota: { used: activeCount, limit, resetsAt: '' },
          });
        }
      }
    }

    // Helper also injects this on create; explicit pass kept for TS NOT NULL.
    return this.prisma.forTenant(organizationId).matter.create({
      data: {
        organizationId,
        ownerUserId: userId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        matterType: dto.matterType,
        court: dto.court?.trim(),
      },
    });
  }

  async listMatters(organizationId: string, query: ListMattersQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.MatterWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const matters = await this.prisma.forTenant(organizationId).matter.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, fullName: true, email: true } },
        _count: { select: { documents: true, notes: true } },
      },
    });

    const hasNext = matters.length > limit;
    const items = hasNext ? matters.slice(0, limit) : matters;
    const lastItem = items[items.length - 1];

    return {
      items,
      meta: { hasNext, nextCursor: hasNext && lastItem ? lastItem.id : undefined, limit },
    };
  }

  async getMatter(matterId: string, organizationId: string) {
    const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
      where: { id: matterId },
      include: {
        owner: { select: { id: true, fullName: true, email: true } },
        documents: {
          include: {
            legalDocument: {
              select: { id: true, title: true, shortTitle: true, citationText: true, documentType: true },
            },
            userUpload: {
              select: { id: true, originalFilename: true, uploadType: true, mimeType: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        notes: {
          select: { id: true, title: true, visibility: true, createdAt: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        },
        _count: { select: { documents: true, notes: true } },
      },
    });

    if (!matter) {
      throw new NotFoundException('Matter not found');
    }

    return matter;
  }

  async updateMatter(
    matterId: string,
    organizationId: string,
    dto: UpdateMatterDto,
  ) {
    const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
      where: { id: matterId },
    });

    if (!matter) {
      throw new NotFoundException('Matter not found');
    }

    const data: Prisma.MatterUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.matterType !== undefined) data.matterType = dto.matterType;
    if (dto.court !== undefined) data.court = dto.court.trim();
    if (dto.status !== undefined) data.status = dto.status;

    return this.prisma.forTenant(organizationId).matter.update({
      where: { id: matterId },
      data,
    });
  }

  async deleteMatter(matterId: string, organizationId: string) {
    const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
      where: { id: matterId },
    });

    if (!matter) {
      throw new NotFoundException('Matter not found');
    }

    await this.prisma.forTenant(organizationId).matter.delete({ where: { id: matterId } });
  }

  // ==========================================================================
  // MATTER DOCUMENTS
  // ==========================================================================

  async addMatterDocument(
    matterId: string,
    organizationId: string,
    dto: AddMatterDocumentDto,
  ) {
    // Verify matter belongs to org
    const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
      where: { id: matterId },
    });
    if (!matter) {
      throw new NotFoundException('Matter not found');
    }

    // Must provide at least one of legalDocumentId or userUploadId
    if (!dto.legalDocumentId && !dto.userUploadId) {
      throw new BadRequestException(
        'Either legalDocumentId or userUploadId must be provided',
      );
    }

    // Verify references exist
    if (dto.legalDocumentId) {
      const count = await this.prisma.legalDocument.count({
        where: { id: dto.legalDocumentId },
      });
      if (count === 0) {
        throw new NotFoundException('Legal document not found');
      }
    }

    if (dto.userUploadId) {
      const count = await this.prisma.forTenant(organizationId).userUpload.count({
        where: { id: dto.userUploadId },
      });
      if (count === 0) {
        throw new NotFoundException('User upload not found');
      }
    }

    return this.prisma.matterDocument.create({
      data: {
        matterId,
        legalDocumentId: dto.legalDocumentId,
        userUploadId: dto.userUploadId,
        title: dto.title?.trim(),
        role: dto.role ?? 'reference',
      },
      include: {
        legalDocument: {
          select: { id: true, title: true, shortTitle: true, citationText: true },
        },
        userUpload: {
          select: { id: true, originalFilename: true, uploadType: true },
        },
      },
    });
  }

  async listMatterDocuments(matterId: string, organizationId: string) {
    // Verify matter belongs to org
    const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
      where: { id: matterId },
    });
    if (!matter) {
      throw new NotFoundException('Matter not found');
    }

    return this.prisma.matterDocument.findMany({
      where: { matterId },
      include: {
        legalDocument: {
          select: { id: true, title: true, shortTitle: true, citationText: true, documentType: true },
        },
        userUpload: {
          select: { id: true, originalFilename: true, uploadType: true, mimeType: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeMatterDocument(
    matterId: string,
    documentId: string,
    organizationId: string,
  ) {
    // Verify matter belongs to org
    const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
      where: { id: matterId },
    });
    if (!matter) {
      throw new NotFoundException('Matter not found');
    }

    const doc = await this.prisma.matterDocument.findFirst({
      where: { id: documentId, matterId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found in this matter');
    }

    await this.prisma.matterDocument.delete({ where: { id: documentId } });
  }

  // ==========================================================================
  // NOTES
  // ==========================================================================

  async createNote(
    dto: CreateNoteDto,
    organizationId: string,
    userId: string,
  ) {
    // Verify matter belongs to org if provided
    if (dto.matterId) {
      const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
        where: { id: dto.matterId },
      });
      if (!matter) {
        throw new NotFoundException('Matter not found');
      }
    }

    return this.prisma.forTenant(organizationId).note.create({
      data: {
        organizationId,
        userId,
        matterId: dto.matterId,
        title: dto.title?.trim(),
        body: dto.body as Prisma.InputJsonValue,
        visibility: dto.visibility ?? 'private',
      },
    });
  }

  async listNotes(organizationId: string, userId: string, query: ListNotesQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.NoteWhereInput = {
      // User sees: their own notes + org-visible notes from others
      OR: [
        { userId },
        { visibility: 'org' },
      ],
    };

    if (query.matterId) {
      where.matterId = query.matterId;
    }
    if (query.visibility) {
      // When explicitly filtering, override the OR above
      delete where.OR;
      where.visibility = query.visibility;
      if (query.visibility === 'private') {
        where.userId = userId;
      }
    }
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const notes = await this.prisma.forTenant(organizationId).note.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { updatedAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true } },
        matter: { select: { id: true, title: true } },
      },
    });

    const hasNext = notes.length > limit;
    const items = hasNext ? notes.slice(0, limit) : notes;
    const lastItem = items[items.length - 1];

    return {
      items,
      meta: { hasNext, nextCursor: hasNext && lastItem ? lastItem.id : undefined, limit },
    };
  }

  async getNote(noteId: string, organizationId: string, userId: string) {
    const note = await this.prisma.forTenant(organizationId).note.findFirst({
      where: {
        id: noteId,
        OR: [{ userId }, { visibility: 'org' }],
      },
      include: {
        user: { select: { id: true, fullName: true } },
        matter: { select: { id: true, title: true } },
      },
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    return note;
  }

  async updateNote(
    noteId: string,
    organizationId: string,
    userId: string,
    dto: UpdateNoteDto,
  ) {
    // Only the note owner can edit
    const note = await this.prisma.forTenant(organizationId).note.findFirst({
      where: { id: noteId, userId },
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    // Verify matter belongs to org if changing
    if (dto.matterId) {
      const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
        where: { id: dto.matterId },
      });
      if (!matter) {
        throw new NotFoundException('Matter not found');
      }
    }

    const data: Prisma.NoteUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.body !== undefined) data.body = dto.body as Prisma.InputJsonValue;
    if (dto.matterId !== undefined) data.matter = dto.matterId ? { connect: { id: dto.matterId } } : { disconnect: true };
    if (dto.visibility !== undefined) data.visibility = dto.visibility;

    return this.prisma.forTenant(organizationId).note.update({
      where: { id: noteId },
      data,
      include: {
        user: { select: { id: true, fullName: true } },
        matter: { select: { id: true, title: true } },
      },
    });
  }

  async deleteNote(noteId: string, organizationId: string, userId: string) {
    const note = await this.prisma.forTenant(organizationId).note.findFirst({
      where: { id: noteId, userId },
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    await this.prisma.forTenant(organizationId).note.delete({ where: { id: noteId } });
  }

  // ==========================================================================
  // ANNOTATIONS
  // ==========================================================================

  async createAnnotation(dto: CreateAnnotationDto, userId: string) {
    // Verify legal document exists
    const docCount = await this.prisma.legalDocument.count({
      where: { id: dto.legalDocumentId },
    });
    if (docCount === 0) {
      throw new NotFoundException('Legal document not found');
    }

    // Verify section if provided
    if (dto.sectionId) {
      const sectionCount = await this.prisma.legalDocumentSection.count({
        where: { id: dto.sectionId, legalDocumentId: dto.legalDocumentId },
      });
      if (sectionCount === 0) {
        throw new NotFoundException('Section not found in this document');
      }
    }

    return this.prisma.annotation.create({
      data: {
        userId,
        legalDocumentId: dto.legalDocumentId,
        sectionId: dto.sectionId,
        textAnchor: dto.textAnchor as Prisma.InputJsonValue,
        annotationText: dto.annotationText?.trim(),
        color: dto.color ?? 'yellow',
      },
    });
  }

  async listAnnotations(
    userId: string,
    legalDocumentId?: string,
  ) {
    const where: Prisma.AnnotationWhereInput = { userId };
    if (legalDocumentId) {
      where.legalDocumentId = legalDocumentId;
    }

    return this.prisma.annotation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        legalDocument: {
          select: { id: true, title: true, shortTitle: true, citationText: true },
        },
        section: {
          select: { id: true, sectionType: true, sectionLabel: true },
        },
      },
    });
  }

  async deleteAnnotation(annotationId: string, userId: string) {
    const annotation = await this.prisma.annotation.findFirst({
      where: { id: annotationId, userId },
    });

    if (!annotation) {
      throw new NotFoundException('Annotation not found');
    }

    await this.prisma.annotation.delete({ where: { id: annotationId } });
  }

  // ==========================================================================
  // TASKS
  // ==========================================================================

  async createTask(
    dto: CreateTaskDto,
    organizationId: string,
    userId: string,
  ) {
    // Verify matter belongs to org if provided
    if (dto.matterId) {
      const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
        where: { id: dto.matterId },
      });
      if (!matter) {
        throw new NotFoundException('Matter not found');
      }
    }

    // Verify assignee is a member of the org if provided
    if (dto.assignedToUserId) {
      const membership = await this.prisma.organizationMember.findFirst({
        where: {
          organizationId,
          userId: dto.assignedToUserId,
          status: 'active',
        },
      });
      if (!membership) {
        throw new BadRequestException('Assigned user is not a member of this organization');
      }
    }

    return this.prisma.task.create({
      data: {
        organizationId,
        createdByUserId: userId,
        assignedToUserId: dto.assignedToUserId,
        matterId: dto.matterId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        priority: dto.priority ?? 'medium',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        matter: { select: { id: true, title: true } },
        _count: { select: { comments: true } },
      },
    });
  }

  async listTasks(organizationId: string, query: ListTasksQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.TaskWhereInput = { organizationId };
    if (query.status) {
      where.status = query.status;
    }
    if (query.priority) {
      where.priority = query.priority;
    }
    if (query.assignedToUserId) {
      where.assignedToUserId = query.assignedToUserId;
    }
    if (query.matterId) {
      where.matterId = query.matterId;
    }
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }
    if (query.dueBefore || query.dueAfter) {
      where.dueDate = {};
      if (query.dueBefore) {
        where.dueDate.lte = new Date(query.dueBefore);
      }
      if (query.dueAfter) {
        where.dueDate.gte = new Date(query.dueAfter);
      }
    }

    const tasks = await this.prisma.task.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: {
        createdBy: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, fullName: true } },
        matter: { select: { id: true, title: true } },
        _count: { select: { comments: true } },
      },
    });

    const hasNext = tasks.length > limit;
    const items = hasNext ? tasks.slice(0, limit) : tasks;
    const lastItem = items[items.length - 1];

    return {
      items,
      meta: { hasNext, nextCursor: hasNext && lastItem ? lastItem.id : undefined, limit },
    };
  }

  async getTask(taskId: string, organizationId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        matter: { select: { id: true, title: true } },
        comments: {
          include: {
            user: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { comments: true } },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  async updateTask(
    taskId: string,
    organizationId: string,
    dto: UpdateTaskDto,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // Verify matter belongs to org if changing
    if (dto.matterId) {
      const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
        where: { id: dto.matterId },
      });
      if (!matter) {
        throw new NotFoundException('Matter not found');
      }
    }

    // Verify assignee is a member of the org if changing
    if (dto.assignedToUserId) {
      const membership = await this.prisma.organizationMember.findFirst({
        where: {
          organizationId,
          userId: dto.assignedToUserId,
          status: 'active',
        },
      });
      if (!membership) {
        throw new BadRequestException('Assigned user is not a member of this organization');
      }
    }

    const data: Prisma.TaskUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() ?? null;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      // Auto-set completedAt when marking done
      if (dto.status === 'done') {
        data.completedAt = new Date();
      } else if (task.completedAt) {
        // Clear completedAt if reverting from done
        data.completedAt = null;
      }
    }
    if (dto.matterId !== undefined) {
      data.matter = dto.matterId ? { connect: { id: dto.matterId } } : { disconnect: true };
    }
    if (dto.assignedToUserId !== undefined) {
      data.assignedTo = dto.assignedToUserId
        ? { connect: { id: dto.assignedToUserId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data,
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        matter: { select: { id: true, title: true } },
        _count: { select: { comments: true } },
      },
    });

    // Emit task_assigned event if assignee changed
    if (
      dto.assignedToUserId &&
      dto.assignedToUserId !== task.assignedToUserId
    ) {
      this.eventEmitter.emit(NOTIFICATION_EVENTS.TASK_ASSIGNED, {
        taskId,
        taskTitle: updated.title,
        assignedToUserId: dto.assignedToUserId,
        assignedByUserId: task.createdByUserId,
        assignedByName: updated.createdBy.fullName,
        organizationId,
      } satisfies TaskAssignedEvent);
    }

    return updated;
  }

  async deleteTask(taskId: string, organizationId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    await this.prisma.task.delete({ where: { id: taskId } });
  }

  // ==========================================================================
  // TASK COMMENTS
  // ==========================================================================

  async createTaskComment(
    taskId: string,
    organizationId: string,
    userId: string,
    dto: CreateTaskCommentDto,
  ) {
    // Verify task belongs to org
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const comment = await this.prisma.taskComment.create({
      data: {
        taskId,
        userId,
        body: dto.body.trim(),
      },
      include: {
        user: { select: { id: true, fullName: true } },
      },
    });

    // Notify task creator + assignee (excluding commenter)
    const notifyUserIds = new Set<string>();
    if (task.createdByUserId !== userId) notifyUserIds.add(task.createdByUserId);
    if (task.assignedToUserId && task.assignedToUserId !== userId) {
      notifyUserIds.add(task.assignedToUserId);
    }

    if (notifyUserIds.size > 0) {
      this.eventEmitter.emit(NOTIFICATION_EVENTS.TASK_COMMENT_ADDED, {
        taskId,
        taskTitle: task.title,
        commentId: comment.id,
        commentBody: dto.body.trim(),
        commentByUserId: userId,
        commentByName: comment.user.fullName,
        notifyUserIds: [...notifyUserIds],
        organizationId,
      } satisfies TaskCommentAddedEvent);
    }

    return comment;
  }

  async listTaskComments(taskId: string, organizationId: string) {
    // Verify task belongs to org
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return this.prisma.taskComment.findMany({
      where: { taskId },
      include: {
        user: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteTaskComment(
    commentId: string,
    organizationId: string,
    userId: string,
  ) {
    // Find the comment and verify ownership + org scope
    const comment = await this.prisma.taskComment.findFirst({
      where: { id: commentId, userId },
      include: { task: { select: { organizationId: true } } },
    });

    if (!comment || comment.task.organizationId !== organizationId) {
      throw new NotFoundException('Comment not found');
    }

    await this.prisma.taskComment.delete({ where: { id: commentId } });
  }

  // ==========================================================================
  // MATTER COMMENTS
  // ==========================================================================

  async createMatterComment(
    matterId: string,
    organizationId: string,
    userId: string,
    dto: CreateMatterCommentDto,
  ) {
    // Verify matter belongs to org
    const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
      where: { id: matterId },
    });
    if (!matter) {
      throw new NotFoundException('Matter not found');
    }

    const comment = await this.prisma.matterComment.create({
      data: {
        matterId,
        userId,
        body: dto.body.trim(),
      },
      include: {
        user: { select: { id: true, fullName: true } },
      },
    });

    // Notify matter owner (excluding commenter)
    if (matter.ownerUserId !== userId) {
      this.eventEmitter.emit(NOTIFICATION_EVENTS.MATTER_COMMENT_ADDED, {
        matterId,
        matterTitle: matter.title,
        commentId: comment.id,
        commentBody: dto.body.trim(),
        commentByUserId: userId,
        commentByName: comment.user.fullName,
        notifyUserIds: [matter.ownerUserId],
        organizationId,
      } satisfies MatterCommentAddedEvent);
    }

    return comment;
  }

  async listMatterComments(matterId: string, organizationId: string) {
    // Verify matter belongs to org
    const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
      where: { id: matterId },
    });
    if (!matter) {
      throw new NotFoundException('Matter not found');
    }

    return this.prisma.matterComment.findMany({
      where: { matterId },
      include: {
        user: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteMatterComment(
    commentId: string,
    organizationId: string,
    userId: string,
  ) {
    // Find the comment and verify ownership + org scope
    const comment = await this.prisma.matterComment.findFirst({
      where: { id: commentId, userId },
      include: { matter: { select: { organizationId: true } } },
    });

    if (!comment || comment.matter.organizationId !== organizationId) {
      throw new NotFoundException('Comment not found');
    }

    await this.prisma.matterComment.delete({ where: { id: commentId } });
  }

  // ==========================================================================
  // ACTIVITY FEED
  // ==========================================================================

  async listActivity(dto: ListActivityQueryDto, organizationId: string) {
    const limit = dto.limit ?? 20;

    const where: Prisma.AuditLogWhereInput = {
      organizationId,
    };

    if (dto.entityType) {
      where.entityType = dto.entityType;
    }
    if (dto.actorUserId) {
      where.actorUserId = dto.actorUserId;
    }

    const entries = await this.prisma.auditLog.findMany({
      take: limit + 1,
      ...(dto.cursor && { skip: 1, cursor: { id: dto.cursor } }),
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    const hasNext = entries.length > limit;
    const data = hasNext ? entries.slice(0, limit) : entries;

    return {
      data: data.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorType: entry.actorType,
        actor: entry.actor
          ? { id: entry.actor.id, fullName: entry.actor.fullName }
          : null,
        metadata: entry.metadataJson as Record<string, unknown> | null,
        createdAt: entry.createdAt.toISOString(),
      })),
      meta: {
        hasNext,
        nextCursor: hasNext && data.length > 0 ? data[data.length - 1]!.id : undefined,
        limit,
      },
    };
  }

  // ==========================================================================
  // WORKSPACE SHARES
  // ==========================================================================

  /**
   * Generate a cryptographically random share token and store its SHA-256 hash.
   * Returns the plaintext token (shown once to user) alongside the share record.
   */
  async createShare(
    dto: CreateShareDto,
    organizationId: string,
    userId: string,
  ): Promise<{ share: Record<string, unknown>; token: string }> {
    // Verify the entity exists and belongs to the org
    await this.verifyShareEntity(dto.entityType, dto.entityId, organizationId);

    // Generate a URL-safe random token (32 bytes = 43 chars base64url)
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    // Hash password if provided (bcrypt cost 10 — lighter than user passwords since share passwords are supplementary)
    let passwordHash: string | undefined;
    if (dto.password) {
      passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const share = await this.prisma.workspaceShare.create({
      data: {
        organizationId,
        createdByUserId: userId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        tokenHash,
        permission: dto.permission ?? 'view',
        passwordHash,
        label: dto.label?.trim(),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    return {
      share: {
        id: share.id,
        entityType: share.entityType,
        entityId: share.entityId,
        permission: share.permission,
        label: share.label,
        isActive: share.isActive,
        isPasswordProtected: !!share.passwordHash,
        expiresAt: share.expiresAt?.toISOString() ?? null,
        accessCount: share.accessCount,
        createdBy: share.createdBy,
        createdAt: share.createdAt.toISOString(),
      },
      token: rawToken,
    };
  }

  async listShares(organizationId: string, query: ListSharesQueryDto) {
    const where: Prisma.WorkspaceShareWhereInput = { organizationId };

    if (query.entityType) {
      where.entityType = query.entityType;
    }
    if (query.entityId) {
      where.entityId = query.entityId;
    }

    const shares = await this.prisma.workspaceShare.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    return shares.map((share) => ({
      id: share.id,
      entityType: share.entityType,
      entityId: share.entityId,
      permission: share.permission,
      label: share.label,
      isActive: share.isActive,
      isPasswordProtected: !!share.passwordHash,
      expiresAt: share.expiresAt?.toISOString() ?? null,
      lastAccessedAt: share.lastAccessedAt?.toISOString() ?? null,
      accessCount: share.accessCount,
      createdBy: share.createdBy,
      createdAt: share.createdAt.toISOString(),
    }));
  }

  async updateShare(
    shareId: string,
    organizationId: string,
    dto: UpdateShareDto,
  ) {
    const share = await this.prisma.workspaceShare.findFirst({
      where: { id: shareId, organizationId },
    });

    if (!share) {
      throw new NotFoundException('Share link not found');
    }

    const data: Prisma.WorkspaceShareUpdateInput = {};
    if (dto.permission !== undefined) data.permission = dto.permission;
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    if (dto.password !== undefined) {
      data.passwordHash = dto.password
        ? await bcrypt.hash(dto.password, 10)
        : null;
    }

    const updated = await this.prisma.workspaceShare.update({
      where: { id: shareId },
      data,
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    return {
      id: updated.id,
      entityType: updated.entityType,
      entityId: updated.entityId,
      permission: updated.permission,
      label: updated.label,
      isActive: updated.isActive,
      isPasswordProtected: !!updated.passwordHash,
      expiresAt: updated.expiresAt?.toISOString() ?? null,
      lastAccessedAt: updated.lastAccessedAt?.toISOString() ?? null,
      accessCount: updated.accessCount,
      createdBy: updated.createdBy,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async revokeShare(shareId: string, organizationId: string) {
    const share = await this.prisma.workspaceShare.findFirst({
      where: { id: shareId, organizationId },
    });

    if (!share) {
      throw new NotFoundException('Share link not found');
    }

    await this.prisma.workspaceShare.delete({ where: { id: shareId } });
  }

  /**
   * Validate a share token and return the shared content.
   * This is called from a public (no auth) endpoint.
   */
  async accessSharedContent(
    token: string,
    password?: string,
  ): Promise<Record<string, unknown>> {
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const share = await this.prisma.workspaceShare.findUnique({
      where: { tokenHash },
    });

    if (!share) {
      throw new NotFoundException('Share link not found or has been revoked');
    }

    // Check active status
    if (!share.isActive) {
      throw new ForbiddenException('This share link has been deactivated');
    }

    // Check expiry
    if (share.expiresAt && share.expiresAt < new Date()) {
      throw new ForbiddenException('This share link has expired');
    }

    // Check password
    if (share.passwordHash) {
      if (!password) {
        // Return a response indicating password is required (without content)
        return {
          requiresPassword: true,
          entityType: share.entityType,
          permission: share.permission,
        };
      }
      const passwordValid = await bcrypt.compare(password, share.passwordHash);
      if (!passwordValid) {
        throw new UnauthorizedException('Invalid password');
      }
    }

    // Update access tracking
    await this.prisma.workspaceShare.update({
      where: { id: share.id },
      data: {
        lastAccessedAt: new Date(),
        accessCount: { increment: 1 },
      },
    });

    // Fetch the shared entity based on type and permission level
    const content = await this.fetchSharedEntity(
      share.entityType,
      share.entityId,
      share.permission,
    );

    return {
      requiresPassword: false,
      entityType: share.entityType,
      permission: share.permission,
      label: share.label,
      data: content,
    };
  }

  // ---- Private helpers for shares ----

  private async verifyShareEntity(
    entityType: string,
    entityId: string,
    organizationId: string,
  ) {
    if (entityType === 'matter') {
      const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
        where: { id: entityId },
      });
      if (!matter) {
        throw new NotFoundException('Matter not found');
      }
      return;
    }

    throw new BadRequestException(`Unsupported entity type: ${entityType}`);
  }

  /**
   * Fetch entity data scoped to the permission level.
   * - view: read-only matter details, documents, notes (titles only)
   * - comment: same as view (commenting handled separately)
   * - edit: full matter details including note bodies
   */
  private async fetchSharedEntity(
    entityType: string,
    entityId: string,
    permission: string,
  ): Promise<Record<string, unknown>> {
    if (entityType === 'matter') {
      return this.fetchSharedMatter(entityId, permission);
    }

    throw new BadRequestException(`Unsupported entity type: ${entityType}`);
  }

  private async fetchSharedMatter(
    matterId: string,
    permission: string,
  ): Promise<Record<string, unknown>> {
    // Intentional cross-tenant: share token resolution. Auth gate is the share record (validated in accessSharedContent), not an org context.
    const matter = await this.prisma.matter.findUnique({
      where: { id: matterId },
      include: {
        owner: { select: { id: true, fullName: true } },
        documents: {
          include: {
            legalDocument: {
              select: { id: true, title: true, shortTitle: true, citationText: true, documentType: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        // For view/comment: only note titles; for edit: include bodies
        notes: {
          select: {
            id: true,
            title: true,
            visibility: true,
            createdAt: true,
            updatedAt: true,
            ...(permission === 'edit' ? { body: true } : {}),
          },
          where: { visibility: 'org' }, // Only org-visible notes in shared view
          orderBy: { updatedAt: 'desc' },
          take: 20,
        },
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            assignedTo: { select: { id: true, fullName: true } },
          },
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
          take: 50,
        },
        _count: { select: { documents: true, notes: true, tasks: true } },
      },
    });

    if (!matter) {
      throw new NotFoundException('Shared matter no longer exists');
    }

    // Strip private uploads from documents for client-safe view
    const safeDocuments = matter.documents
      .filter((doc) => doc.legalDocument !== null)
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        role: doc.role,
        legalDocument: doc.legalDocument,
        createdAt: doc.createdAt.toISOString(),
      }));

    return {
      id: matter.id,
      title: matter.title,
      description: matter.description,
      matterType: matter.matterType,
      court: matter.court,
      status: matter.status,
      owner: matter.owner,
      documents: safeDocuments,
      notes: matter.notes,
      tasks: matter.tasks,
      _count: matter._count,
      createdAt: matter.createdAt.toISOString(),
      updatedAt: matter.updatedAt.toISOString(),
    };
  }
}

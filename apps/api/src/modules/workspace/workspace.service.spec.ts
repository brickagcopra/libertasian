import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from './workspace.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { NOTIFICATION_EVENTS } from '../notifications/notification.events';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let prisma: {
    matter: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    matterDocument: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
    legalDocument: { count: jest.Mock };
    userUpload: { count: jest.Mock };
    note: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    annotation: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
    legalDocumentSection: { count: jest.Mock };
    task: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    organizationMember: { findFirst: jest.Mock };
    taskComment: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
    matterComment: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
    auditLog: { findMany: jest.Mock };
    workspaceShare: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    forTenant: jest.Mock;
  };
  let eventEmitter: {
    emit: jest.Mock;
  };

  const userId = 'user-1';
  const orgId = 'org-1';

  const mockMatter = {
    id: 'matter-1',
    organizationId: orgId,
    ownerUserId: userId,
    title: 'Reyes v. Santos',
    description: 'Contract dispute case',
    matterType: 'civil',
    court: 'RTC Manila',
    status: 'active',
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    owner: { id: userId, fullName: 'Atty. Carlos', email: 'carlos@example.com' },
    _count: { documents: 2, notes: 1 },
  };

  const mockNote = {
    id: 'note-1',
    organizationId: orgId,
    userId,
    matterId: 'matter-1',
    title: 'Research Notes',
    body: { type: 'doc', content: [] },
    visibility: 'private',
    createdAt: new Date(),
    updatedAt: new Date(),
    user: { id: userId, fullName: 'Atty. Carlos' },
    matter: { id: 'matter-1', title: 'Reyes v. Santos' },
  };

  const mockTask = {
    id: 'task-1',
    organizationId: orgId,
    createdByUserId: userId,
    assignedToUserId: 'user-2',
    matterId: 'matter-1',
    title: 'Draft motion',
    description: 'File motion to dismiss',
    priority: 'high',
    status: 'todo',
    dueDate: new Date('2026-04-01'),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: { id: userId, fullName: 'Atty. Carlos', email: 'carlos@example.com' },
    assignedTo: { id: 'user-2', fullName: 'Elena', email: 'elena@example.com' },
    matter: { id: 'matter-1', title: 'Reyes v. Santos' },
    _count: { comments: 0 },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        {
          provide: PrismaService,
          useValue: {
            matter: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            matterDocument: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              delete: jest.fn(),
            },
            legalDocument: {
              count: jest.fn(),
            },
            userUpload: {
              count: jest.fn(),
            },
            note: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            annotation: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              delete: jest.fn(),
            },
            legalDocumentSection: {
              count: jest.fn(),
            },
            task: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            organizationMember: {
              findFirst: jest.fn(),
            },
            taskComment: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              delete: jest.fn(),
            },
            matterComment: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              delete: jest.fn(),
            },
            auditLog: {
              findMany: jest.fn(),
            },
            workspaceShare: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            forTenant: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
    prisma = module.get(PrismaService) as unknown as typeof prisma;
    prisma.forTenant.mockReturnValue(prisma);
    eventEmitter = module.get(EventEmitter2) as unknown as typeof eventEmitter;
  });

  // =========================================================================
  // MATTERS
  // =========================================================================

  describe('createMatter', () => {
    it('should create a matter with trimmed fields', async () => {
      (prisma.matter.create as jest.Mock).mockResolvedValue(mockMatter);

      const result = await service.createMatter(
        { title: '  Reyes v. Santos  ', description: '  Dispute  ', matterType: 'civil', court: ' RTC Manila ' },
        orgId,
        userId,
      );

      expect(result).toEqual(mockMatter);
      expect(prisma.matter.create).toHaveBeenCalledWith({
        data: {
          organizationId: orgId,
          ownerUserId: userId,
          title: 'Reyes v. Santos',
          description: 'Dispute',
          matterType: 'civil',
          court: 'RTC Manila',
        },
      });
    });
  });

  describe('listMatters', () => {
    it('should return paginated matters', async () => {
      const matters = Array.from({ length: 21 }, (_, i) => ({ ...mockMatter, id: `m-${i}` }));
      (prisma.matter.findMany as jest.Mock).mockResolvedValue(matters);

      const result = await service.listMatters(orgId, {});

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('m-19');
    });

    it('should filter by status', async () => {
      (prisma.matter.findMany as jest.Mock).mockResolvedValue([]);

      await service.listMatters(orgId, { status: 'active' });

      expect(prisma.forTenant).toHaveBeenCalledWith(orgId);
      expect(prisma.matter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'active' },
        }),
      );
    });

    it('should filter by search term', async () => {
      (prisma.matter.findMany as jest.Mock).mockResolvedValue([]);

      await service.listMatters(orgId, { search: 'Santos' });

      expect(prisma.matter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            title: { contains: 'Santos', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should support cursor pagination', async () => {
      (prisma.matter.findMany as jest.Mock).mockResolvedValue([]);

      await service.listMatters(orgId, { cursor: 'm-5' });

      expect(prisma.matter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 1, cursor: { id: 'm-5' } }),
      );
    });
  });

  describe('getMatter', () => {
    it('should return matter with includes', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);

      const result = await service.getMatter('matter-1', orgId);

      expect(result).toEqual(mockMatter);
      expect(prisma.forTenant).toHaveBeenCalledWith(orgId);
      expect(prisma.matter.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'matter-1' },
        }),
      );
    });

    it('should throw NotFoundException when matter does not exist', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getMatter('bad-id', orgId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMatter', () => {
    it('should update matter fields', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);
      (prisma.matter.update as jest.Mock).mockResolvedValue({ ...mockMatter, title: 'New Title' });

      await service.updateMatter('matter-1', orgId, { title: '  New Title  ' });

      expect(prisma.matter.update).toHaveBeenCalledWith({
        where: { id: 'matter-1' },
        data: { title: 'New Title' },
      });
    });

    it('should throw NotFoundException for non-existent matter', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateMatter('bad-id', orgId, { title: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteMatter', () => {
    it('should delete matter', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);
      (prisma.matter.delete as jest.Mock).mockResolvedValue(mockMatter);

      await service.deleteMatter('matter-1', orgId);

      expect(prisma.matter.delete).toHaveBeenCalledWith({ where: { id: 'matter-1' } });
    });

    it('should throw NotFoundException for non-existent matter', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteMatter('bad-id', orgId)).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // MATTER DOCUMENTS
  // =========================================================================

  describe('addMatterDocument', () => {
    it('should add a document to a matter', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.matterDocument.create as jest.Mock).mockResolvedValue({
        id: 'md-1',
        matterId: 'matter-1',
        legalDocumentId: 'doc-1',
      });

      await service.addMatterDocument('matter-1', orgId, {
        legalDocumentId: 'doc-1',
        role: 'reference',
      });

      expect(prisma.matterDocument.create).toHaveBeenCalled();
    });

    it('should throw when neither legalDocumentId nor userUploadId provided', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);

      await expect(
        service.addMatterDocument('matter-1', orgId, {} as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when matter not found', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.addMatterDocument('bad-id', orgId, { legalDocumentId: 'doc-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw when referenced legal document not found', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(0);

      await expect(
        service.addMatterDocument('matter-1', orgId, { legalDocumentId: 'bad-doc' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeMatterDocument', () => {
    it('should remove a document from a matter', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);
      (prisma.matterDocument.findFirst as jest.Mock).mockResolvedValue({ id: 'md-1' });
      (prisma.matterDocument.delete as jest.Mock).mockResolvedValue({});

      await service.removeMatterDocument('matter-1', 'md-1', orgId);

      expect(prisma.matterDocument.delete).toHaveBeenCalledWith({ where: { id: 'md-1' } });
    });

    it('should throw when document not in matter', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);
      (prisma.matterDocument.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.removeMatterDocument('matter-1', 'bad-md', orgId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // NOTES
  // =========================================================================

  describe('createNote', () => {
    it('should create a note', async () => {
      (prisma.note.create as jest.Mock).mockResolvedValue(mockNote);

      await service.createNote(
        { title: '  Research  ', body: { type: 'doc', content: [] } },
        orgId,
        userId,
      );

      expect(prisma.note.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId,
          userId,
          title: 'Research',
          visibility: 'private',
        }),
      });
    });

    it('should verify matter exists if matterId provided', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createNote({ title: 'Note', matterId: 'bad-matter' } as CreateNoteDto, orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getNote', () => {
    it('should return note when user is owner', async () => {
      (prisma.note.findFirst as jest.Mock).mockResolvedValue(mockNote);

      const result = await service.getNote('note-1', orgId, userId);

      expect(result).toEqual(mockNote);
    });

    it('should throw NotFoundException when note not accessible', async () => {
      (prisma.note.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getNote('bad-id', orgId, userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateNote', () => {
    it('should update note owned by user', async () => {
      (prisma.note.findFirst as jest.Mock).mockResolvedValue(mockNote);
      (prisma.note.update as jest.Mock).mockResolvedValue({ ...mockNote, title: 'Updated' });

      await service.updateNote('note-1', orgId, userId, { title: '  Updated  ' });

      expect(prisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'note-1' },
          data: { title: 'Updated' },
        }),
      );
    });

    it('should throw NotFoundException for non-owned note', async () => {
      (prisma.note.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateNote('note-1', orgId, 'other-user', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteNote', () => {
    it('should delete note owned by user', async () => {
      (prisma.note.findFirst as jest.Mock).mockResolvedValue(mockNote);
      (prisma.note.delete as jest.Mock).mockResolvedValue(mockNote);

      await service.deleteNote('note-1', orgId, userId);

      expect(prisma.note.delete).toHaveBeenCalledWith({ where: { id: 'note-1' } });
    });
  });

  // =========================================================================
  // ANNOTATIONS
  // =========================================================================

  describe('createAnnotation', () => {
    it('should create annotation', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.annotation.create as jest.Mock).mockResolvedValue({ id: 'ann-1' });

      await service.createAnnotation(
        {
          legalDocumentId: 'doc-1',
          textAnchor: { start_offset: 0, end_offset: 50, anchor_text: 'test' },
          annotationText: '  Highlight  ',
          color: 'blue',
        },
        userId,
      );

      expect(prisma.annotation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          legalDocumentId: 'doc-1',
          annotationText: 'Highlight',
          color: 'blue',
        }),
      });
    });

    it('should throw when legal document not found', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(0);

      await expect(
        service.createAnnotation(
          { legalDocumentId: 'bad-doc', textAnchor: {} },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should verify section belongs to document', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocumentSection.count as jest.Mock).mockResolvedValue(0);

      await expect(
        service.createAnnotation(
          { legalDocumentId: 'doc-1', sectionId: 'bad-section', textAnchor: {} },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should default color to yellow', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.annotation.create as jest.Mock).mockResolvedValue({ id: 'ann-1' });

      await service.createAnnotation(
        { legalDocumentId: 'doc-1', textAnchor: {} },
        userId,
      );

      expect(prisma.annotation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ color: 'yellow' }),
      });
    });
  });

  describe('deleteAnnotation', () => {
    it('should delete annotation owned by user', async () => {
      (prisma.annotation.findFirst as jest.Mock).mockResolvedValue({ id: 'ann-1', userId });
      (prisma.annotation.delete as jest.Mock).mockResolvedValue({});

      await service.deleteAnnotation('ann-1', userId);

      expect(prisma.annotation.delete).toHaveBeenCalledWith({ where: { id: 'ann-1' } });
    });

    it('should throw when annotation not found', async () => {
      (prisma.annotation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteAnnotation('bad-id', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // TASKS
  // =========================================================================

  describe('createTask', () => {
    it('should create a task with trimmed fields', async () => {
      (prisma.task.create as jest.Mock).mockResolvedValue(mockTask);

      await service.createTask(
        { title: '  Draft motion  ', description: '  File motion  ', priority: 'high' },
        orgId,
        userId,
      );

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: orgId,
            createdByUserId: userId,
            title: 'Draft motion',
            description: 'File motion',
            priority: 'high',
          }),
        }),
      );
    });

    it('should verify matter exists if provided', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createTask(
          { title: 'Task', matterId: 'bad-matter' },
          orgId,
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should verify assignee is org member', async () => {
      (prisma.organizationMember.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createTask(
          { title: 'Task', assignedToUserId: 'non-member' },
          orgId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listTasks', () => {
    it('should return paginated tasks', async () => {
      const tasks = Array.from({ length: 21 }, (_, i) => ({ ...mockTask, id: `t-${i}` }));
      (prisma.task.findMany as jest.Mock).mockResolvedValue(tasks);

      const result = await service.listTasks(orgId, {});

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
    });

    it('should filter by status', async () => {
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);

      await service.listTasks(orgId, { status: 'done' });

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'done' }),
        }),
      );
    });

    it('should filter by priority', async () => {
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);

      await service.listTasks(orgId, { priority: 'high' });

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ priority: 'high' }),
        }),
      );
    });

    it('should filter by due date range', async () => {
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);

      await service.listTasks(orgId, { dueBefore: '2026-04-01', dueAfter: '2026-03-01' });

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dueDate: {
              lte: expect.any(Date),
              gte: expect.any(Date),
            },
          }),
        }),
      );
    });
  });

  describe('getTask', () => {
    it('should return task with includes', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask);

      const result = await service.getTask('task-1', orgId);

      expect(result).toEqual(mockTask);
    });

    it('should throw NotFoundException', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getTask('bad-id', orgId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTask', () => {
    it('should update task and set completedAt when status is done', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask);
      (prisma.task.update as jest.Mock).mockResolvedValue({ ...mockTask, status: 'done' });

      await service.updateTask('task-1', orgId, { status: 'done' });

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'done',
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should emit TASK_ASSIGNED event when assignee changes', async () => {
      const taskWithOldAssignee = { ...mockTask, assignedToUserId: 'user-2' };
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(taskWithOldAssignee);
      (prisma.organizationMember.findFirst as jest.Mock).mockResolvedValue({ id: 'member-1' });
      (prisma.task.update as jest.Mock).mockResolvedValue({
        ...mockTask,
        assignedToUserId: 'user-3',
      });

      await service.updateTask('task-1', orgId, { assignedToUserId: 'user-3' });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.TASK_ASSIGNED,
        expect.objectContaining({
          taskId: 'task-1',
          assignedToUserId: 'user-3',
          organizationId: orgId,
        }),
      );
    });

    it('should not emit event when assignee stays the same', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask);
      (prisma.task.update as jest.Mock).mockResolvedValue(mockTask);

      await service.updateTask('task-1', orgId, { title: 'Updated' });

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should throw when task not found', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateTask('bad-id', orgId, { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteTask', () => {
    it('should delete task', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask);
      (prisma.task.delete as jest.Mock).mockResolvedValue(mockTask);

      await service.deleteTask('task-1', orgId);

      expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: 'task-1' } });
    });
  });

  // =========================================================================
  // TASK COMMENTS
  // =========================================================================

  describe('createTaskComment', () => {
    it('should create comment and emit notification event', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(mockTask);
      (prisma.taskComment.create as jest.Mock).mockResolvedValue({
        id: 'tc-1',
        body: 'Great work',
        user: { id: userId, fullName: 'Atty. Carlos' },
      });

      await service.createTaskComment(
        'task-1',
        orgId,
        userId,
        { body: '  Great work  ' },
      );

      expect(prisma.taskComment.create).toHaveBeenCalledWith({
        data: { taskId: 'task-1', userId, body: 'Great work' },
        include: expect.any(Object),
      });
      // Task creator is the commenter, but task has assignee user-2
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.TASK_COMMENT_ADDED,
        expect.objectContaining({
          taskId: 'task-1',
          notifyUserIds: ['user-2'],
        }),
      );
    });

    it('should not emit notification when commenter is both creator and assignee', async () => {
      const selfTask = { ...mockTask, createdByUserId: userId, assignedToUserId: userId };
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(selfTask);
      (prisma.taskComment.create as jest.Mock).mockResolvedValue({
        id: 'tc-1',
        body: 'self',
        user: { id: userId, fullName: 'Test' },
      });

      await service.createTaskComment('task-1', orgId, userId, { body: 'self' });

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should throw when task not found', async () => {
      (prisma.task.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createTaskComment('bad-id', orgId, userId, { body: 'text' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteTaskComment', () => {
    it('should delete comment owned by user', async () => {
      (prisma.taskComment.findFirst as jest.Mock).mockResolvedValue({
        id: 'tc-1',
        userId,
        task: { organizationId: orgId },
      });
      (prisma.taskComment.delete as jest.Mock).mockResolvedValue({});

      await service.deleteTaskComment('tc-1', orgId, userId);

      expect(prisma.taskComment.delete).toHaveBeenCalledWith({ where: { id: 'tc-1' } });
    });

    it('should throw when comment not found or wrong org', async () => {
      (prisma.taskComment.findFirst as jest.Mock).mockResolvedValue({
        id: 'tc-1',
        userId,
        task: { organizationId: 'other-org' },
      });

      await expect(
        service.deleteTaskComment('tc-1', orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // MATTER COMMENTS
  // =========================================================================

  describe('createMatterComment', () => {
    it('should create comment and emit notification to matter owner', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);
      (prisma.matterComment.create as jest.Mock).mockResolvedValue({
        id: 'mc-1',
        body: 'Update needed',
        user: { id: 'user-2', fullName: 'Elena' },
      });

      await service.createMatterComment(
        'matter-1',
        orgId,
        'user-2', // not the matter owner
        { body: '  Update needed  ' },
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        NOTIFICATION_EVENTS.MATTER_COMMENT_ADDED,
        expect.objectContaining({
          matterId: 'matter-1',
          notifyUserIds: [userId], // matter owner
        }),
      );
    });

    it('should not emit notification when commenter is the matter owner', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);
      (prisma.matterComment.create as jest.Mock).mockResolvedValue({
        id: 'mc-1',
        body: 'self',
        user: { id: userId, fullName: 'Carlos' },
      });

      await service.createMatterComment('matter-1', orgId, userId, { body: 'self' });

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // ACTIVITY FEED
  // =========================================================================

  describe('listActivity', () => {
    it('should return paginated audit log entries', async () => {
      const entries = Array.from({ length: 21 }, (_, i) => ({
        id: `al-${i}`,
        action: 'create',
        entityType: 'matter',
        entityId: 'matter-1',
        actorType: 'user',
        actor: { id: userId, fullName: 'Carlos', email: 'c@ex.com' },
        metadataJson: {},
        createdAt: new Date(),
      }));
      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue(entries);

      const result = await service.listActivity({}, orgId);

      expect(result.data).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
    });

    it('should filter by entityType', async () => {
      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);

      await service.listActivity({ entityType: 'task' }, orgId);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entityType: 'task' }),
        }),
      );
    });
  });

  // =========================================================================
  // WORKSPACE SHARES
  // =========================================================================

  describe('createShare', () => {
    it('should create share with hashed token', async () => {
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(mockMatter);
      (prisma.workspaceShare.create as jest.Mock).mockResolvedValue({
        id: 'share-1',
        entityType: 'matter',
        entityId: 'matter-1',
        permission: 'view',
        label: 'Client share',
        isActive: true,
        passwordHash: null,
        expiresAt: null,
        accessCount: 0,
        createdBy: { id: userId, fullName: 'Carlos' },
        createdAt: new Date(),
      });

      const result = await service.createShare(
        { entityType: 'matter', entityId: 'matter-1', label: '  Client share  ' },
        orgId,
        userId,
      );

      expect(result.token).toBeDefined();
      expect(result.token.length).toBeGreaterThan(20);
      expect(result.share['isPasswordProtected']).toBe(false);
      expect(prisma.workspaceShare.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: orgId,
            createdByUserId: userId,
            entityType: 'matter',
            entityId: 'matter-1',
            tokenHash: expect.any(String),
            permission: 'view',
            label: 'Client share',
          }),
        }),
      );
    });

    it('should throw when entity type is unsupported', async () => {
      await expect(
        service.createShare(
          { entityType: 'unknown', entityId: 'x' },
          orgId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('accessSharedContent', () => {
    const mockShare = {
      id: 'share-1',
      entityType: 'matter',
      entityId: 'matter-1',
      permission: 'view',
      label: 'Test',
      isActive: true,
      passwordHash: null,
      expiresAt: null,
      accessCount: 0,
    };

    it('should return shared content for valid token', async () => {
      (prisma.workspaceShare.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockShare) // first call: tokenHash lookup
        .mockResolvedValueOnce(null); // fallback
      (prisma.workspaceShare.update as jest.Mock).mockResolvedValue({});
      (prisma.matter.findUnique as jest.Mock).mockResolvedValue({
        ...mockMatter,
        documents: [],
        notes: [],
        tasks: [],
        _count: { documents: 0, notes: 0, tasks: 0 },
      });

      const result = await service.accessSharedContent('valid-token');

      expect(result['requiresPassword']).toBe(false);
      expect(result['entityType']).toBe('matter');
    });

    it('should throw NotFoundException for invalid token', async () => {
      (prisma.workspaceShare.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.accessSharedContent('bad-token')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for inactive share', async () => {
      (prisma.workspaceShare.findUnique as jest.Mock).mockResolvedValue({
        ...mockShare,
        isActive: false,
      });

      await expect(service.accessSharedContent('token')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException for expired share', async () => {
      (prisma.workspaceShare.findUnique as jest.Mock).mockResolvedValue({
        ...mockShare,
        expiresAt: new Date('2020-01-01'),
      });

      await expect(service.accessSharedContent('token')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should return requiresPassword when password needed but not provided', async () => {
      (prisma.workspaceShare.findUnique as jest.Mock).mockResolvedValue({
        ...mockShare,
        passwordHash: '$2b$10$hashedpass',
      });

      const result = await service.accessSharedContent('token');

      expect(result['requiresPassword']).toBe(true);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      (prisma.workspaceShare.findUnique as jest.Mock).mockResolvedValue({
        ...mockShare,
        passwordHash: '$2b$10$invalidhash', // bcrypt compare will fail
      });

      await expect(
        service.accessSharedContent('token', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('revokeShare', () => {
    it('should delete the share', async () => {
      (prisma.workspaceShare.findFirst as jest.Mock).mockResolvedValue({ id: 'share-1' });
      (prisma.workspaceShare.delete as jest.Mock).mockResolvedValue({});

      await service.revokeShare('share-1', orgId);

      expect(prisma.workspaceShare.delete).toHaveBeenCalledWith({
        where: { id: 'share-1' },
      });
    });

    it('should throw NotFoundException for non-existent share', async () => {
      (prisma.workspaceShare.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.revokeShare('bad-id', orgId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

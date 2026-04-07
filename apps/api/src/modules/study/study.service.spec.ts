import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { StudyService } from './study.service';

describe('StudyService', () => {
  let service: StudyService;
  let prisma: jest.Mocked<PrismaService>;

  const userId = 'user-1';
  const orgId = 'org-1';

  const mockFlashcardSet = {
    id: 'fcs-1',
    organizationId: orgId,
    userId,
    title: 'Civil Law Review',
    description: 'Key concepts',
    barSubject: 'civil',
    topic: 'Obligations',
    visibility: 'private',
    cardCount: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { flashcards: 5 },
  };

  const mockFlashcard = {
    id: 'fc-1',
    flashcardSetId: 'fcs-1',
    front: 'What is an obligation?',
    back: 'A juridical necessity...',
    legalDocumentId: null,
    sectionId: null,
    digestId: null,
    sourceType: 'manual',
    ordering: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    flashcardSet: { userId, organizationId: orgId, visibility: 'private' },
  };

  const mockReviewerPack = {
    id: 'rp-1',
    organizationId: orgId,
    creatorUserId: userId,
    title: 'Civil Law Pack',
    description: 'Study materials',
    barSubject: 'civil',
    topic: 'Contracts',
    visibility: 'private',
    itemCount: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    creator: { id: userId, fullName: 'Maria' },
    _count: { items: 3 },
  };

  const mockBarTag = {
    id: 'tag-1',
    code: 'civil',
    name: 'Civil Law',
    tagType: 'bar_subject',
    _count: { documentTags: 42 },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudyService,
        {
          provide: PrismaService,
          useValue: {
            legalMetadataTag: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            legalDocument: {
              findMany: jest.fn(),
              count: jest.fn(),
            },
            flashcardSet: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            flashcard: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              aggregate: jest.fn(),
            },
            reviewerPack: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            reviewerPackItem: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            studyProgress: {
              upsert: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
            barSyllabus: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            syllabusTopic: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            syllabusTopicResource: {
              create: jest.fn(),
              findUnique: jest.fn(),
              delete: jest.fn(),
            },
            flashcardReview: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              groupBy: jest.fn(),
            },
            studySession: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
              aggregate: jest.fn(),
              groupBy: jest.fn(),
            },
            studyStreak: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            legalDocumentSection: {
              count: jest.fn(),
            },
            digest: {
              count: jest.fn(),
            },
            $transaction: jest.fn((fns: unknown[]) => Promise.all(fns)),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              if (key === 'RAG_SERVICE_URL') return 'http://localhost:8000';
              return fallback;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StudyService>(StudyService);
    prisma = module.get(PrismaService);
  });

  // =========================================================================
  // Codal Reader
  // =========================================================================

  describe('listBarSubjects', () => {
    it('should return bar subjects with document counts', async () => {
      (prisma.legalMetadataTag.findMany as jest.Mock).mockResolvedValue([
        mockBarTag,
        { ...mockBarTag, id: 'tag-2', code: 'criminal', name: 'Criminal Law', _count: { documentTags: 10 } },
      ]);

      const result = await service.listBarSubjects();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ code: 'civil', name: 'Civil Law', documentCount: 42 });
    });
  });

  describe('listCodalsBySubject', () => {
    it('should return paginated documents for a bar subject', async () => {
      (prisma.legalMetadataTag.findFirst as jest.Mock).mockResolvedValue(mockBarTag);
      const docs = Array.from({ length: 21 }, (_, i) => ({
        id: `doc-${i}`,
        title: `Law ${i}`,
        shortTitle: null,
        documentType: 'statute',
        citationText: null,
        promulgationDate: null,
        isOfficial: true,
        _count: { sections: 5 },
      }));
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue(docs);

      const result = await service.listCodalsBySubject('civil', {});

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.subject).toBe('Civil Law');
    });

    it('should throw NotFoundException for unknown subject', async () => {
      (prisma.legalMetadataTag.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.listCodalsBySubject('unknown', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should filter by document type and search', async () => {
      (prisma.legalMetadataTag.findFirst as jest.Mock).mockResolvedValue(mockBarTag);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue([]);

      await service.listCodalsBySubject('civil', { documentType: 'statute', search: 'Code' });

      expect(prisma.legalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            documentType: 'statute',
            OR: expect.arrayContaining([
              expect.objectContaining({ title: { contains: 'Code', mode: 'insensitive' } }),
            ]),
          }),
        }),
      );
    });
  });

  // =========================================================================
  // Flashcard Sets
  // =========================================================================

  describe('createFlashcardSet', () => {
    it('should create a flashcard set with trimmed fields', async () => {
      (prisma.flashcardSet.create as jest.Mock).mockResolvedValue(mockFlashcardSet);

      await service.createFlashcardSet(
        { title: '  Civil Law Review  ', description: '  Key concepts  ', barSubject: 'civil' },
        userId,
        orgId,
      );

      expect(prisma.flashcardSet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId,
          userId,
          title: 'Civil Law Review',
          description: 'Key concepts',
          visibility: 'private',
        }),
      });
    });
  });

  describe('listFlashcardSets', () => {
    it('should return paginated sets with visibility filtering', async () => {
      const sets = Array.from({ length: 21 }, (_, i) => ({ ...mockFlashcardSet, id: `fcs-${i}` }));
      (prisma.flashcardSet.findMany as jest.Mock).mockResolvedValue(sets);

      const result = await service.listFlashcardSets(userId, orgId, {});

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
    });

    it('should filter by barSubject', async () => {
      (prisma.flashcardSet.findMany as jest.Mock).mockResolvedValue([]);

      await service.listFlashcardSets(userId, orgId, { barSubject: 'criminal' });

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ barSubject: 'criminal' }),
        }),
      );
    });
  });

  describe('getFlashcardSet', () => {
    it('should return set when user has access (private + owner)', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue(mockFlashcardSet);

      const result = await service.getFlashcardSet('fcs-1', userId, orgId);

      expect(result).toEqual(mockFlashcardSet);
    });

    it('should throw NotFoundException when set does not exist', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getFlashcardSet('bad-id', userId, orgId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when user lacks access', async () => {
      const otherSet = { ...mockFlashcardSet, userId: 'other-user', visibility: 'private' };
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue(otherSet);

      await expect(
        service.getFlashcardSet('fcs-1', userId, orgId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow access to public_editorial sets', async () => {
      const publicSet = { ...mockFlashcardSet, userId: 'other-user', visibility: 'public_editorial' };
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue(publicSet);

      const result = await service.getFlashcardSet('fcs-1', userId, orgId);

      expect(result).toEqual(publicSet);
    });
  });

  describe('updateFlashcardSet', () => {
    it('should update set owned by user', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue(mockFlashcardSet);
      (prisma.flashcardSet.update as jest.Mock).mockResolvedValue({ ...mockFlashcardSet, title: 'Updated' });

      await service.updateFlashcardSet('fcs-1', { title: '  Updated  ' }, userId, orgId);

      expect(prisma.flashcardSet.update).toHaveBeenCalledWith({
        where: { id: 'fcs-1' },
        data: { title: 'Updated' },
      });
    });

    it('should throw ForbiddenException when not set creator', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlashcardSet,
        userId: 'other-user',
        visibility: 'org',
        organizationId: orgId,
      });

      await expect(
        service.updateFlashcardSet('fcs-1', { title: 'x' }, userId, orgId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteFlashcardSet', () => {
    it('should delete set owned by user', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue(mockFlashcardSet);
      (prisma.flashcardSet.delete as jest.Mock).mockResolvedValue(mockFlashcardSet);

      await service.deleteFlashcardSet('fcs-1', userId, orgId);

      expect(prisma.flashcardSet.delete).toHaveBeenCalledWith({ where: { id: 'fcs-1' } });
    });

    it('should throw ForbiddenException when not set creator', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlashcardSet,
        userId: 'other-user',
        visibility: 'org',
        organizationId: orgId,
      });

      await expect(
        service.deleteFlashcardSet('fcs-1', userId, orgId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // Flashcards
  // =========================================================================

  describe('addFlashcard', () => {
    it('should add a flashcard to a set via transaction', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue(mockFlashcardSet);
      (prisma.$transaction as jest.Mock).mockResolvedValue([mockFlashcard, {}]);

      const result = await service.addFlashcard(
        'fcs-1',
        { front: '  Q  ', back: '  A  ' },
        userId,
        orgId,
      );

      expect(result).toEqual(mockFlashcard);
    });

    it('should throw ForbiddenException when not set creator', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlashcardSet,
        userId: 'other-user',
      });

      await expect(
        service.addFlashcard('fcs-1', { front: 'Q', back: 'A' }, userId, orgId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateFlashcard', () => {
    it('should update flashcard when user is set creator', async () => {
      (prisma.flashcard.findUnique as jest.Mock).mockResolvedValue(mockFlashcard);
      (prisma.flashcard.update as jest.Mock).mockResolvedValue({ ...mockFlashcard, front: 'Updated Q' });

      await service.updateFlashcard('fc-1', { front: '  Updated Q  ' }, userId);

      expect(prisma.flashcard.update).toHaveBeenCalledWith({
        where: { id: 'fc-1' },
        data: { front: 'Updated Q' },
      });
    });

    it('should throw ForbiddenException when not set creator', async () => {
      (prisma.flashcard.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlashcard,
        flashcardSet: { userId: 'other-user' },
      });

      await expect(
        service.updateFlashcard('fc-1', { front: 'x' }, userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteFlashcard', () => {
    it('should delete flashcard and decrement card count', async () => {
      (prisma.flashcard.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlashcard,
        flashcardSetId: 'fcs-1',
        flashcardSet: { id: 'fcs-1', userId },
      });
      (prisma.$transaction as jest.Mock).mockResolvedValue([{}, {}]);

      await service.deleteFlashcard('fc-1', userId);

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // AI Flashcard Generation
  // =========================================================================

  describe('generateAiFlashcards', () => {
    it('should throw ForbiddenException when not set creator', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlashcardSet,
        userId: 'other-user',
      });

      await expect(
        service.generateAiFlashcards(
          'fcs-1',
          { topic: 'Obligations' },
          userId,
          orgId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when set not found', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.generateAiFlashcards('bad-id', { topic: 'x' }, userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // Reviewer Packs
  // =========================================================================

  describe('createReviewerPack', () => {
    it('should create a reviewer pack', async () => {
      (prisma.reviewerPack.create as jest.Mock).mockResolvedValue(mockReviewerPack);

      await service.createReviewerPack(
        { title: '  Civil Law Pack  ', barSubject: 'civil' },
        userId,
        orgId,
      );

      expect(prisma.reviewerPack.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Civil Law Pack',
          creatorUserId: userId,
          visibility: 'private',
        }),
      });
    });
  });

  describe('getReviewerPack', () => {
    it('should return pack when user has access', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValue({
        ...mockReviewerPack,
        items: [],
      });

      const result = await service.getReviewerPack('rp-1', userId, orgId);

      expect(result.title).toBe('Civil Law Pack');
    });

    it('should throw NotFoundException when pack does not exist', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getReviewerPack('bad-id', userId, orgId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when user lacks access', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValue({
        ...mockReviewerPack,
        creatorUserId: 'other-user',
        visibility: 'private',
        items: [],
      });

      await expect(
        service.getReviewerPack('rp-1', userId, orgId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteReviewerPack', () => {
    it('should delete pack owned by user', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValue(mockReviewerPack);
      (prisma.reviewerPack.delete as jest.Mock).mockResolvedValue(mockReviewerPack);

      await service.deleteReviewerPack('rp-1', userId, orgId);

      expect(prisma.reviewerPack.delete).toHaveBeenCalledWith({ where: { id: 'rp-1' } });
    });

    it('should throw ForbiddenException when not pack creator', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValue({
        ...mockReviewerPack,
        creatorUserId: 'other-user',
        visibility: 'org',
        organizationId: orgId,
      });

      await expect(
        service.deleteReviewerPack('rp-1', userId, orgId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // Reviewer Pack Items
  // =========================================================================

  describe('addReviewerPackItem', () => {
    it('should add item to pack', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValue(mockReviewerPack);
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.$transaction as jest.Mock).mockResolvedValue([{ id: 'rpi-1' }, {}]);

      const result = await service.addReviewerPackItem(
        'rp-1',
        { itemType: 'legal_document', legalDocumentId: 'doc-1' },
        userId,
        orgId,
      );

      expect(result).toEqual({ id: 'rpi-1' });
    });

    it('should throw ForbiddenException when not pack creator', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValue({
        ...mockReviewerPack,
        creatorUserId: 'other-user',
      });

      await expect(
        service.addReviewerPackItem(
          'rp-1',
          { itemType: 'legal_document', legalDocumentId: 'doc-1' },
          userId,
          orgId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException for non-existent reference', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValue(mockReviewerPack);
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(0);

      await expect(
        service.addReviewerPackItem(
          'rp-1',
          { itemType: 'legal_document', legalDocumentId: 'bad-doc' },
          userId,
          orgId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // Study Progress
  // =========================================================================

  describe('upsertProgress', () => {
    it('should upsert study progress', async () => {
      (prisma.studyProgress.upsert as jest.Mock).mockResolvedValue({
        userId,
        entityType: 'legal_document',
        entityId: 'doc-1',
        status: 'in_progress',
        progressPct: 50,
      });

      const result = await service.upsertProgress(
        userId,
        'legal_document',
        'doc-1',
        { status: 'in_progress', progressPct: 50 },
      );

      expect(result.status).toBe('in_progress');
      expect(prisma.studyProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_entityType_entityId: { userId, entityType: 'legal_document', entityId: 'doc-1' },
          },
          create: expect.objectContaining({ status: 'in_progress', progressPct: 50 }),
          update: expect.objectContaining({ status: 'in_progress', progressPct: 50 }),
        }),
      );
    });

    it('should set completedAt when status is completed', async () => {
      (prisma.studyProgress.upsert as jest.Mock).mockResolvedValue({});

      await service.upsertProgress(userId, 'legal_document', 'doc-1', {
        status: 'completed',
      });

      expect(prisma.studyProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ completedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('getProgress', () => {
    it('should return progress for entity', async () => {
      (prisma.studyProgress.findUnique as jest.Mock).mockResolvedValue({
        userId,
        entityType: 'legal_document',
        entityId: 'doc-1',
        status: 'completed',
      });

      const result = await service.getProgress(userId, 'legal_document', 'doc-1');

      expect(result.status).toBe('completed');
    });

    it('should throw NotFoundException when not found', async () => {
      (prisma.studyProgress.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getProgress(userId, 'legal_document', 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // Syllabus
  // =========================================================================

  describe('listSyllabi', () => {
    it('should list active syllabi by default', async () => {
      (prisma.barSyllabus.findMany as jest.Mock).mockResolvedValue([]);

      await service.listSyllabi({});

      expect(prisma.barSyllabus.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        }),
      );
    });

    it('should list all syllabi when activeOnly is false', async () => {
      (prisma.barSyllabus.findMany as jest.Mock).mockResolvedValue([]);

      await service.listSyllabi({ activeOnly: false });

      expect(prisma.barSyllabus.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('getSyllabus', () => {
    it('should return syllabus with topics', async () => {
      (prisma.barSyllabus.findUnique as jest.Mock).mockResolvedValue({
        id: 'syl-1',
        title: 'Civil Law',
        topics: [],
      });

      const result = await service.getSyllabus('syl-1');

      expect(result.title).toBe('Civil Law');
    });

    it('should throw NotFoundException when not found', async () => {
      (prisma.barSyllabus.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getSyllabus('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSyllabusBySubject', () => {
    it('should return syllabus by bar subject code', async () => {
      (prisma.barSyllabus.findUnique as jest.Mock).mockResolvedValue({
        id: 'syl-1',
        barSubjectCode: 'civil',
        topics: [],
      });

      const result = await service.getSyllabusBySubject('civil');

      expect(result.barSubjectCode).toBe('civil');
    });

    it('should throw NotFoundException for unknown subject', async () => {
      (prisma.barSyllabus.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getSyllabusBySubject('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getSyllabusProgress', () => {
    it('should compute overall progress correctly', async () => {
      (prisma.syllabusTopic.findMany as jest.Mock).mockResolvedValue([
        { id: 't-1', parentTopicId: null, depth: 0 },
        { id: 't-2', parentTopicId: null, depth: 0 },
        { id: 't-3', parentTopicId: null, depth: 0 },
        { id: 't-4', parentTopicId: null, depth: 0 },
      ]);
      (prisma.studyProgress.findMany as jest.Mock).mockResolvedValue([
        { entityId: 't-1', status: 'completed', progressPct: 100 },
        { entityId: 't-2', status: 'in_progress', progressPct: 50 },
      ]);

      const result = await service.getSyllabusProgress('syl-1', userId);

      expect(result.totalTopics).toBe(4);
      expect(result.completedCount).toBe(1);
      expect(result.inProgressCount).toBe(1);
      expect(result.notStartedCount).toBe(2);
      expect(result.overallPct).toBe(25); // 1/4 = 25%
    });
  });

  describe('upsertSyllabusTopicProgress', () => {
    it('should verify topic exists before upserting', async () => {
      (prisma.syllabusTopic.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.upsertSyllabusTopicProgress('bad-topic', { status: 'completed' }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should delegate to upsertProgress', async () => {
      (prisma.syllabusTopic.findUnique as jest.Mock).mockResolvedValue({ id: 't-1' });
      (prisma.studyProgress.upsert as jest.Mock).mockResolvedValue({});

      await service.upsertSyllabusTopicProgress(
        't-1',
        { status: 'completed', progressPct: 100 },
        userId,
      );

      expect(prisma.studyProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_entityType_entityId: {
              userId,
              entityType: 'syllabus_topic',
              entityId: 't-1',
            },
          },
        }),
      );
    });
  });

  describe('getBarExamReadiness', () => {
    it('should compute overall readiness across all syllabi', async () => {
      (prisma.barSyllabus.findMany as jest.Mock).mockResolvedValue([
        { id: 'syl-1', barSubjectCode: 'civil', title: 'Civil', _count: { topics: 2 } },
        { id: 'syl-2', barSubjectCode: 'criminal', title: 'Criminal', _count: { topics: 2 } },
      ]);
      (prisma.syllabusTopic.findMany as jest.Mock).mockResolvedValue([
        { id: 't-1', syllabusId: 'syl-1' },
        { id: 't-2', syllabusId: 'syl-1' },
        { id: 't-3', syllabusId: 'syl-2' },
        { id: 't-4', syllabusId: 'syl-2' },
      ]);
      (prisma.studyProgress.findMany as jest.Mock).mockResolvedValue([
        { entityId: 't-1', status: 'completed' },
        { entityId: 't-3', status: 'completed' },
      ]);

      const result = await service.getBarExamReadiness(userId);

      expect(result.totalTopics).toBe(4);
      expect(result.completedTopics).toBe(2);
      expect(result.overallPct).toBe(50);
      expect(result.subjects).toHaveLength(2);
      expect(result.subjects[0]!.pct).toBe(50);
    });
  });

  // =========================================================================
  // Syllabus Admin CRUD
  // =========================================================================

  describe('createSyllabusTopic', () => {
    it('should create topic and increment syllabus topic count', async () => {
      (prisma.barSyllabus.findUnique as jest.Mock).mockResolvedValue({ id: 'syl-1' });
      (prisma.syllabusTopic.create as jest.Mock).mockResolvedValue({ id: 'topic-1' });
      (prisma.barSyllabus.update as jest.Mock).mockResolvedValue({});

      await service.createSyllabusTopic({
        syllabusId: 'syl-1',
        slug: '  obligations  ',
        title: '  Obligations  ',
      });

      expect(prisma.syllabusTopic.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          slug: 'obligations',
          title: 'Obligations',
        }),
      });
      expect(prisma.barSyllabus.update).toHaveBeenCalledWith({
        where: { id: 'syl-1' },
        data: { topicCount: { increment: 1 } },
      });
    });

    it('should throw when syllabus not found', async () => {
      (prisma.barSyllabus.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createSyllabusTopic({ syllabusId: 'bad', slug: 'x', title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw when parent topic not found', async () => {
      (prisma.barSyllabus.findUnique as jest.Mock).mockResolvedValue({ id: 'syl-1' });
      (prisma.syllabusTopic.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createSyllabusTopic({
          syllabusId: 'syl-1',
          parentTopicId: 'bad-parent',
          slug: 'x',
          title: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteSyllabusTopic', () => {
    it('should delete topic and decrement syllabus count', async () => {
      (prisma.syllabusTopic.findUnique as jest.Mock).mockResolvedValue({
        id: 'topic-1',
        syllabusId: 'syl-1',
      });
      (prisma.syllabusTopic.delete as jest.Mock).mockResolvedValue({});
      (prisma.barSyllabus.update as jest.Mock).mockResolvedValue({});

      await service.deleteSyllabusTopic('topic-1');

      expect(prisma.barSyllabus.update).toHaveBeenCalledWith({
        where: { id: 'syl-1' },
        data: { topicCount: { decrement: 1 } },
      });
    });
  });

  describe('addSyllabusTopicResource', () => {
    it('should add resource to topic', async () => {
      (prisma.syllabusTopic.findUnique as jest.Mock).mockResolvedValue({ id: 'topic-1' });
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.syllabusTopicResource.create as jest.Mock).mockResolvedValue({ id: 'str-1' });

      await service.addSyllabusTopicResource('topic-1', {
        resourceType: 'legal_document',
        resourceId: 'doc-1',
      });

      expect(prisma.syllabusTopicResource.create).toHaveBeenCalled();
    });

    it('should throw for unknown resource type', async () => {
      (prisma.syllabusTopic.findUnique as jest.Mock).mockResolvedValue({ id: 'topic-1' });

      await expect(
        service.addSyllabusTopicResource('topic-1', {
          resourceType: 'unknown_type',
          resourceId: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // Flashcard Reviews (Spaced Repetition)
  // =========================================================================

  describe('submitFlashcardReview', () => {
    it('should create review and update streak', async () => {
      (prisma.flashcard.findUnique as jest.Mock).mockResolvedValue(mockFlashcard);
      (prisma.flashcardReview.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.flashcardReview.create as jest.Mock).mockResolvedValue({
        id: 'fr-1',
        flashcardId: 'fc-1',
        response: 'good',
        interval: 1,
        easeFactor: 2.5,
      });
      (prisma.studyStreak.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.studyStreak.create as jest.Mock).mockResolvedValue({});

      const result = await service.submitFlashcardReview(
        'fc-1',
        { response: 'good' },
        userId,
      );

      expect(result.response).toBe('good');
      expect(prisma.flashcardReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          flashcardId: 'fc-1',
          userId,
          response: 'good',
          interval: 1, // first review: interval = 1
          easeFactor: expect.any(Number),
        }),
      });
    });

    it('should throw NotFoundException when flashcard not found', async () => {
      (prisma.flashcard.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.submitFlashcardReview('bad-id', { response: 'good' }, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should compute longer interval for subsequent reviews', async () => {
      (prisma.flashcard.findUnique as jest.Mock).mockResolvedValue(mockFlashcard);
      (prisma.flashcardReview.findFirst as jest.Mock).mockResolvedValue({
        interval: 6,
        easeFactor: 2.5,
        reviewedAt: new Date(),
      });
      (prisma.flashcardReview.create as jest.Mock).mockResolvedValue({
        id: 'fr-2',
        interval: 15, // 6 * 2.5 = 15
        easeFactor: 2.6,
      });
      (prisma.studyStreak.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.studyStreak.create as jest.Mock).mockResolvedValue({});

      await service.submitFlashcardReview('fc-1', { response: 'good' }, userId);

      expect(prisma.flashcardReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          interval: 15,
        }),
      });
    });

    it('should reset interval on "again" response', async () => {
      (prisma.flashcard.findUnique as jest.Mock).mockResolvedValue(mockFlashcard);
      (prisma.flashcardReview.findFirst as jest.Mock).mockResolvedValue({
        interval: 15,
        easeFactor: 2.5,
        reviewedAt: new Date(),
      });
      (prisma.flashcardReview.create as jest.Mock).mockResolvedValue({
        id: 'fr-3',
        interval: 1,
      });
      (prisma.studyStreak.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.studyStreak.create as jest.Mock).mockResolvedValue({});

      await service.submitFlashcardReview('fc-1', { response: 'again' }, userId);

      expect(prisma.flashcardReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          interval: 1,
        }),
      });
    });
  });

  describe('getFlashcardReviewStats', () => {
    it('should return review statistics', async () => {
      (prisma.flashcardReview.groupBy as jest.Mock).mockResolvedValue([
        { response: 'good', _count: { response: 10 } },
        { response: 'again', _count: { response: 3 } },
      ]);
      (prisma.flashcardReview.count as jest.Mock).mockResolvedValue(13);
      (prisma.flashcardReview.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getFlashcardReviewStats('fcs-1', userId);

      expect(result.totalReviews).toBe(13);
      expect(result.responseBreakdown).toEqual({ good: 10, again: 3 });
      expect(result.dueCount).toBe(0);
    });
  });

  // =========================================================================
  // Study Sessions
  // =========================================================================

  describe('startStudySession', () => {
    it('should create a study session', async () => {
      (prisma.studySession.create as jest.Mock).mockResolvedValue({
        id: 'ss-1',
        userId,
        entityType: 'flashcard_set',
        entityId: 'fcs-1',
        barSubject: 'civil',
      });

      const result = await service.startStudySession(
        { entityType: 'flashcard_set', entityId: 'fcs-1', barSubject: 'civil' },
        userId,
      );

      expect(result.id).toBe('ss-1');
    });
  });

  describe('endStudySession', () => {
    it('should end session and compute duration', async () => {
      const startedAt = new Date('2026-03-20T10:00:00Z');
      (prisma.studySession.findUnique as jest.Mock).mockResolvedValue({
        id: 'ss-1',
        userId,
        startedAt,
        endedAt: null,
      });
      (prisma.studySession.update as jest.Mock).mockResolvedValue({
        id: 'ss-1',
        endedAt: new Date(),
        durationSecs: 3600,
      });
      (prisma.studyStreak.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.studyStreak.create as jest.Mock).mockResolvedValue({});

      const result = await service.endStudySession(
        'ss-1',
        { itemsStudied: 20, itemsCorrect: 15 },
        userId,
      );

      expect(prisma.studySession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            endedAt: expect.any(Date),
            durationSecs: expect.any(Number),
            itemsStudied: 20,
            itemsCorrect: 15,
          }),
        }),
      );
    });

    it('should throw NotFoundException when session not found', async () => {
      (prisma.studySession.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.endStudySession('bad-id', {}, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when session already ended', async () => {
      (prisma.studySession.findUnique as jest.Mock).mockResolvedValue({
        id: 'ss-1',
        userId,
        endedAt: new Date(),
      });

      await expect(
        service.endStudySession('ss-1', {}, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for other users session', async () => {
      (prisma.studySession.findUnique as jest.Mock).mockResolvedValue({
        id: 'ss-1',
        userId: 'other-user',
        endedAt: null,
      });

      await expect(
        service.endStudySession('ss-1', {}, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStudyStats', () => {
    it('should aggregate study statistics', async () => {
      (prisma.studyStreak.findUnique as jest.Mock).mockResolvedValue({
        currentStreak: 5,
        longestStreak: 10,
        totalStudyDays: 30,
        lastStudyDate: new Date(),
      });
      (prisma.studySession.count as jest.Mock).mockResolvedValue(50);
      (prisma.studySession.aggregate as jest.Mock).mockResolvedValue({
        _sum: { durationSecs: 72000 },
      });
      (prisma.studySession.groupBy as jest.Mock).mockResolvedValue([
        { barSubject: 'civil', _sum: { durationSecs: 36000 }, _count: { id: 20 } },
        { barSubject: 'criminal', _sum: { durationSecs: 36000 }, _count: { id: 30 } },
      ]);

      const result = await service.getStudyStats(userId);

      expect(result.streak.current).toBe(5);
      expect(result.streak.longest).toBe(10);
      expect(result.totalSessions).toBe(50);
      expect(result.totalStudyTimeSecs).toBe(72000);
      expect(result.subjectBreakdown).toHaveLength(2);
    });

    it('should handle no streak record', async () => {
      (prisma.studyStreak.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.studySession.count as jest.Mock).mockResolvedValue(0);
      (prisma.studySession.aggregate as jest.Mock).mockResolvedValue({
        _sum: { durationSecs: null },
      });
      (prisma.studySession.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.getStudyStats(userId);

      expect(result.streak.current).toBe(0);
      expect(result.streak.longest).toBe(0);
      expect(result.totalStudyTimeSecs).toBe(0);
    });
  });
});

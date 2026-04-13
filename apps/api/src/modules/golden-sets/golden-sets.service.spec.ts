import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { GoldenSetsService } from './golden-sets.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-001',
    goldenSetType: 'case_digest',
    sourceDocumentId: 'doc-001',
    referenceDataJson: { facts: 'test facts' },
    status: 'draft',
    reviewNotes: null,
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sourceDocument: null,
    reviewedByUser: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoldenSetsService', () => {
  let service: GoldenSetsService;
  let prisma: {
    goldenSetEntry: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    evaluationRun: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    legalDocument: {
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      goldenSetEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) =>
          makeEntry({ ...data, id: 'new-entry-001' }),
        ),
        update: jest.fn().mockImplementation(async ({ data }) =>
          makeEntry({ ...data }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      evaluationRun: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      legalDocument: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoldenSetsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(GoldenSetsService);
  });

  // ---- CRUD ----

  describe('create', () => {
    it('1. creates a golden set entry with draft status', async () => {
      const result = await service.create({
        goldenSetType: 'case_digest',
        sourceDocumentId: 'doc-001',
        referenceDataJson: { facts: 'test' },
      });

      expect(prisma.goldenSetEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          goldenSetType: 'case_digest',
          sourceDocumentId: 'doc-001',
          status: 'draft',
        }),
      });
      expect(result.id).toBe('new-entry-001');
    });
  });

  describe('findAll', () => {
    it('2. filters by type', async () => {
      prisma.goldenSetEntry.findMany.mockResolvedValue([makeEntry()]);
      prisma.goldenSetEntry.count.mockResolvedValue(1);

      await service.findAll({ type: 'case_digest' });

      expect(prisma.goldenSetEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ goldenSetType: 'case_digest' }),
        }),
      );
    });

    it('3. filters by status', async () => {
      prisma.goldenSetEntry.findMany.mockResolvedValue([]);
      prisma.goldenSetEntry.count.mockResolvedValue(0);

      await service.findAll({ status: 'approved' });

      expect(prisma.goldenSetEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'approved' }),
        }),
      );
    });
  });

  // ---- Review workflow ----

  describe('approve', () => {
    it('4. transitions draft -> approved with reviewer info', async () => {
      prisma.goldenSetEntry.findUnique.mockResolvedValue(makeEntry({ status: 'draft' }));
      prisma.goldenSetEntry.update.mockResolvedValue(
        makeEntry({ status: 'approved', reviewedByUserId: 'user-001' }),
      );

      const result = await service.approve('entry-001', 'user-001', 'Looks good');

      expect(prisma.goldenSetEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-001' },
        data: expect.objectContaining({
          status: 'approved',
          reviewedByUserId: 'user-001',
          reviewedAt: expect.any(Date),
          reviewNotes: 'Looks good',
        }),
      });
      expect(result.status).toBe('approved');
    });

    it('5. rejects if already approved', async () => {
      prisma.goldenSetEntry.findUnique.mockResolvedValue(makeEntry({ status: 'approved' }));

      await expect(service.approve('entry-001', 'user-001')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reject', () => {
    it('6. transitions to rejected with notes', async () => {
      prisma.goldenSetEntry.findUnique.mockResolvedValue(makeEntry({ status: 'draft' }));
      prisma.goldenSetEntry.update.mockResolvedValue(
        makeEntry({ status: 'rejected', reviewNotes: 'Needs more detail' }),
      );

      const result = await service.reject('entry-001', 'user-001', 'Needs more detail');

      expect(prisma.goldenSetEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-001' },
        data: expect.objectContaining({
          status: 'rejected',
          reviewedByUserId: 'user-001',
          reviewNotes: 'Needs more detail',
        }),
      });
      expect(result.status).toBe('rejected');
    });
  });

  describe('bulkApprove', () => {
    it('7. approves multiple entries', async () => {
      prisma.goldenSetEntry.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.bulkApprove(
        ['entry-001', 'entry-002', 'entry-003'],
        'user-001',
      );

      expect(result).toEqual({ approved: 3 });
      expect(prisma.goldenSetEntry.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['entry-001', 'entry-002', 'entry-003'] },
          status: { not: 'approved' },
        },
        data: expect.objectContaining({
          status: 'approved',
          reviewedByUserId: 'user-001',
        }),
      });
    });
  });

  // ---- Stats ----

  describe('getStats', () => {
    it('8. returns correct counts per type', async () => {
      // Mock counts for each type: total, approved, pending
      prisma.goldenSetEntry.count
        .mockResolvedValueOnce(20)  // case_digest total
        .mockResolvedValueOnce(15)  // case_digest approved
        .mockResolvedValueOnce(5)   // case_digest pending
        .mockResolvedValueOnce(100) // subject_classification total
        .mockResolvedValueOnce(80)  // subject_classification approved
        .mockResolvedValueOnce(20)  // subject_classification pending
        .mockResolvedValueOnce(50)  // mcq_question total
        .mockResolvedValueOnce(50)  // mcq_question approved
        .mockResolvedValueOnce(0);  // mcq_question pending

      const stats = await service.getStats();

      expect(stats.caseDigest).toEqual({ total: 20, approved: 15, pending: 5 });
      expect(stats.subjectClassification).toEqual({ total: 100, approved: 80, pending: 20 });
      expect(stats.mcqQuestion).toEqual({ total: 50, approved: 50, pending: 0 });
    });
  });

  // ---- AI draft generation stubs ----

  describe('generateDraftDigests', () => {
    it('9. creates draft entries for published case documents', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        { id: 'doc-001', title: 'Case A' },
        { id: 'doc-002', title: 'Case B' },
      ]);

      const result = await service.generateDraftDigests(20);

      expect(result).toEqual({ created: 2 });
      expect(prisma.goldenSetEntry.create).toHaveBeenCalledTimes(2);
      expect(prisma.goldenSetEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          goldenSetType: 'case_digest',
          sourceDocumentId: 'doc-001',
          status: 'draft',
        }),
      });
    });
  });

  describe('generateDraftClassifications', () => {
    it('10. creates draft entries for published documents', async () => {
      const docs = Array.from({ length: 5 }, (_, i) => ({ id: `doc-${i}` }));
      prisma.legalDocument.findMany.mockResolvedValue(docs);

      const result = await service.generateDraftClassifications(100);

      expect(result).toEqual({ created: 5 });
      expect(prisma.goldenSetEntry.create).toHaveBeenCalledTimes(5);
    });
  });

  describe('sampleMcqGoldenSet', () => {
    it('11. creates entries from bar question corpus', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        { id: 'bar-001' },
        { id: 'bar-002' },
      ]);

      const result = await service.sampleMcqGoldenSet(50);

      expect(result).toEqual({ created: 2 });
      expect(prisma.goldenSetEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ goldenSetType: 'mcq_question' }),
        }),
      );
    });
  });

  // ---- Remove ----

  describe('remove', () => {
    it('12. only allows deleting draft entries', async () => {
      prisma.goldenSetEntry.findUnique.mockResolvedValue(
        makeEntry({ status: 'approved' }),
      );

      await expect(service.remove('entry-001')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.goldenSetEntry.delete).not.toHaveBeenCalled();
    });
  });
});

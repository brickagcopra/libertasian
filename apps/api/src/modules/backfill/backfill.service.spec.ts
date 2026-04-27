import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BackfillService } from './backfill.service';

describe('BackfillService', () => {
  let service: BackfillService;
  let prisma: jest.Mocked<PrismaService>;
  let celery: jest.Mocked<CeleryDispatcherService>;

  const mockSource = {
    id: 'src-1',
    name: 'Supreme Court E-Library',
    type: 'official',
  };

  const baseBatch = {
    id: 'batch-1',
    sourceId: 'src-1',
    sourceEndpointId: null,
    name: 'SC Backfill 2020-2023',
    description: null,
    yearStart: 2020,
    yearEnd: 2023,
    monthStart: null,
    monthEnd: null,
    status: 'pending',
    budgetCeilingUsd: 50,
    budgetConsumedUsd: 0,
    candidatesDiscovered: 0,
    candidatesProcessed: 0,
    candidatesSkipped: 0,
    candidatesFailed: 0,
    documentsCreated: 0,
    documentsUpdated: 0,
    checkpointState: {},
    startedAt: null,
    finishedAt: null,
    lastTickAt: null,
    adminNotes: null,
    createdByUserId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackfillService,
        {
          provide: PrismaService,
          useValue: {
            source: {
              findUnique: jest.fn(),
            },
            sourceEndpoint: {
              findFirst: jest.fn(),
            },
            backfillBatch: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            ingestionJob: {
              updateMany: jest.fn(),
            },
          },
        },
        {
          provide: CeleryDispatcherService,
          useValue: {
            sendTask: jest.fn().mockResolvedValue('task-id-mock'),
          },
        },
      ],
    }).compile();

    service = module.get<BackfillService>(BackfillService);
    prisma = module.get(PrismaService);
    celery = module.get(CeleryDispatcherService);
  });

  // ---- create() ----

  describe('create()', () => {
    const validDto = {
      sourceId: 'src-1',
      name: 'SC Backfill 2020-2023',
      yearStart: 2020,
      yearEnd: 2023,
      budgetCeilingUsd: 50,
    };

    it('should create a batch with status pending', async () => {
      (prisma.source.findUnique as jest.Mock).mockResolvedValue(mockSource);
      (prisma.backfillBatch.create as jest.Mock).mockResolvedValue(baseBatch);

      const result = await service.create(validDto, 'user-1');

      expect(result).toEqual(baseBatch);
      expect(prisma.backfillBatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceId: 'src-1',
          name: 'SC Backfill 2020-2023',
          status: 'pending',
        }),
      });
    });

    it('should reject if yearStart > yearEnd', async () => {
      await expect(
        service.create({ ...validDto, yearStart: 2025, yearEnd: 2020 }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if sourceId does not exist', async () => {
      (prisma.source.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create(validDto, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should transition to enumerating when startImmediately is true', async () => {
      (prisma.source.findUnique as jest.Mock).mockResolvedValue(mockSource);
      (prisma.backfillBatch.create as jest.Mock).mockResolvedValue(baseBatch);
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue(baseBatch);
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'enumerating',
      });

      const result = await service.create(
        { ...validDto, startImmediately: true },
        'user-1',
      );

      expect(result.status).toBe('enumerating');
    });

    it('should dispatch backfill.enumerate_candidates when startImmediately is true', async () => {
      (prisma.source.findUnique as jest.Mock).mockResolvedValue(mockSource);
      (prisma.backfillBatch.create as jest.Mock).mockResolvedValue(baseBatch);
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue(baseBatch);
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'enumerating',
      });

      await service.create(
        { ...validDto, startImmediately: true },
        'user-1',
      );

      expect(celery.sendTask).toHaveBeenCalledTimes(1);
      expect(celery.sendTask).toHaveBeenCalledWith(
        'backfill.enumerate_candidates',
        { args: [baseBatch.id] },
      );
    });

    it('should NOT dispatch enumerate when startImmediately is omitted', async () => {
      (prisma.source.findUnique as jest.Mock).mockResolvedValue(mockSource);
      (prisma.backfillBatch.create as jest.Mock).mockResolvedValue(baseBatch);

      await service.create(validDto, 'user-1');

      expect(celery.sendTask).not.toHaveBeenCalled();
    });

    it('should swallow Celery dispatch errors and still return the transitioned batch', async () => {
      (prisma.source.findUnique as jest.Mock).mockResolvedValue(mockSource);
      (prisma.backfillBatch.create as jest.Mock).mockResolvedValue(baseBatch);
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue(baseBatch);
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'enumerating',
      });
      (celery.sendTask as jest.Mock).mockRejectedValueOnce(
        new Error('redis connection refused'),
      );

      const result = await service.create(
        { ...validDto, startImmediately: true },
        'user-1',
      );

      expect(result.status).toBe('enumerating');
    });

    it('should pass inflightCap through to backfillBatch.create', async () => {
      (prisma.source.findUnique as jest.Mock).mockResolvedValue(mockSource);
      (prisma.backfillBatch.create as jest.Mock).mockResolvedValue({
        ...baseBatch,
        inflightCap: 50,
      });

      await service.create({ ...validDto, inflightCap: 50 }, 'user-1');

      expect(prisma.backfillBatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ inflightCap: 50 }),
      });
    });

    it('should omit inflightCap from create payload when not provided (defaults at column level)', async () => {
      (prisma.source.findUnique as jest.Mock).mockResolvedValue(mockSource);
      (prisma.backfillBatch.create as jest.Mock).mockResolvedValue(baseBatch);

      await service.create(validDto, 'user-1');

      const createCall = (prisma.backfillBatch.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data).not.toHaveProperty('inflightCap');
    });

    it('should reject if monthStart > monthEnd when both provided', async () => {
      await expect(
        service.create(
          { ...validDto, monthStart: 10, monthEnd: 3 },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should resolve sourceSlug to sourceId via parser_type lookup', async () => {
      (prisma.sourceEndpoint.findFirst as jest.Mock).mockResolvedValue({
        sourceId: 'src-lawphil',
      });
      (prisma.source.findUnique as jest.Mock).mockResolvedValue({
        id: 'src-lawphil',
        name: 'LawPhil',
      });
      (prisma.backfillBatch.create as jest.Mock).mockResolvedValue({
        ...baseBatch,
        sourceId: 'src-lawphil',
      });

      const result = await service.create(
        {
          sourceSlug: 'lawphil',
          name: 'LawPhil Pilot 2020',
          yearStart: 2020,
          yearEnd: 2020,
          budgetCeilingUsd: 5,
        },
        'user-1',
      );

      expect(result.sourceId).toBe('src-lawphil');
      expect(prisma.sourceEndpoint.findFirst).toHaveBeenCalledWith({
        where: { parserType: 'lawphil' },
        select: { sourceId: true },
      });
    });

    it('should resolve scel slug to supreme_court_elibrary parser_type', async () => {
      (prisma.sourceEndpoint.findFirst as jest.Mock).mockResolvedValue({
        sourceId: 'src-scel',
      });
      (prisma.source.findUnique as jest.Mock).mockResolvedValue({
        id: 'src-scel',
        name: 'Supreme Court E-Library',
      });
      (prisma.backfillBatch.create as jest.Mock).mockResolvedValue({
        ...baseBatch,
        sourceId: 'src-scel',
      });

      await service.create(
        {
          sourceSlug: 'scel',
          name: 'SCEL Pilot 2023',
          yearStart: 2023,
          yearEnd: 2023,
          budgetCeilingUsd: 5,
        },
        'user-1',
      );

      expect(prisma.sourceEndpoint.findFirst).toHaveBeenCalledWith({
        where: { parserType: 'supreme_court_elibrary' },
        select: { sourceId: true },
      });
    });

    it('should reject sourceSlug with no matching source endpoint', async () => {
      (prisma.sourceEndpoint.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create(
          {
            sourceSlug: 'lawphil',
            name: 'Orphan Batch',
            yearStart: 2020,
            yearEnd: 2020,
            budgetCeilingUsd: 5,
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject when both sourceId and sourceSlug are provided', async () => {
      await expect(
        service.create(
          {
            sourceId: 'src-1',
            sourceSlug: 'lawphil',
            name: 'Ambiguous',
            yearStart: 2020,
            yearEnd: 2020,
            budgetCeilingUsd: 5,
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---- findAll() ----

  describe('findAll()', () => {
    it('should return paginated results', async () => {
      (prisma.backfillBatch.findMany as jest.Mock).mockResolvedValue([baseBatch]);
      (prisma.backfillBatch.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by status', async () => {
      (prisma.backfillBatch.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.backfillBatch.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ status: 'running' });

      expect(prisma.backfillBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'running' },
        }),
      );
    });
  });

  // ---- findOne() ----

  describe('findOne()', () => {
    it('should return batch with source and checkpoints', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        source: mockSource,
        checkpoints: [],
      });

      const result = await service.findOne('batch-1');

      expect(result).toBeDefined();
      expect(prisma.backfillBatch.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            source: expect.any(Object),
            checkpoints: expect.any(Object),
          }),
        }),
      );
    });

    it('should throw NotFoundException for non-existent ID', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- start() ----

  describe('start()', () => {
    it('should transition pending -> enumerating', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue(baseBatch);
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'enumerating',
      });

      const result = await service.start('batch-1');

      expect(result.status).toBe('enumerating');
    });

    it('should reject if status is not pending', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'running',
      });

      await expect(service.start('batch-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ---- pause() ----

  describe('pause()', () => {
    it('should transition running -> paused', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'running',
      });
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'paused',
      });

      const result = await service.pause('batch-1');

      expect(result.status).toBe('paused');
    });
  });

  // ---- resume() ----

  describe('resume()', () => {
    it('should transition paused -> running', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'paused',
      });
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'running',
      });

      const result = await service.resume('batch-1');

      expect(result.status).toBe('running');
    });

    it('should transition halted_admin -> running', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'halted_admin',
      });
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'running',
      });

      const result = await service.resume('batch-1');

      expect(result.status).toBe('running');
    });

    it('should transition halted_budget -> running', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'halted_budget',
      });
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'running',
      });

      const result = await service.resume('batch-1');

      expect(result.status).toBe('running');
    });
  });

  // ---- halt() ----

  describe('halt()', () => {
    it('should transition running -> halted_admin and store reason', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'running',
      });
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'halted_admin',
        adminNotes: 'Budget review needed',
      });

      const result = await service.halt('batch-1', {
        reason: 'Budget review needed',
      });

      expect(result.status).toBe('halted_admin');
      expect(prisma.backfillBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'halted_admin',
            adminNotes: 'Budget review needed',
          }),
        }),
      );
    });

    it('should reject if status is not running', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'pending',
      });

      await expect(
        service.halt('batch-1', { reason: 'test' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---- extendBudget() ----

  describe('extendBudget()', () => {
    it('should update ceiling when halted_budget', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'halted_budget',
      });
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'halted_budget',
        budgetCeilingUsd: 100,
      });

      const result = await service.extendBudget('batch-1', {
        newCeilingUsd: 100,
        reason: 'Approved additional budget',
      });

      expect(result.budgetCeilingUsd).toBe(100);
    });

    it('should reject if not halted_budget', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'running',
      });

      await expect(
        service.extendBudget('batch-1', {
          newCeilingUsd: 100,
          reason: 'test',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---- remove() ----

  describe('remove()', () => {
    it('should succeed for completed batch', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'completed',
      });
      (prisma.backfillBatch.delete as jest.Mock).mockResolvedValue(undefined);

      await expect(service.remove('batch-1')).resolves.toBeUndefined();
    });

    it('should reject for running batch', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'running',
      });

      await expect(service.remove('batch-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ---- updateInflight() ----

  describe('updateInflight()', () => {
    it('should update the inflightCap on the row', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue(baseBatch);
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        inflightCap: 75,
      });

      const result = await service.updateInflight('batch-1', { inflightCap: 75 });

      expect(prisma.backfillBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { inflightCap: 75 },
      });
      expect((result as unknown as { inflightCap: number }).inflightCap).toBe(75);
    });

    it('should throw NotFoundException for unknown batch', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateInflight('missing', { inflightCap: 10 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- killInflight() ----

  describe('killInflight()', () => {
    it('should reject if confirmName does not match batch name', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue(baseBatch);

      await expect(
        service.killInflight('batch-1', {
          reason: 'test',
          confirmName: 'wrong-name',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should mark inflight jobs as failed and update batch', async () => {
      (prisma.backfillBatch.findUnique as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'running',
      });
      (prisma.ingestionJob.updateMany as jest.Mock).mockResolvedValue({
        count: 3,
      });
      (prisma.backfillBatch.update as jest.Mock).mockResolvedValue({
        ...baseBatch,
        status: 'failed',
      });

      const result = await service.killInflight('batch-1', {
        reason: 'Emergency stop',
        confirmName: 'SC Backfill 2020-2023',
      });

      expect(result.status).toBe('failed');
      expect(prisma.ingestionJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            backfillBatchId: 'batch-1',
            status: { in: ['pending', 'running'] },
          },
        }),
      );
    });
  });
});

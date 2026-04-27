import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SourcesService } from './sources.service';

describe('SourcesService', () => {
  let service: SourcesService;
  let prisma: jest.Mocked<PrismaService>;

  const mockSource = {
    id: 'src-1',
    name: 'Supreme Court E-Library',
    type: 'official',
    domain: 'elibrary.judiciary.gov.ph',
    trustLevel: 'high',
    enabled: true,
    fetchStrategy: 'crawler',
    createdAt: new Date(),
    updatedAt: new Date(),
    healthScore: null,
    lastHealthCheckAt: null,
    healthMetadataJson: null,
  };

  const mockEndpoint = {
    id: 'ep-1',
    sourceId: 'src-1',
    endpointUrl: 'https://elibrary.judiciary.gov.ph/decisions',
    parserType: 'html_list',
    contentTypeHint: 'text/html',
    scheduleCron: '0 3 * * *',
    status: 'active',
    lastFetchedAt: null,
    lastSuccessAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SourcesService,
        {
          provide: PrismaService,
          useValue: {
            source: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findUniqueOrThrow: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
            sourceEndpoint: {
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            ingestionJob: {
              findMany: jest.fn(),
              create: jest.fn(),
            },
            legalDocument: {
              count: jest.fn(),
              groupBy: jest.fn(),
            },
            digest: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
            editorialFlag: {
              count: jest.fn(),
              findMany: jest.fn(),
            },
            legalDocumentTagMap: {
              groupBy: jest.fn(),
              findFirst: jest.fn(),
            },
            legalMetadataTag: {
              findMany: jest.fn(),
            },
            digestReview: {
              create: jest.fn(),
            },
            backfillBatch: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            auditLog: {
              count: jest.fn().mockResolvedValue(0),
            },
            citation: {
              count: jest.fn().mockResolvedValue(0),
            },
            derivativeArtifact: {
              count: jest.fn().mockResolvedValue(0),
            },
            $transaction: jest.fn(),
            $queryRawUnsafe: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SourcesService>(SourcesService);
    prisma = module.get(PrismaService);
  });

  // ---- Source CRUD ----

  describe('create', () => {
    it('should create a new source', async () => {
      (prisma.source.create as jest.Mock).mockResolvedValue(mockSource);

      const result = await service.create({
        name: 'Supreme Court E-Library',
        type: 'official',
        domain: 'elibrary.judiciary.gov.ph',
        trustLevel: 'high',
      });

      expect(result).toEqual(mockSource);
      expect(prisma.source.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Supreme Court E-Library',
          type: 'official',
          trustLevel: 'high',
        }),
      });
    });

    it('should use default values for optional fields', async () => {
      (prisma.source.create as jest.Mock).mockResolvedValue(mockSource);

      await service.create({ name: 'Test Source', type: 'semi_official' });

      expect(prisma.source.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          trustLevel: 'medium',
          enabled: true,
          fetchStrategy: 'crawler',
        }),
      });
    });
  });

  describe('findById', () => {
    it('should return source with endpoints and counts', async () => {
      (prisma.source.findUnique as jest.Mock).mockResolvedValue({
        ...mockSource,
        endpoints: [mockEndpoint],
        _count: { legalDocuments: 1500, ingestionJobs: 25 },
      });

      const result = await service.findById('src-1');
      expect(result.id).toBe('src-1');
      expect(result.endpoints).toHaveLength(1);
    });

    it('should throw NotFoundException for missing source', async () => {
      (prisma.source.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('src-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('should return all sources with counts and endpoints', async () => {
      (prisma.source.findMany as jest.Mock).mockResolvedValue([
        { ...mockSource, _count: { legalDocuments: 100, endpoints: 2, ingestionJobs: 5 }, endpoints: [] },
      ]);

      const result = await service.list();
      expect(result).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('should update source fields', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(1);
      (prisma.source.update as jest.Mock).mockResolvedValue({ ...mockSource, enabled: false });

      const result = await service.update('src-1', { enabled: false });
      expect(result.enabled).toBe(false);
    });

    it('should throw NotFoundException for missing source', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(0);

      await expect(service.update('src-x', { enabled: false })).rejects.toThrow(NotFoundException);
    });
  });

  // ---- Source Endpoints ----

  describe('createEndpoint', () => {
    it('should create endpoint for existing source', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(1);
      (prisma.sourceEndpoint.create as jest.Mock).mockResolvedValue(mockEndpoint);

      const result = await service.createEndpoint('src-1', {
        endpointUrl: 'https://elibrary.judiciary.gov.ph/decisions',
        parserType: 'html_list',
      });

      expect(result).toEqual(mockEndpoint);
    });

    it('should throw NotFoundException for missing source', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(0);

      await expect(
        service.createEndpoint('src-x', { endpointUrl: 'https://example.com', parserType: 'html' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateEndpoint', () => {
    it('should update endpoint', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(1);
      (prisma.sourceEndpoint.count as jest.Mock).mockResolvedValue(1);
      (prisma.sourceEndpoint.update as jest.Mock).mockResolvedValue({
        ...mockEndpoint,
        status: 'paused',
      });

      const result = await service.updateEndpoint('src-1', 'ep-1', { status: 'paused' });
      expect(result.status).toBe('paused');
    });

    it('should throw NotFoundException for missing endpoint', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(1);
      (prisma.sourceEndpoint.count as jest.Mock).mockResolvedValue(0);

      await expect(
        service.updateEndpoint('src-1', 'ep-x', { status: 'paused' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteEndpoint', () => {
    it('should delete endpoint', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(1);
      (prisma.sourceEndpoint.count as jest.Mock).mockResolvedValue(1);
      (prisma.sourceEndpoint.delete as jest.Mock).mockResolvedValue(mockEndpoint);

      await expect(service.deleteEndpoint('src-1', 'ep-1')).resolves.not.toThrow();
    });
  });

  // ---- Ingestion Jobs ----

  describe('listIngestionJobs', () => {
    it('should list jobs without source filter', async () => {
      (prisma.ingestionJob.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listIngestionJobs();
      expect(result).toEqual([]);
      expect(prisma.ingestionJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it('should list jobs filtered by source', async () => {
      (prisma.ingestionJob.findMany as jest.Mock).mockResolvedValue([]);

      await service.listIngestionJobs('src-1');
      expect(prisma.ingestionJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sourceId: 'src-1' } }),
      );
    });
  });

  describe('createIngestionJob', () => {
    it('should create ingestion job', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(1);
      (prisma.ingestionJob.create as jest.Mock).mockResolvedValue({
        id: 'job-1',
        sourceId: 'src-1',
        jobType: 'fetch',
        status: 'pending',
      });

      const result = await service.createIngestionJob('src-1');
      expect(result.jobType).toBe('fetch');
      expect(result.status).toBe('pending');
    });

    it('should throw NotFoundException for missing source', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(0);

      await expect(service.createIngestionJob('src-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- Corpus Health ----

  describe('getCorpusHealth', () => {
    it('should return corpus health summary', async () => {
      (prisma.legalDocument.count as jest.Mock)
        .mockResolvedValueOnce(10000)  // total
        .mockResolvedValueOnce(8000)   // published
        .mockResolvedValueOnce(1500)   // draft
        .mockResolvedValueOnce(400)    // needs_review
        .mockResolvedValueOnce(100);   // quarantined

      (prisma.legalDocument.groupBy as jest.Mock).mockResolvedValue([
        { documentType: 'case', _count: 7000 },
        { documentType: 'statute', _count: 3000 },
      ]);

      (prisma.source.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.digest.count as jest.Mock).mockResolvedValue(50);
      (prisma.editorialFlag.count as jest.Mock).mockResolvedValue(10);
      (prisma.backfillBatch.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'bf-1',
          name: 'SC 2020',
          status: 'running',
          candidatesProcessed: 12,
          candidatesDiscovered: 100,
          lastTickAt: new Date('2026-04-27T10:00:00.000Z'),
        },
      ]);
      (prisma.auditLog.count as jest.Mock).mockResolvedValue(7);
      (prisma.citation.count as jest.Mock).mockResolvedValue(40123);
      (prisma.derivativeArtifact.count as jest.Mock).mockResolvedValue(85);

      const result = await service.getCorpusHealth();

      expect(result.corpus.total).toBe(10000);
      expect(result.corpus.published).toBe(8000);
      expect(result.documentsByType).toHaveLength(2);
      expect(result.reviewQueue.pendingDigests).toBe(50);
      expect(result.reviewQueue.openFlags).toBe(10);
      expect(result.pipelineOps.activeBackfillBatches.count).toBe(1);
      expect(result.pipelineOps.activeBackfillBatches.items[0]).toMatchObject({
        id: 'bf-1',
        name: 'SC 2020',
        status: 'running',
        candidatesProcessed: 12,
        candidatesTotal: 100,
      });
      expect(result.pipelineOps.last24hAutoPromotions).toBe(7);
      expect(result.pipelineOps.citationsTotal).toBe(40123);
      expect(result.pipelineOps.pendingReviewQueue).toBe(85);
    });
  });

  // ---- Review Queue ----

  describe('getReviewQueue', () => {
    it('should return paginated review queue', async () => {
      const digests = Array.from({ length: 3 }, (_, i) => ({
        id: `dig-${i}`,
        title: `Digest ${i}`,
        reviewStatus: 'needs_human_review',
        legalDocument: { id: `doc-${i}`, title: `Case ${i}` },
        user: { id: 'user-1', fullName: 'Reviewer' },
      }));
      (prisma.digest.findMany as jest.Mock).mockResolvedValue(digests);

      const result = await service.getReviewQueue();
      expect(result.items).toHaveLength(3);
      expect(result.meta.hasNext).toBe(false);
    });
  });

  describe('approveDigest', () => {
    it('should approve a digest', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValue({ id: 'dig-1' });
      (prisma.$transaction as jest.Mock).mockResolvedValue([{ id: 'dig-1', reviewStatus: 'approved' }]);

      const result = await service.approveDigest('dig-1', 'reviewer-1', 'LGTM');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException for missing digest', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.approveDigest('dig-x', 'reviewer-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('rejectDigest', () => {
    it('should reject a digest', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValue({ id: 'dig-1' });
      (prisma.$transaction as jest.Mock).mockResolvedValue([{ id: 'dig-1', reviewStatus: 'rejected' }]);

      const result = await service.rejectDigest('dig-1', 'reviewer-1', 'Inaccurate facts');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException for missing digest', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.rejectDigest('dig-x', 'reviewer-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- Editorial Flags ----

  describe('listEditorialFlags', () => {
    it('should list flags without filter', async () => {
      (prisma.editorialFlag.findMany as jest.Mock).mockResolvedValue([]);

      await service.listEditorialFlags();
      expect(prisma.editorialFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it('should filter by status', async () => {
      (prisma.editorialFlag.findMany as jest.Mock).mockResolvedValue([]);

      await service.listEditorialFlags('open');
      expect(prisma.editorialFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'open' } }),
      );
    });
  });

  // ---- Source Health Scoring ----

  describe('computeSourceHealth', () => {
    it('should compute weighted health score', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(1);
      (prisma.source.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        ...mockSource,
        endpoints: [
          { id: 'ep-1', status: 'active', lastFetchedAt: new Date(), lastSuccessAt: new Date() },
        ],
        _count: { legalDocuments: 100, ingestionJobs: 10 },
      });
      (prisma.ingestionJob.findMany as jest.Mock).mockResolvedValue([
        { status: 'completed' },
        { status: 'completed' },
        { status: 'failed' },
      ]);
      (prisma.legalDocument.count as jest.Mock)
        .mockResolvedValueOnce(90)   // published
        .mockResolvedValueOnce(5);   // quarantined
      (prisma.source.update as jest.Mock).mockResolvedValue(mockSource);

      const result = await service.computeSourceHealth('src-1');

      expect(result.healthScore).toBeGreaterThan(0);
      expect(result.healthScore).toBeLessThanOrEqual(1);
      expect(result.components).toHaveProperty('endpointAvailability');
      expect(result.components).toHaveProperty('fetchSuccessRate');
      expect(result.components).toHaveProperty('documentQuality');
      expect(result.components).toHaveProperty('freshness');
    });

    it('should throw NotFoundException for missing source', async () => {
      (prisma.source.count as jest.Mock).mockResolvedValue(0);

      await expect(service.computeSourceHealth('src-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- Staleness Report ----

  describe('getStalenessReport', () => {
    it('should return stale sources', async () => {
      const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      (prisma.source.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'src-1',
          name: 'Old Source',
          type: 'official',
          enabled: true,
          _count: { legalDocuments: 100 },
          endpoints: [{ lastFetchedAt: staleDate }],
        },
        {
          id: 'src-2',
          name: 'Fresh Source',
          type: 'official',
          enabled: true,
          _count: { legalDocuments: 200 },
          endpoints: [{ lastFetchedAt: new Date() }],
        },
      ]);

      const result = await service.getStalenessReport(30);
      // Only the stale source should be returned
      expect(result.length).toBe(1);
      expect(result[0]!.sourceId).toBe('src-1');
    });
  });

  // ---- Coverage Gap Analysis ----

  describe('getCoverageGapAnalysis', () => {
    it('should return coverage by type, court, and tag', async () => {
      (prisma.legalDocument.groupBy as jest.Mock)
        .mockResolvedValueOnce([  // byType
          { documentType: 'case', _count: 5000, _max: { createdAt: new Date() } },
        ])
        .mockResolvedValueOnce([  // byCourt
          { court: 'Supreme Court', _count: 3000, _max: { decisionDate: new Date() } },
        ]);

      (prisma.legalDocumentTagMap.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.legalMetadataTag.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCoverageGapAnalysis();

      expect(result.byDocumentType).toHaveLength(1);
      expect(result.byCourt).toHaveLength(1);
    });
  });

  // ---- Ingestion Trends ----

  describe('getIngestionTrends', () => {
    it('should return daily ingestion trends', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([
        { period: new Date('2026-03-01'), doc_count: BigInt(10) },
        { period: new Date('2026-03-02'), doc_count: BigInt(15) },
      ]);

      const result = await service.getIngestionTrends({ interval: 'day', periods: 30 });

      expect(result).toHaveLength(2);
      expect(result[0]!.documentCount).toBe(10);
      expect(result[1]!.cumulativeCount).toBe(25);
    });
  });
});

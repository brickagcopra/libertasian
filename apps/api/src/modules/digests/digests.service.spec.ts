import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';

import { PaywallException } from '../../common/exceptions/paywall.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { DigestsService } from './digests.service';
import { CreateDigestDto, UpdateDigestDto, ListDigestsQueryDto } from './dto';

const CONFIDENCE_THRESHOLD = 0.7;
const USER_SCAN_ORIGINS = ['user_scan', 'user_upload', 'camera_capture'];

describe('DigestsService', () => {
  let service: DigestsService;
  let prismaService: {
    digest: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      aggregate: jest.Mock;
    };
    legalDocument: { count: jest.Mock; findUnique: jest.Mock };
    provenanceRecord: { createMany: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    digestReview: { create: jest.Mock; createMany: jest.Mock };
    organizationMember: { findFirst: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    forTenant: jest.Mock;
  };
  let digestQueue: { add: jest.Mock };

  const mockDigest = {
    id: 'digest-1',
    legalDocumentId: 'doc-1',
    organizationId: 'org-1',
    userId: 'user-1',
    sourceOrigin: 'official_pipeline',
    title: 'Test Digest',
    digestType: 'case_digest',
    facts: 'Facts content',
    issues: 'Issues content',
    ruling: 'Ruling content',
    doctrine: null,
    dispositive: null,
    confidenceScore: 0.85,
    reviewStatus: 'ai_generated',
    visibility: 'private',
    assignedReviewerUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockLegalDocument = {
    id: 'doc-1',
    title: 'G.R. No. 123456',
    shortTitle: 'Test Case',
    citationText: 'G.R. No. 123456',
    grNo: '123456',
    court: 'Supreme Court',
    decisionDate: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      digest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
      legalDocument: {
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      provenanceRecord: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      digestReview: {
        create: jest.fn(),
        createMany: jest.fn(),
      },
      organizationMember: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
      forTenant: jest.fn(),
    };

    const mockDigestQueue = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigestsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: getQueueToken('digests'),
          useValue: mockDigestQueue,
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<DigestsService>(DigestsService);
    prismaService = module.get(PrismaService);
    digestQueue = module.get(getQueueToken('digests'));
    mockPrismaService.forTenant.mockReturnValue(mockPrismaService as unknown as PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createDto: CreateDigestDto = {
      legalDocumentId: 'doc-1',
      sourceOrigin: 'official_pipeline',
      title: 'Test Digest',
      digestType: 'case_digest',
      facts: 'Facts content',
      issues: 'Issues content',
      ruling: 'Ruling content',
      confidenceScore: 0.85,
      visibility: 'org',
    };

    it('should create a digest with normal creation', async () => {
      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        legalDocument: mockLegalDocument,
      });

      const result = await service.create(createDto, 'user-1', 'org-1');

      expect(prismaService.legalDocument.count).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
      expect(prismaService.digest.create).toHaveBeenCalledWith({
        data: {
          legalDocumentId: 'doc-1',
          organizationId: 'org-1',
          userId: 'user-1',
          sourceOrigin: 'official_pipeline',
          title: 'Test Digest',
          digestType: 'case_digest',
          facts: 'Facts content',
          issues: 'Issues content',
          ruling: 'Ruling content',
          doctrine: undefined,
          dispositive: undefined,
          confidenceScore: 0.85,
          reviewStatus: 'ai_generated',
          visibility: 'org',
        },
        include: {
          legalDocument: {
            select: {
              id: true,
              title: true,
              shortTitle: true,
              citationText: true,
              grNo: true,
              court: true,
              decisionDate: true,
            },
          },
        },
      });
      expect(prismaService.forTenant).toHaveBeenCalledWith('org-1');
      expect(result).toEqual({
        ...mockDigest,
        legalDocument: mockLegalDocument,
      });
    });

    it('should enforce private visibility for user_scan origin', async () => {
      const userScanDto: CreateDigestDto = {
        ...createDto,
        sourceOrigin: 'user_scan',
        visibility: 'public_editorial', // attempt to set non-private
      };

      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        sourceOrigin: 'user_scan',
        visibility: 'private',
        legalDocument: mockLegalDocument,
      });

      const result = await service.create(userScanDto, 'user-1', 'org-1');

      // Verify visibility was forced to 'private'
      expect(prismaService.digest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: 'private',
          }),
        }),
      );
      expect(result.visibility).toBe('private');
    });

    it('should throw NotFoundException if legal document does not exist', async () => {
      prismaService.legalDocument.count.mockResolvedValue(0);

      await expect(service.create(createDto, 'user-1', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createDto, 'user-1', 'org-1')).rejects.toThrow(
        'Legal document not found',
      );
    });

    it('should set review status to draft when confidence is null', async () => {
      const dtoWithoutConfidence: CreateDigestDto = {
        ...createDto,
        confidenceScore: undefined,
      };

      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        confidenceScore: null,
        reviewStatus: 'draft',
        legalDocument: mockLegalDocument,
      });

      await service.create(dtoWithoutConfidence, 'user-1', 'org-1');

      expect(prismaService.digest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewStatus: 'draft',
          }),
        }),
      );
    });

    it('should set review status to needs_human_review when confidence < 0.7', async () => {
      const lowConfidenceDto: CreateDigestDto = {
        ...createDto,
        confidenceScore: 0.5,
      };

      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        confidenceScore: 0.5,
        reviewStatus: 'needs_human_review',
        legalDocument: mockLegalDocument,
      });

      await service.create(lowConfidenceDto, 'user-1', 'org-1');

      expect(prismaService.digest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            confidenceScore: 0.5,
            reviewStatus: 'needs_human_review',
          }),
        }),
      );
    });

    it('should set review status to ai_generated when confidence >= 0.7 and official_pipeline', async () => {
      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        legalDocument: mockLegalDocument,
      });

      await service.create(createDto, 'user-1', 'org-1');

      expect(prismaService.digest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            confidenceScore: 0.85,
            reviewStatus: 'ai_generated',
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return a digest with access granted', async () => {
      const digestWithIncludes = {
        ...mockDigest,
        legalDocument: mockLegalDocument,
        reviews: [],
        _count: {
          doctrineExtracts: 0,
          editorialFlags: 0,
        },
      };

      prismaService.digest.findUnique.mockResolvedValue(digestWithIncludes);

      const result = await service.findById('digest-1', 'user-1', 'org-1');

      expect(prismaService.digest.findUnique).toHaveBeenCalledWith({
        where: { id: 'digest-1' },
        include: {
          legalDocument: {
            select: {
              id: true,
              title: true,
              shortTitle: true,
              citationText: true,
              grNo: true,
              court: true,
              decisionDate: true,
              documentType: true,
              ponente: true,
            },
          },
          reviews: {
            select: {
              id: true,
              verdict: true,
              notes: true,
              truthfulnessScore: true,
              completenessScore: true,
              citationAccuracyScore: true,
              createdAt: true,
              reviewer: {
                select: { id: true, fullName: true },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: {
              doctrineExtracts: true,
              editorialFlags: true,
            },
          },
        },
      });
      expect(result).toEqual(digestWithIncludes);
    });

    it('should throw NotFoundException if digest does not exist', async () => {
      prismaService.digest.findUnique.mockResolvedValue(null);

      await expect(service.findById('digest-999', 'user-1', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findById('digest-999', 'user-1', 'org-1')).rejects.toThrow(
        'Digest not found',
      );
    });

    it('should throw ForbiddenException for private digest owned by different user', async () => {
      const privateDigest = {
        ...mockDigest,
        userId: 'other-user',
        visibility: 'private',
        legalDocument: mockLegalDocument,
        reviews: [],
        _count: { doctrineExtracts: 0, editorialFlags: 0 },
      };

      prismaService.digest.findUnique.mockResolvedValue(privateDigest);

      await expect(service.findById('digest-1', 'user-1', 'org-1')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.findById('digest-1', 'user-1', 'org-1')).rejects.toThrow(
        'You do not have access to this digest',
      );
    });

    it('should allow access to public_editorial digest', async () => {
      const publicDigest = {
        ...mockDigest,
        userId: 'other-user',
        organizationId: 'other-org',
        visibility: 'public_editorial',
        legalDocument: mockLegalDocument,
        reviews: [],
        _count: { doctrineExtracts: 0, editorialFlags: 0 },
      };

      prismaService.digest.findUnique.mockResolvedValue(publicDigest);

      const result = await service.findById('digest-1', 'user-1', 'org-1');

      expect(result).toEqual(publicDigest);
    });

    it('should allow access to org digest from same organization', async () => {
      const orgDigest = {
        ...mockDigest,
        userId: 'other-user',
        organizationId: 'org-1',
        visibility: 'org',
        legalDocument: mockLegalDocument,
        reviews: [],
        _count: { doctrineExtracts: 0, editorialFlags: 0 },
      };

      prismaService.digest.findUnique.mockResolvedValue(orgDigest);

      const result = await service.findById('digest-1', 'user-1', 'org-1');

      expect(result).toEqual(orgDigest);
    });

    it('should throw ForbiddenException for org digest from different organization', async () => {
      const orgDigest = {
        ...mockDigest,
        userId: 'other-user',
        organizationId: 'other-org',
        visibility: 'org',
        legalDocument: mockLegalDocument,
        reviews: [],
        _count: { doctrineExtracts: 0, editorialFlags: 0 },
      };

      prismaService.digest.findUnique.mockResolvedValue(orgDigest);

      await expect(service.findById('digest-1', 'user-1', 'org-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('list', () => {
    const listQuery: ListDigestsQueryDto = {
      limit: 20,
    };

    it('should return paginated results with hasNext false', async () => {
      const mockDigests = [
        { ...mockDigest, id: 'digest-1', legalDocument: mockLegalDocument },
        { ...mockDigest, id: 'digest-2', legalDocument: mockLegalDocument },
      ];

      prismaService.digest.findMany.mockResolvedValue(mockDigests);

      const result = await service.list('user-1', 'org-1', listQuery);

      expect(prismaService.digest.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { userId: 'user-1', visibility: 'private' },
            { organizationId: 'org-1', visibility: 'org' },
            { visibility: 'public_editorial', reviewStatus: 'approved' },
          ],
        },
        take: 21,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        include: {
          legalDocument: {
            select: {
              id: true,
              title: true,
              shortTitle: true,
              citationText: true,
              grNo: true,
              court: true,
              decisionDate: true,
              documentType: true,
            },
          },
        },
      });
      expect(result).toEqual({
        items: mockDigests,
        meta: {
          hasNext: false,
          nextCursor: undefined,
          limit: 20,
        },
      });
    });

    it('should return paginated results with hasNext true', async () => {
      const mockDigests = Array.from({ length: 21 }, (_, i) => ({
        ...mockDigest,
        id: `digest-${i + 1}`,
        legalDocument: mockLegalDocument,
      }));

      prismaService.digest.findMany.mockResolvedValue(mockDigests);

      const result = await service.list('user-1', 'org-1', listQuery);

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('digest-20');
    });

    it('should apply filters correctly', async () => {
      const queryWithFilters: ListDigestsQueryDto = {
        limit: 20,
        legalDocumentId: 'doc-1',
        digestType: 'case_digest',
        reviewStatus: 'approved',
        sourceOrigin: 'official_pipeline',
        visibility: 'public_editorial',
      };

      prismaService.digest.findMany.mockResolvedValue([]);

      await service.list('user-1', 'org-1', queryWithFilters);

      expect(prismaService.digest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            legalDocumentId: 'doc-1',
            digestType: 'case_digest',
            reviewStatus: 'approved',
            sourceOrigin: 'official_pipeline',
            visibility: 'public_editorial',
          }),
        }),
      );
    });

    it('should handle cursor-based pagination', async () => {
      const queryWithCursor: ListDigestsQueryDto = {
        limit: 20,
        cursor: 'digest-10',
      };

      prismaService.digest.findMany.mockResolvedValue([]);

      await service.list('user-1', 'org-1', queryWithCursor);

      expect(prismaService.digest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'digest-10' },
        }),
      );
    });

    it('should order by updatedAt desc so freshly-approved digests surface', async () => {
      prismaService.digest.findMany.mockResolvedValue([]);

      await service.list('user-1', 'org-1', listQuery);

      const call = prismaService.digest.findMany.mock.calls[0][0];
      expect(call?.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
    });

    it('should honor orderBy/orderDirection and keep id as keyset tiebreaker', async () => {
      prismaService.digest.findMany.mockResolvedValue([]);

      await service.list('user-1', 'org-1', {
        ...listQuery,
        orderBy: 'createdAt',
        orderDirection: 'asc',
      });

      const call = prismaService.digest.findMany.mock.calls[0][0];
      expect(call?.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'desc' }]);
    });
  });

  describe('update', () => {
    const updateDto: UpdateDigestDto = {
      title: 'Updated Title',
      facts: 'Updated facts',
      visibility: 'org',
    };

    it('should update a digest successfully', async () => {
      prismaService.digest.findUnique.mockResolvedValue(mockDigest);
      prismaService.digest.update.mockResolvedValue({
        ...mockDigest,
        ...updateDto,
        legalDocument: mockLegalDocument,
      });

      const result = await service.update('digest-1', updateDto, 'user-1', 'org-1');

      expect(prismaService.digest.update).toHaveBeenCalledWith({
        where: { id: 'digest-1' },
        data: {
          title: 'Updated Title',
          facts: 'Updated facts',
          visibility: 'org',
        },
        include: {
          legalDocument: {
            select: {
              id: true,
              title: true,
              shortTitle: true,
              citationText: true,
              grNo: true,
            },
          },
        },
      });
      expect(result.title).toBe('Updated Title');
    });

    it('should throw NotFoundException if digest does not exist', async () => {
      prismaService.digest.findUnique.mockResolvedValue(null);

      await expect(
        service.update('digest-999', updateDto, 'user-1', 'org-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should block changing user_scan visibility to non-private', async () => {
      const userScanDigest = {
        ...mockDigest,
        sourceOrigin: 'user_scan',
      };

      prismaService.digest.findUnique.mockResolvedValue(userScanDigest);

      const invalidUpdate: UpdateDigestDto = {
        visibility: 'public_editorial',
      };

      await expect(
        service.update('digest-1', invalidUpdate, 'user-1', 'org-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update('digest-1', invalidUpdate, 'user-1', 'org-1'),
      ).rejects.toThrow('Digests from user scans cannot be promoted to non-private visibility');
    });

    it('should allow changing user_scan visibility to private', async () => {
      const userScanDigest = {
        ...mockDigest,
        sourceOrigin: 'camera_capture',
      };

      prismaService.digest.findUnique.mockResolvedValue(userScanDigest);
      prismaService.digest.update.mockResolvedValue({
        ...userScanDigest,
        visibility: 'private',
        legalDocument: mockLegalDocument,
      });

      const validUpdate: UpdateDigestDto = {
        visibility: 'private',
      };

      await expect(
        service.update('digest-1', validUpdate, 'user-1', 'org-1'),
      ).resolves.toBeDefined();
    });

    it('should throw ForbiddenException for unauthorized user', async () => {
      const privateDigest = {
        ...mockDigest,
        userId: 'other-user',
        visibility: 'private',
      };

      prismaService.digest.findUnique.mockResolvedValue(privateDigest);

      await expect(
        service.update('digest-1', updateDto, 'user-1', 'org-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    // assertDigestAccess permits visibility='public_editorial' for READS so the
    // editorial corpus is world-readable. WRITES must NOT inherit that — admin
    // mutations go through DigestsAdminController (permission-gated), and
    // owner mutations are still allowed on this path.
    it('should throw ForbiddenException for non-owner editing a public_editorial digest', async () => {
      const publicDigest = {
        ...mockDigest,
        userId: 'other-user',
        visibility: 'public_editorial',
      };

      prismaService.digest.findUnique.mockResolvedValue(publicDigest);

      await expect(
        service.update('digest-1', updateDto, 'user-1', 'org-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.update('digest-1', updateDto, 'user-1', 'org-1'),
      ).rejects.toThrow(
        'Editorial digests can only be modified by their owner or an editor',
      );
      expect(prismaService.digest.update).not.toHaveBeenCalled();
    });

    it('should allow owner to edit their own public_editorial digest', async () => {
      const ownedPublicDigest = {
        ...mockDigest,
        userId: 'user-1',
        visibility: 'public_editorial',
        sourceOrigin: 'official_pipeline',
      };

      prismaService.digest.findUnique.mockResolvedValue(ownedPublicDigest);
      prismaService.digest.update.mockResolvedValue({
        ...ownedPublicDigest,
        title: 'Updated Title',
        legalDocument: mockLegalDocument,
      });

      // Pass an update that doesn't try to change visibility so the
      // user-scan/private-promotion guard doesn't fire.
      const ownerUpdate: UpdateDigestDto = {
        title: 'Updated Title',
        facts: 'Updated facts',
      };

      const result = await service.update('digest-1', ownerUpdate, 'user-1', 'org-1');

      expect(prismaService.digest.update).toHaveBeenCalledTimes(1);
      expect(result.title).toBe('Updated Title');
    });
  });

  describe('delete', () => {
    it('should delete a digest successfully for the creator', async () => {
      prismaService.digest.findUnique.mockResolvedValue(mockDigest);
      prismaService.digest.delete.mockResolvedValue(mockDigest);

      await service.delete('digest-1', 'user-1', 'org-1');

      expect(prismaService.digest.delete).toHaveBeenCalledWith({
        where: { id: 'digest-1' },
      });
    });

    it('should throw NotFoundException if digest does not exist', async () => {
      prismaService.digest.findUnique.mockResolvedValue(null);

      await expect(service.delete('digest-999', 'user-1', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if user is not the creator', async () => {
      const otherUserDigest = {
        ...mockDigest,
        userId: 'other-user',
        visibility: 'org', // org visibility passes assertDigestAccess (same org) but not creator check
      };

      prismaService.digest.findUnique.mockResolvedValue(otherUserDigest);

      await expect(service.delete('digest-1', 'user-1', 'org-1')).rejects.toThrow(
        'Only the digest creator can delete it',
      );
    });

    it('should allow deletion for owner even with different org', async () => {
      const digestDifferentOrg = {
        ...mockDigest,
        userId: 'user-1',
        organizationId: 'other-org',
        visibility: 'private',
      };

      prismaService.digest.findUnique.mockResolvedValue(digestDifferentOrg);
      prismaService.digest.delete.mockResolvedValue(digestDifferentOrg);

      await service.delete('digest-1', 'user-1', 'org-1');

      expect(prismaService.digest.delete).toHaveBeenCalledWith({
        where: { id: 'digest-1' },
      });
    });
  });

  describe('Review status determination (via create)', () => {
    it('should set draft status when confidence is null', async () => {
      const dto: CreateDigestDto = {
        legalDocumentId: 'doc-1',
        sourceOrigin: 'official_pipeline',
        title: 'Test Digest',
        digestType: 'case_digest',
      };

      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        confidenceScore: null,
        reviewStatus: 'draft',
      });

      const result = await service.create(dto, 'user-1', 'org-1');

      expect(result.reviewStatus).toBe('draft');
    });

    it('should set needs_human_review when confidence is 0.5', async () => {
      const dto: CreateDigestDto = {
        legalDocumentId: 'doc-1',
        sourceOrigin: 'official_pipeline',
        title: 'Test Digest',
        digestType: 'case_digest',
        confidenceScore: 0.5,
      };

      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        confidenceScore: 0.5,
        reviewStatus: 'needs_human_review',
      });

      const result = await service.create(dto, 'user-1', 'org-1');

      expect(result.reviewStatus).toBe('needs_human_review');
    });

    it('should set needs_human_review when confidence is exactly below threshold', async () => {
      const dto: CreateDigestDto = {
        legalDocumentId: 'doc-1',
        sourceOrigin: 'official_pipeline',
        title: 'Test Digest',
        digestType: 'case_digest',
        confidenceScore: 0.69,
      };

      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        confidenceScore: 0.69,
        reviewStatus: 'needs_human_review',
      });

      const result = await service.create(dto, 'user-1', 'org-1');

      expect(result.reviewStatus).toBe('needs_human_review');
    });

    it('should set ai_generated when confidence is 0.8 and source is official_pipeline', async () => {
      const dto: CreateDigestDto = {
        legalDocumentId: 'doc-1',
        sourceOrigin: 'official_pipeline',
        title: 'Test Digest',
        digestType: 'case_digest',
        confidenceScore: 0.8,
      };

      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        confidenceScore: 0.8,
        reviewStatus: 'ai_generated',
      });

      const result = await service.create(dto, 'user-1', 'org-1');

      expect(result.reviewStatus).toBe('ai_generated');
    });

    it('should set ai_generated when confidence is exactly at threshold', async () => {
      const dto: CreateDigestDto = {
        legalDocumentId: 'doc-1',
        sourceOrigin: 'official_pipeline',
        title: 'Test Digest',
        digestType: 'case_digest',
        confidenceScore: CONFIDENCE_THRESHOLD,
      };

      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        confidenceScore: CONFIDENCE_THRESHOLD,
        reviewStatus: 'ai_generated',
      });

      const result = await service.create(dto, 'user-1', 'org-1');

      expect(result.reviewStatus).toBe('ai_generated');
    });

    it('should set ai_generated for user_upload source with high confidence', async () => {
      const dto: CreateDigestDto = {
        legalDocumentId: 'doc-1',
        sourceOrigin: 'user_upload',
        title: 'Test Digest',
        digestType: 'case_digest',
        confidenceScore: 0.9,
      };

      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        sourceOrigin: 'user_upload',
        confidenceScore: 0.9,
        reviewStatus: 'ai_generated',
        visibility: 'private',
      });

      const result = await service.create(dto, 'user-1', 'org-1');

      expect(result.reviewStatus).toBe('ai_generated');
      expect(result.visibility).toBe('private');
    });
  });

  describe('Edge cases and additional coverage', () => {
    it('should handle digest without legalDocumentId', async () => {
      const dto: CreateDigestDto = {
        sourceOrigin: 'official_pipeline',
        title: 'Test Digest',
        digestType: 'case_digest',
      };

      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        legalDocumentId: null,
      });

      const result = await service.create(dto, 'user-1', 'org-1');

      expect(prismaService.legalDocument.count).not.toHaveBeenCalled();
      expect(result.legalDocumentId).toBeNull();
    });

    it('should trim whitespace from title and content fields', async () => {
      const dto: CreateDigestDto = {
        legalDocumentId: 'doc-1',
        sourceOrigin: 'official_pipeline',
        title: '  Test Digest  ',
        digestType: 'case_digest',
        facts: '  Facts content  ',
        issues: '  Issues content  ',
        ruling: '  Ruling content  ',
      };

      prismaService.legalDocument.count.mockResolvedValue(1);
      prismaService.digest.create.mockResolvedValue({
        ...mockDigest,
        title: 'Test Digest',
        facts: 'Facts content',
      });

      await service.create(dto, 'user-1', 'org-1');

      expect(prismaService.digest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Test Digest',
            facts: 'Facts content',
            issues: 'Issues content',
            ruling: 'Ruling content',
          }),
        }),
      );
    });

    it('should handle all user scan origin types', async () => {
      for (const origin of USER_SCAN_ORIGINS) {
        const dto: CreateDigestDto = {
          legalDocumentId: 'doc-1',
          sourceOrigin: origin,
          title: 'Test Digest',
          digestType: 'case_digest',
          visibility: 'public_editorial',
        };

        prismaService.legalDocument.count.mockResolvedValue(1);
        prismaService.digest.create.mockResolvedValue({
          ...mockDigest,
          sourceOrigin: origin,
          visibility: 'private',
        });

        const result = await service.create(dto, 'user-1', 'org-1');

        expect(result.visibility).toBe('private');
      }
    });

    it('should allow creator to access any visibility level of their own digest', async () => {
      const visibilities = ['private', 'org', 'public_editorial'];

      for (const visibility of visibilities) {
        const digest = {
          ...mockDigest,
          userId: 'user-1',
          visibility,
          legalDocument: mockLegalDocument,
          reviews: [],
          _count: { doctrineExtracts: 0, editorialFlags: 0 },
        };

        prismaService.digest.findUnique.mockResolvedValue(digest);

        const result = await service.findById('digest-1', 'user-1', 'org-1');

        expect(result).toEqual(digest);
      }
    });
  });

  // ---- findByIdAdmin ----

  describe('findByIdAdmin', () => {
    it('should return an AI-generated digest with userId=null and organizationId=null', async () => {
      const aiGeneratedDigest = {
        ...mockDigest,
        id: 'ai-digest-1',
        userId: null,
        organizationId: null,
        visibility: 'private',
        sourceOrigin: 'official_pipeline',
        confidenceScore: 0.75,
        reviewStatus: 'needs_human_review',
        legalDocument: mockLegalDocument,
        reviews: [],
        derivativeGenerationJob: {
          id: 'job-1',
          derivativeType: 'case_digest',
          modelName: 'gpt-4o',
          promptTemplateVersion: 'v1.0',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          tokensIn: 5000,
          tokensOut: 2000,
          estimatedCostUsd: 0.08,
        },
        _count: { doctrineExtracts: 2, editorialFlags: 0 },
      };

      prismaService.digest.findUnique.mockResolvedValue(aiGeneratedDigest);

      const result = await service.findByIdAdmin('ai-digest-1');

      expect(result).toEqual(aiGeneratedDigest);
      expect(result.userId).toBeNull();
      expect(result.organizationId).toBeNull();
      expect(result.visibility).toBe('private');
    });

    it('should throw NotFoundException if digest does not exist', async () => {
      prismaService.digest.findUnique.mockResolvedValue(null);

      await expect(service.findByIdAdmin('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findByIdAdmin('nonexistent-id')).rejects.toThrow(
        'Digest not found',
      );
    });

    it('should NOT call assertDigestAccess (no visibility enforcement)', async () => {
      const privateDigestDifferentUser = {
        ...mockDigest,
        userId: 'other-user',
        organizationId: 'other-org',
        visibility: 'private',
        legalDocument: mockLegalDocument,
        reviews: [],
        derivativeGenerationJob: null,
        _count: { doctrineExtracts: 0, editorialFlags: 0 },
      };

      prismaService.digest.findUnique.mockResolvedValue(privateDigestDifferentUser);

      // findByIdAdmin should succeed without userId/orgId — no access check
      const result = await service.findByIdAdmin('digest-1');
      expect(result).toEqual(privateDigestDifferentUser);
    });

    it('should include derivativeGenerationJob in response', async () => {
      const digestWithJob = {
        ...mockDigest,
        userId: null,
        organizationId: null,
        legalDocument: mockLegalDocument,
        reviews: [],
        derivativeGenerationJob: {
          id: 'job-1',
          derivativeType: 'case_digest',
          modelName: 'gpt-4o',
          promptTemplateVersion: 'v1.0',
          startedAt: null,
          finishedAt: null,
          tokensIn: 0,
          tokensOut: 0,
          estimatedCostUsd: 0,
        },
        _count: { doctrineExtracts: 0, editorialFlags: 0 },
      };

      prismaService.digest.findUnique.mockResolvedValue(digestWithJob);

      const result = await service.findByIdAdmin('digest-1');

      expect(result.derivativeGenerationJob).toBeDefined();
      expect(result.derivativeGenerationJob?.id).toBe('job-1');
    });
  });

  // ---- findByDocumentIds ----

  describe('findByDocumentIds', () => {
    const mockDigestWithDoc = {
      ...mockDigest,
      legalDocument: mockLegalDocument,
    };

    it('should return digests for given document IDs', async () => {
      prismaService.digest.findMany.mockResolvedValue([mockDigestWithDoc]);

      const result = await service.findByDocumentIds(
        ['doc-1', 'doc-2'],
        'user-1',
        'org-1',
      );

      expect(result).toEqual([mockDigestWithDoc]);
      expect(prismaService.digest.findMany).toHaveBeenCalledTimes(1);
    });

    it('should filter by document IDs using IN clause', async () => {
      prismaService.digest.findMany.mockResolvedValue([]);

      await service.findByDocumentIds(['doc-1', 'doc-2', 'doc-3'], 'user-1', 'org-1');

      const call = prismaService.digest.findMany.mock.calls[0][0];
      expect(call?.where?.legalDocumentId).toEqual({
        in: ['doc-1', 'doc-2', 'doc-3'],
      });
    });

    it('should apply visibility rules: private for owner', async () => {
      prismaService.digest.findMany.mockResolvedValue([]);

      await service.findByDocumentIds(['doc-1'], 'user-1', 'org-1');

      const call = prismaService.digest.findMany.mock.calls[0][0];
      const orClause = call?.where?.OR;
      expect(orClause).toEqual(
        expect.arrayContaining([
          { userId: 'user-1', visibility: 'private' },
        ]),
      );
    });

    it('should apply visibility rules: org for members', async () => {
      prismaService.digest.findMany.mockResolvedValue([]);

      await service.findByDocumentIds(['doc-1'], 'user-1', 'org-1');

      const call = prismaService.digest.findMany.mock.calls[0][0];
      const orClause = call?.where?.OR;
      expect(orClause).toEqual(
        expect.arrayContaining([
          { organizationId: 'org-1', visibility: 'org' },
        ]),
      );
    });

    it('should apply visibility rules: public_editorial only when approved', async () => {
      prismaService.digest.findMany.mockResolvedValue([]);

      await service.findByDocumentIds(['doc-1'], 'user-1', 'org-1');

      const call = prismaService.digest.findMany.mock.calls[0][0];
      const orClause = call?.where?.OR;
      expect(orClause).toEqual(
        expect.arrayContaining([
          { visibility: 'public_editorial', reviewStatus: 'approved' },
        ]),
      );
    });

    it('should order by createdAt desc', async () => {
      prismaService.digest.findMany.mockResolvedValue([]);

      await service.findByDocumentIds(['doc-1'], 'user-1', 'org-1');

      const call = prismaService.digest.findMany.mock.calls[0][0];
      expect(call?.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('should include legal document metadata', async () => {
      prismaService.digest.findMany.mockResolvedValue([]);

      await service.findByDocumentIds(['doc-1'], 'user-1', 'org-1');

      const call = prismaService.digest.findMany.mock.calls[0][0];
      expect(call?.include?.legalDocument?.select).toEqual(
        expect.objectContaining({
          id: true,
          title: true,
          citationText: true,
          court: true,
          documentType: true,
        }),
      );
    });

    it('should return empty array for empty input', async () => {
      prismaService.digest.findMany.mockResolvedValue([]);

      const result = await service.findByDocumentIds([], 'user-1', 'org-1');

      expect(result).toEqual([]);
    });

    it('should return multiple digests for multiple documents', async () => {
      const digest2 = { ...mockDigestWithDoc, id: 'digest-2', legalDocumentId: 'doc-2' };
      prismaService.digest.findMany.mockResolvedValue([mockDigestWithDoc, digest2]);

      const result = await service.findByDocumentIds(
        ['doc-1', 'doc-2'],
        'user-1',
        'org-1',
      );

      expect(result).toHaveLength(2);
    });
  });

  // ---- countByDocumentIds ----

  describe('countByDocumentIds', () => {
    it('should return count of matching digests', async () => {
      prismaService.digest.count.mockResolvedValue(5);

      const result = await service.countByDocumentIds(
        ['doc-1', 'doc-2'],
        'user-1',
        'org-1',
      );

      expect(result).toBe(5);
      expect(prismaService.digest.count).toHaveBeenCalledTimes(1);
    });

    it('should apply same visibility rules as findByDocumentIds', async () => {
      prismaService.digest.count.mockResolvedValue(0);

      await service.countByDocumentIds(['doc-1'], 'user-1', 'org-1');

      const call = prismaService.digest.count.mock.calls[0][0];
      expect(call?.where?.legalDocumentId).toEqual({ in: ['doc-1'] });
      expect(call?.where?.OR).toEqual([
        { userId: 'user-1', visibility: 'private' },
        { organizationId: 'org-1', visibility: 'org' },
        { visibility: 'public_editorial', reviewStatus: 'approved' },
      ]);
    });

    it('should return 0 for empty input', async () => {
      prismaService.digest.count.mockResolvedValue(0);

      const result = await service.countByDocumentIds([], 'user-1', 'org-1');

      expect(result).toBe(0);
    });
  });

  // ---- free-plan preview cap (previewOnly) ----

  describe('free-plan preview cap (previewOnly)', () => {
    const previewDigest = {
      id: 'digest-preview',
      visibility: 'public_editorial',
      reviewStatus: 'approved',
      legalDocument: mockLegalDocument,
    };

    describe('list', () => {
      it('returns the single preview digest and stamps meta.previewMode when previewOnly=true', async () => {
        prismaService.digest.findFirst.mockResolvedValue({ id: 'digest-preview' });
        prismaService.digest.count.mockResolvedValue(50);
        prismaService.digest.findMany.mockResolvedValue([previewDigest]);

        const result = await service.list('user-1', 'org-1', {}, true);

        expect(result.items).toHaveLength(1);
        expect(result.items[0]!.id).toBe('digest-preview');
        expect(result.meta).toMatchObject({
          previewMode: true,
          lockedCount: 49, // 50 - 1 preview
          upgradeRequired: true,
          hasNext: false,
        });
      });

      it('returns empty list and lockedCount=0 when no public_editorial digest exists', async () => {
        prismaService.digest.findFirst.mockResolvedValue(null);
        prismaService.digest.count.mockResolvedValue(0);

        const result = await service.list('user-1', 'org-1', {}, true);

        expect(result.items).toEqual([]);
        expect(result.meta).toMatchObject({
          previewMode: true,
          lockedCount: 0,
        });
      });

      it('behaves unchanged when previewOnly=false', async () => {
        prismaService.digest.findMany.mockResolvedValue([]);

        const result = await service.list('user-1', 'org-1', {}, false);

        expect(result.meta).not.toHaveProperty('previewMode');
        // No preview-id lookup
        expect(prismaService.digest.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('search', () => {
      it('returns only the preview digest with lockedCount when previewOnly=true', async () => {
        prismaService.digest.findFirst.mockResolvedValue({ id: 'digest-preview' });
        prismaService.digest.count.mockResolvedValue(120);
        prismaService.digest.findMany.mockResolvedValue([previewDigest]);

        const result = await service.search({ q: 'people v doe' }, true);

        expect(result.results).toHaveLength(1);
        expect(result.results[0]!.id).toBe('digest-preview');
        expect(result.previewMode).toBe(true);
        expect(result.lockedCount).toBe(119);
        expect(result.matchedDocuments).toEqual([]);
      });

      it('behaves unchanged when previewOnly=false (or omitted)', async () => {
        // Stub `legalDocument.findMany` because the non-preview search path
        // hits it when the digest result set is empty.
        (prismaService.legalDocument as unknown as { findMany: jest.Mock }).findMany =
          jest.fn().mockResolvedValue([]);
        // Return a non-empty digest list so we skip the matchedDocuments branch.
        prismaService.digest.findMany.mockResolvedValue([
          { id: 'd1', legalDocument: mockLegalDocument },
        ]);

        const result = await service.search({ q: 'people v doe' });

        expect(result).not.toHaveProperty('previewMode');
      });
    });

    describe('findById', () => {
      it('throws PaywallException when previewOnly=true and id is NOT the preview digest', async () => {
        prismaService.digest.findFirst.mockResolvedValue({ id: 'digest-preview' });

        await expect(
          service.findById('other-digest-id', 'user-1', 'org-1', true),
        ).rejects.toBeInstanceOf(PaywallException);

        // Should NOT have called findUnique once paywall throws
        expect(prismaService.digest.findUnique).not.toHaveBeenCalled();
      });

      it('returns the digest when previewOnly=true and id IS the preview digest', async () => {
        prismaService.digest.findFirst.mockResolvedValue({ id: 'digest-preview' });
        const digestWithIncludes = {
          ...mockDigest,
          id: 'digest-preview',
          userId: 'user-1', // owner gets access through assertDigestAccess
          legalDocument: mockLegalDocument,
          reviews: [],
          _count: { doctrineExtracts: 0, editorialFlags: 0 },
        };
        prismaService.digest.findUnique.mockResolvedValue(digestWithIncludes);

        const result = await service.findById(
          'digest-preview',
          'user-1',
          'org-1',
          true,
        );

        expect(result.id).toBe('digest-preview');
      });

      it('behaves unchanged when previewOnly=false', async () => {
        const digestWithIncludes = {
          ...mockDigest,
          legalDocument: mockLegalDocument,
          reviews: [],
          _count: { doctrineExtracts: 0, editorialFlags: 0 },
        };
        prismaService.digest.findUnique.mockResolvedValue(digestWithIncludes);

        const result = await service.findById('digest-1', 'user-1', 'org-1', false);

        expect(result).toEqual(digestWithIncludes);
        // No preview-id lookup
        expect(prismaService.digest.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('getFreePreviewDigestId', () => {
      it('returns the id of the newest public_editorial+approved digest', async () => {
        prismaService.digest.findFirst.mockResolvedValue({ id: 'digest-preview' });

        const id = await service.getFreePreviewDigestId();
        expect(id).toBe('digest-preview');

        const call = prismaService.digest.findFirst.mock.calls[0][0];
        expect(call.where).toEqual({
          visibility: 'public_editorial',
          reviewStatus: 'approved',
        });
        expect(call.orderBy).toEqual({ createdAt: 'desc' });
      });

      it('returns null when no digest matches', async () => {
        prismaService.digest.findFirst.mockResolvedValue(null);

        const id = await service.getFreePreviewDigestId();
        expect(id).toBeNull();
      });
    });

    describe('getReviewStats', () => {
      it('counts only pending-review digests for total (excludes approved + rejected)', async () => {
        prismaService.digest.count.mockResolvedValue(7);
        prismaService.digest.groupBy.mockResolvedValue([]);
        prismaService.digest.aggregate.mockResolvedValue({
          _avg: { confidenceScore: null },
        });
        prismaService.$queryRaw.mockResolvedValue([]);

        const stats = await service.getReviewStats();

        expect(stats.total).toBe(7);
        // First digest.count call computes the queue total; it must exclude
        // the terminal review states so approving/rejecting decrements it.
        const totalCountArgs = prismaService.digest.count.mock.calls[0][0];
        expect(totalCountArgs).toEqual({
          where: { reviewStatus: { notIn: ['approved', 'rejected'] } },
        });
      });

      it('scopes the unassigned count to pending digests only', async () => {
        prismaService.digest.count.mockResolvedValue(3);
        prismaService.digest.groupBy.mockResolvedValue([]);
        prismaService.digest.aggregate.mockResolvedValue({
          _avg: { confidenceScore: null },
        });
        prismaService.$queryRaw.mockResolvedValue([]);

        await service.getReviewStats();

        // Second digest.count call computes the unassigned count; it must
        // carry the same pending-only filter as the total, otherwise the
        // "Unassigned" card can exceed "Total in Queue".
        const unassignedCountArgs = prismaService.digest.count.mock.calls[1][0];
        expect(unassignedCountArgs).toEqual({
          where: {
            assignedReviewerUserId: null,
            reviewStatus: { notIn: ['approved', 'rejected'] },
          },
        });
      });
    });
  });

  describe('batchApprove / batchReject idempotency', () => {
    const reviewerUserId = 'reviewer-1';

    describe('batchApprove', () => {
      it('skips digests that are already terminal and processes only pending ones', async () => {
        // DB-side filter returns only the pending digest even though two IDs
        // were submitted (digest-approved is already terminal).
        prismaService.digest.findMany.mockResolvedValue([
          {
            id: 'digest-pending',
            sourceOrigin: 'official_pipeline',
            visibility: 'private',
            userId: 'user-1',
            reviewStatus: 'ai_generated',
          },
        ]);
        prismaService.$transaction.mockResolvedValue([]);

        const result = await service.batchApprove(
          { digestIds: ['digest-pending', 'digest-approved'] },
          reviewerUserId,
        );

        expect(prismaService.digest.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: { in: ['digest-pending', 'digest-approved'] },
              reviewStatus: { notIn: ['approved', 'rejected'] },
            },
          }),
        );
        // Review rows are only created for the non-terminal digest.
        expect(prismaService.digestReview.createMany).toHaveBeenCalledWith({
          data: [
            {
              digestId: 'digest-pending',
              reviewerUserId,
              verdict: 'approve',
              notes: null,
            },
          ],
        });
        expect(prismaService.digest.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['digest-pending'] } },
          data: { reviewStatus: 'approved' },
        });
        expect(result).toEqual({
          processed: 1,
          digestIds: ['digest-pending'],
        });
      });

      it('returns processed: 0 without throwing when all supplied IDs are already terminal', async () => {
        prismaService.digest.findMany.mockResolvedValue([]);

        const result = await service.batchApprove(
          { digestIds: ['digest-approved', 'digest-rejected'] },
          reviewerUserId,
        );

        expect(result).toEqual({ processed: 0, digestIds: [] });
        expect(prismaService.digestReview.createMany).not.toHaveBeenCalled();
        expect(prismaService.digest.updateMany).not.toHaveBeenCalled();
        expect(prismaService.$transaction).not.toHaveBeenCalled();
      });
    });

    describe('batchReject', () => {
      it('skips digests that are already terminal and processes only pending ones', async () => {
        prismaService.digest.findMany.mockResolvedValue([
          { id: 'digest-pending', reviewStatus: 'needs_human_review' },
        ]);
        prismaService.$transaction.mockResolvedValue([]);

        const result = await service.batchReject(
          { digestIds: ['digest-pending', 'digest-rejected'] },
          reviewerUserId,
        );

        expect(prismaService.digest.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: { in: ['digest-pending', 'digest-rejected'] },
              reviewStatus: { notIn: ['approved', 'rejected'] },
            },
          }),
        );
        expect(prismaService.digestReview.createMany).toHaveBeenCalledWith({
          data: [
            {
              digestId: 'digest-pending',
              reviewerUserId,
              verdict: 'reject',
              notes: null,
            },
          ],
        });
        expect(prismaService.digest.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['digest-pending'] } },
          data: { reviewStatus: 'rejected' },
        });
        expect(result).toEqual({
          processed: 1,
          digestIds: ['digest-pending'],
        });
      });

      it('returns processed: 0 without throwing when all supplied IDs are already terminal', async () => {
        prismaService.digest.findMany.mockResolvedValue([]);

        const result = await service.batchReject(
          { digestIds: ['digest-approved'] },
          reviewerUserId,
        );

        expect(result).toEqual({ processed: 0, digestIds: [] });
        expect(prismaService.digestReview.createMany).not.toHaveBeenCalled();
        expect(prismaService.digest.updateMany).not.toHaveBeenCalled();
        expect(prismaService.$transaction).not.toHaveBeenCalled();
      });
    });
  });
});

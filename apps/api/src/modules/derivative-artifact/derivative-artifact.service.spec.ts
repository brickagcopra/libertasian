import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { DerivativeArtifactService } from './derivative-artifact.service';
import { CreateDerivativeArtifactDto } from './dto';

/**
 * Unit tests for `DerivativeArtifactService.create`. The Prisma client is
 * fully mocked — the real DB writes (and the §2.2 unique constraint) are
 * exercised by the e2e suite in `test/derivative-artifact.e2e-spec.ts`.
 */

type MockTx = {
  contentDisclaimer: { findUnique: jest.Mock };
  derivativeArtifact: { create: jest.Mock };
  provenanceRecord: { createMany: jest.Mock };
};

const DISCLAIMER_ID = '00000000-0000-0000-0000-000000000001';
const SOURCE_DOC_ID = '00000000-0000-0000-0000-000000000010';
const SOURCE_SECTION_ID = '00000000-0000-0000-0000-000000000011';
const ARTIFACT_ID = '00000000-0000-0000-0000-0000000000aa';

const makeDto = (
  overrides: Partial<CreateDerivativeArtifactDto> = {},
): CreateDerivativeArtifactDto => ({
  derivativeType: 'case_digest',
  sourceDocumentId: SOURCE_DOC_ID,
  title: 'Test case digest',
  contentJson: {
    factsHtml: '<p>Test facts</p>',
    issuesHtml: '<p>Test issues</p>',
    rulingHtml: '<p>Test ruling</p>',
  },
  contentHash: 'sha256:aaaaaaaa',
  contentRights: 'ai_generated_derivative',
  contentDisclaimerId: DISCLAIMER_ID,
  provenanceRecords: [
    {
      sourceDocumentId: SOURCE_DOC_ID,
      sourceSectionId: SOURCE_SECTION_ID,
      provenanceType: 'source_passage',
    },
  ],
  ...overrides,
});

const makeArtifactRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: ARTIFACT_ID,
  derivativeType: 'case_digest',
  sourceDocumentId: SOURCE_DOC_ID,
  sourceSectionId: null,
  organizationId: null,
  createdByUserId: null,
  derivativeGenerationJobId: null,
  title: 'Test case digest',
  contentJson: {
    factsHtml: '<p>Test facts</p>',
    issuesHtml: '<p>Test issues</p>',
    rulingHtml: '<p>Test ruling</p>',
  },
  contentPlainText: null,
  contentHash: 'sha256:aaaaaaaa',
  tokenCount: null,
  confidenceScore: null,
  reviewStatus: 'draft',
  validatorVerdict: null,
  validatorReasonsJson: null,
  visibility: 'private',
  audience: 'both',
  contentRights: 'ai_generated_derivative',
  contentDisclaimerId: DISCLAIMER_ID,
  modelRunId: null,
  taxonomyVersion: null,
  language: 'en',
  publishedAt: null,
  createdAt: new Date('2026-04-11T00:00:00Z'),
  updatedAt: new Date('2026-04-11T00:00:00Z'),
  ...overrides,
});

describe('DerivativeArtifactService', () => {
  let service: DerivativeArtifactService;
  let tx: MockTx;
  let prisma: { $transaction: jest.Mock };

  beforeEach(async () => {
    tx = {
      contentDisclaimer: {
        findUnique: jest.fn().mockResolvedValue({
          id: DISCLAIMER_ID,
          isActive: true,
        }),
      },
      derivativeArtifact: {
        create: jest.fn().mockResolvedValue(makeArtifactRow()),
      },
      provenanceRecord: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prisma = {
      $transaction: jest.fn(async (fn: (tx: MockTx) => unknown) => fn(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DerivativeArtifactService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DerivativeArtifactService);
  });

  describe('create — happy path', () => {
    it('opens a transaction, writes the artifact, and writes a provenance row in the same bracket', async () => {
      const result = await service.create(makeDto());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.contentDisclaimer.findUnique).toHaveBeenCalledWith({
        where: { id: DISCLAIMER_ID },
        select: { id: true, isActive: true },
      });
      expect(tx.derivativeArtifact.create).toHaveBeenCalledTimes(1);
      expect(tx.provenanceRecord.createMany).toHaveBeenCalledTimes(1);

      const createArgs = tx.derivativeArtifact.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createArgs.data).toMatchObject({
        derivativeType: 'case_digest',
        contentDisclaimerId: DISCLAIMER_ID,
        contentRights: 'ai_generated_derivative',
        reviewStatus: 'draft',
        visibility: 'private',
        audience: 'both',
        language: 'en',
      });

      const provArgs = tx.provenanceRecord.createMany.mock.calls[0][0] as {
        data: Array<Record<string, unknown>>;
      };
      expect(provArgs.data).toHaveLength(1);
      expect(provArgs.data[0]).toMatchObject({
        entityType: 'derivative_artifact',
        entityId: ARTIFACT_ID,
        sourceDocumentId: SOURCE_DOC_ID,
        sourceSectionId: SOURCE_SECTION_ID,
        provenanceType: 'source_passage',
      });

      expect(result.id).toBe(ARTIFACT_ID);
    });

    it('writes every provenance row when the caller passes more than one', async () => {
      const dto = makeDto({
        provenanceRecords: [
          {
            sourceDocumentId: SOURCE_DOC_ID,
            sourceSectionId: SOURCE_SECTION_ID,
            provenanceType: 'source_passage',
          },
          {
            sourceDocumentId: '00000000-0000-0000-0000-000000000020',
            provenanceType: 'cited_authority',
          },
        ],
      });

      await service.create(dto);

      const provArgs = tx.provenanceRecord.createMany.mock.calls[0][0] as {
        data: Array<Record<string, unknown>>;
      };
      expect(provArgs.data).toHaveLength(2);
      expect(provArgs.data.map((r) => r['provenanceType'])).toEqual([
        'source_passage',
        'cited_authority',
      ]);
      expect(
        provArgs.data.every((r) => r['entityType'] === 'derivative_artifact'),
      ).toBe(true);
      expect(
        provArgs.data.every((r) => r['entityId'] === ARTIFACT_ID),
      ).toBe(true);
    });

    it('honours review_status, visibility, and audience overrides', async () => {
      await service.create(
        makeDto({
          reviewStatus: 'approved',
          visibility: 'public_editorial',
          audience: 'student',
          language: 'fil',
        }),
      );

      const createArgs = tx.derivativeArtifact.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createArgs.data).toMatchObject({
        reviewStatus: 'approved',
        visibility: 'public_editorial',
        audience: 'student',
        language: 'fil',
      });
    });
  });

  describe('create — provenance missing', () => {
    it('throws BadRequestException when provenanceRecords is empty (§4.5 defence in depth)', async () => {
      const dto = makeDto({ provenanceRecords: [] });

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(dto)).rejects.toThrow(/§4.5/);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.derivativeArtifact.create).not.toHaveBeenCalled();
      expect(tx.provenanceRecord.createMany).not.toHaveBeenCalled();
    });
  });

  describe('create — disclaimer missing', () => {
    it('throws NotFoundException and skips the artifact insert when the disclaimer does not exist', async () => {
      tx.contentDisclaimer.findUnique.mockResolvedValueOnce(null);

      await expect(service.create(makeDto())).rejects.toThrow(NotFoundException);

      expect(tx.contentDisclaimer.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.derivativeArtifact.create).not.toHaveBeenCalled();
      expect(tx.provenanceRecord.createMany).not.toHaveBeenCalled();
    });
  });

  describe('create — unique constraint violation surfaces cleanly', () => {
    it('wraps P2002 from the @@unique([sourceDocumentId, derivativeType, taxonomyVersion]) as ConflictException', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '0.0.0-test',
          meta: {
            target: [
              'source_document_id',
              'derivative_type',
              'taxonomy_version',
            ],
          },
        },
      );
      tx.derivativeArtifact.create.mockRejectedValue(p2002);

      const err = await service
        .create(makeDto())
        .then(() => null)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(/already exists/i);
    });

    it('wraps P2003 foreign-key violations as BadRequestException', async () => {
      const p2003 = new Prisma.PrismaClientKnownRequestError(
        'Foreign key failed',
        {
          code: 'P2003',
          clientVersion: '0.0.0-test',
          meta: { field_name: 'derivative_artifacts_model_run_id_fkey' },
        },
      );
      tx.derivativeArtifact.create.mockRejectedValueOnce(p2003);

      await expect(service.create(makeDto())).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

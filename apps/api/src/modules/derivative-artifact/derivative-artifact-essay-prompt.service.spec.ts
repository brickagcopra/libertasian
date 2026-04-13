import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { DerivativeArtifactService } from './derivative-artifact.service';
import {
  CreateBarExamSittingDto,
  CreateEssayPromptDto,
} from './dto';

/**
 * Unit tests for `DerivativeArtifactService.createEssayPrompt` and
 * `createBarExamSitting`. The Prisma client is fully mocked — the real
 * DB writes are exercised by the e2e suite.
 */

type MockTx = {
  contentDisclaimer: { findUnique: jest.Mock };
  derivativeArtifact: { create: jest.Mock };
  provenanceRecord: { createMany: jest.Mock };
  essayPrompt: { create: jest.Mock };
  barExamSitting: { findUnique: jest.Mock; create: jest.Mock };
};

const DISCLAIMER_ID = '00000000-0000-0000-0000-000000000001';
const SOURCE_DOC_ID = '00000000-0000-0000-0000-000000000010';
const SOURCE_SECTION_ID = '00000000-0000-0000-0000-000000000011';
const ARTIFACT_ID = '00000000-0000-0000-0000-0000000000aa';
const ESSAY_PROMPT_ID = '00000000-0000-0000-0000-0000000000cc';
const BAR_SITTING_ID = '00000000-0000-0000-0000-0000000000dd';

const makeArtifactRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: ARTIFACT_ID,
  derivativeType: 'essay_prompt',
  sourceDocumentId: SOURCE_DOC_ID,
  sourceSectionId: null,
  organizationId: null,
  createdByUserId: null,
  derivativeGenerationJobId: null,
  title: 'Test essay prompt',
  contentJson: {
    promptText: 'Discuss the doctrine of res judicata.',
    suggestedTimeMinutes: 60,
    modelAnswerJson: null,
    rubricJson: null,
  },
  contentPlainText: null,
  contentHash: 'sha256:essayhash',
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

const makeEssayDto = (
  overrides: Partial<CreateEssayPromptDto> = {},
): CreateEssayPromptDto => ({
  sourceDocumentId: SOURCE_DOC_ID,
  title: 'Res Judicata essay prompt',
  contentHash: 'sha256:essayhash',
  contentRights: 'ai_generated_derivative',
  contentDisclaimerId: DISCLAIMER_ID,
  promptText: 'Discuss the doctrine of res judicata under Philippine law.',
  suggestedTimeMinutes: 60,
  provenanceRecords: [
    {
      sourceDocumentId: SOURCE_DOC_ID,
      sourceSectionId: SOURCE_SECTION_ID,
      provenanceType: 'source_passage',
    },
  ],
  ...overrides,
});

describe('DerivativeArtifactService — EssayPrompt', () => {
  let service: DerivativeArtifactService;
  let tx: MockTx;
  let prisma: { $transaction: jest.Mock; barExamSitting: { create: jest.Mock } };

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
      essayPrompt: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: ESSAY_PROMPT_ID,
          derivativeArtifactId: data.derivativeArtifactId,
          promptText: data.promptText,
          suggestedTimeMinutes: data.suggestedTimeMinutes ?? null,
          modelAnswerJson: data.modelAnswerJson ?? null,
          rubricJson: data.rubricJson ?? null,
          subjectTopicId: data.subjectTopicId ?? null,
          barExamSittingId: data.barExamSittingId ?? null,
        })),
      },
      barExamSitting: {
        findUnique: jest.fn().mockResolvedValue({ id: BAR_SITTING_ID }),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: BAR_SITTING_ID,
          ...data,
        })),
      },
    };

    prisma = {
      $transaction: jest.fn(async (fn: (tx: MockTx) => unknown) => fn(tx)),
      barExamSitting: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: BAR_SITTING_ID,
          ...data,
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DerivativeArtifactService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DerivativeArtifactService);
  });

  // -----------------------------------------------------------------
  // createEssayPrompt — happy path
  // -----------------------------------------------------------------
  describe('createEssayPrompt — happy path', () => {
    it('writes artifact + essay prompt + provenance inside one transaction and returns the pair', async () => {
      const result = await service.createEssayPrompt(makeEssayDto());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.contentDisclaimer.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.derivativeArtifact.create).toHaveBeenCalledTimes(1);
      expect(tx.provenanceRecord.createMany).toHaveBeenCalledTimes(1);
      expect(tx.essayPrompt.create).toHaveBeenCalledTimes(1);

      // The base artifact row is written with derivativeType forced to
      // 'essay_prompt' and contentJson built from the structured fields.
      const artifactArgs = tx.derivativeArtifact.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(artifactArgs.data['derivativeType']).toBe('essay_prompt');
      expect(artifactArgs.data['contentJson']).toMatchObject({
        promptText: expect.stringContaining('res judicata'),
        suggestedTimeMinutes: 60,
      });

      // EssayPrompt row gets the structured columns.
      const essayArgs = tx.essayPrompt.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(essayArgs.data).toMatchObject({
        derivativeArtifactId: ARTIFACT_ID,
        promptText: expect.stringContaining('res judicata'),
        suggestedTimeMinutes: 60,
      });

      expect(result.artifact.id).toBe(ARTIFACT_ID);
      expect(result.essayPrompt.id).toBe(ESSAY_PROMPT_ID);
    });

    it('creates essay prompt linked to an existing BarExamSitting', async () => {
      const dto = makeEssayDto({ barExamSittingId: BAR_SITTING_ID });

      const result = await service.createEssayPrompt(dto);

      // The barExamSitting FK was verified inside the transaction.
      expect(tx.barExamSitting.findUnique).toHaveBeenCalledWith({
        where: { id: BAR_SITTING_ID },
        select: { id: true },
      });

      const essayArgs = tx.essayPrompt.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(essayArgs.data['barExamSittingId']).toBe(BAR_SITTING_ID);

      expect(result.essayPrompt.barExamSittingId).toBe(BAR_SITTING_ID);
    });
  });

  // -----------------------------------------------------------------
  // createEssayPrompt — structural invariants
  // -----------------------------------------------------------------
  describe('createEssayPrompt — structural invariants', () => {
    it('throws BadRequestException when promptText is empty', async () => {
      await expect(
        service.createEssayPrompt(makeEssayDto({ promptText: '   ' })),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when provenanceRecords is empty (§4.5 guard)', async () => {
      await expect(
        service.createEssayPrompt(makeEssayDto({ provenanceRecords: [] })),
      ).rejects.toThrow(/§4\.5/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when rubricJson criteria maxPoints do not sum to totalPoints', async () => {
      const rubric = {
        criteria: [
          { label: 'Issue spotting', maxPoints: 10 },
          { label: 'Analysis', maxPoints: 15 },
        ],
        totalPoints: 50, // sum is 25, not 50
      };

      await expect(
        service.createEssayPrompt(makeEssayDto({ rubricJson: rubric })),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createEssayPrompt(makeEssayDto({ rubricJson: rubric })),
      ).rejects.toThrow(/does not match totalPoints/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts rubricJson when criteria maxPoints correctly sum to totalPoints', async () => {
      const rubric = {
        criteria: [
          { label: 'Issue spotting', maxPoints: 10 },
          { label: 'Analysis', maxPoints: 15 },
          { label: 'Conclusion', maxPoints: 25 },
        ],
        totalPoints: 50,
      };

      const result = await service.createEssayPrompt(
        makeEssayDto({ rubricJson: rubric }),
      );
      expect(result.artifact.id).toBe(ARTIFACT_ID);
    });

    it('accepts rubricJson without criteria/totalPoints (no validation triggered)', async () => {
      const rubric = { notes: 'Freeform rubric' };

      const result = await service.createEssayPrompt(
        makeEssayDto({ rubricJson: rubric }),
      );
      expect(result.artifact.id).toBe(ARTIFACT_ID);
    });

    it('throws BadRequestException when barExamSittingId does not exist', async () => {
      const nonExistentId = '00000000-0000-0000-0000-00000000dead';
      tx.barExamSitting.findUnique.mockResolvedValue(null);

      await expect(
        service.createEssayPrompt(
          makeEssayDto({ barExamSittingId: nonExistentId }),
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createEssayPrompt(
          makeEssayDto({ barExamSittingId: nonExistentId }),
        ),
      ).rejects.toThrow(/BarExamSitting/);

      // Restore default mock for other tests.
      tx.barExamSitting.findUnique.mockResolvedValue({ id: BAR_SITTING_ID });
    });
  });

  // -----------------------------------------------------------------
  // createEssayPrompt — error mapping
  // -----------------------------------------------------------------
  describe('createEssayPrompt — error mapping', () => {
    it('throws NotFoundException and skips artifact write when the disclaimer does not exist', async () => {
      tx.contentDisclaimer.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.createEssayPrompt(makeEssayDto()),
      ).rejects.toThrow(NotFoundException);

      expect(tx.derivativeArtifact.create).not.toHaveBeenCalled();
      expect(tx.essayPrompt.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  // createBarExamSitting
  // -----------------------------------------------------------------
  describe('createBarExamSitting', () => {
    const makeSittingDto = (
      overrides: Partial<CreateBarExamSittingDto> = {},
    ): CreateBarExamSittingDto => ({
      year: 2024,
      part: 'Day 1 AM',
      subjectStudyCode: 'remedial_law',
      taxonomyVersion: 'study_8',
      ...overrides,
    });

    it('creates a bar exam sitting with valid data and returns it', async () => {
      const result = await service.createBarExamSitting(makeSittingDto());

      expect(prisma.barExamSitting.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.barExamSitting.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createArgs.data).toMatchObject({
        year: 2024,
        part: 'Day 1 AM',
        subjectStudyCode: 'remedial_law',
        taxonomyVersion: 'study_8',
      });
      expect(result.id).toBe(BAR_SITTING_ID);
    });

    it('surfaces P2002 from @@unique([year, part, subjectStudyCode]) as ConflictException', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '0.0.0-test',
          meta: {
            target: ['year', 'part', 'subject_study_code'],
          },
        },
      );
      prisma.barExamSitting.create.mockRejectedValueOnce(p2002);

      const err = await service
        .createBarExamSitting(makeSittingDto())
        .then(() => null)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
    });

    it('creates sitting with optional fields omitted', async () => {
      const dto = makeSittingDto({
        part: undefined,
        subjectStudyCode: undefined,
        subjectBarAdminCode: undefined,
        chairperson: undefined,
        sourceDocumentId: undefined,
        sourceUrl: undefined,
      });

      const result = await service.createBarExamSitting(dto);
      expect(result.id).toBe(BAR_SITTING_ID);
    });
  });
});

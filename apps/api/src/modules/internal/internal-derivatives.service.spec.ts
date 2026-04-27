import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { AutoPromoteService } from './auto-promote.service';
import { InternalAuthGuard } from './internal-auth.guard';
import { InternalDerivativesService } from './internal-derivatives.service';
import { WriteClassificationDto, WriteDerivativeDto, WriteDigestDto, WriteDoctrinesDto, WriteEssayDto, WriteFlashcardsDto, WriteMcqBatchDto } from './dto';
import { UpdateJobStatusDto } from './dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWriteDto(overrides: Partial<WriteDerivativeDto> = {}): WriteDerivativeDto {
  return {
    derivativeType: 'case_digest',
    title: 'Republic v. Sandiganbayan — Case Digest',
    contentJson: { facts: 'test facts' },
    contentHash: 'sha256-abc123',
    contentRights: 'cc_by_nc_4.0',
    contentDisclaimerId: '00000000-0000-0000-0000-000000000001',
    provenanceRecords: [
      {
        sourceDocumentId: '00000000-0000-0000-0000-000000000010',
        provenanceType: 'source_passage',
      },
    ],
    ...overrides,
  } as WriteDerivativeDto;
}

function makeWriteDigestDto(overrides: Partial<WriteDigestDto> = {}): WriteDigestDto {
  return {
    legalDocumentId: '00000000-0000-0000-0000-000000000020',
    title: 'People v. Dela Cruz — AI Case Digest',
    sourceOrigin: 'ai_generated',
    facts: 'The accused was charged with murder...',
    issues: 'Whether the lower court erred in convicting the accused',
    ruling: 'The Supreme Court affirmed the conviction...',
    doctrine: 'Circumstantial evidence is sufficient for conviction...',
    dispositive: 'WHEREFORE, the appeal is DENIED.',
    confidenceScore: 0.85,
    provenanceRecords: [
      {
        sourceDocumentId: '00000000-0000-0000-0000-000000000020',
        sourceSectionId: '00000000-0000-0000-0000-000000000030',
        provenanceType: 'source_passage',
      },
    ],
    ...overrides,
  } as WriteDigestDto;
}

// ---------------------------------------------------------------------------
// InternalDerivativesService tests
// ---------------------------------------------------------------------------

describe('InternalDerivativesService', () => {
  let service: InternalDerivativesService;
  let prisma: {
    $transaction: jest.Mock;
    derivativeGenerationJob: { update: jest.Mock };
    subject: { findUnique: jest.Mock };
    subjectTopic: { findUnique: jest.Mock };
    documentSubjectAssignment: {
      findFirst: jest.Mock;
      upsert: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    legalDocument: { count: jest.Mock };
  };

  // Transaction mock helpers — simulates Prisma interactive transaction
  let txMocks: {
    derivativeArtifact: { create: jest.Mock };
    digest: { create: jest.Mock; upsert: jest.Mock };
    essayPrompt: { create: jest.Mock };
    doctrineExtract: { create: jest.Mock };
    doctrineLink: { create: jest.Mock };
    mcqQuestion: { create: jest.Mock };
    mcqOption: { create: jest.Mock };
    flashcardSet: { create: jest.Mock };
    flashcard: { create: jest.Mock };
    provenanceRecord: { create: jest.Mock };
    budgetLedger: { create: jest.Mock };
    derivativeReview: { create: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  beforeEach(async () => {
    let doctrineIdCounter = 0;
    let mcqQuestionIdCounter = 0;
    let artifactIdCounter = 0;
    txMocks = {
      derivativeArtifact: {
        create: jest.fn().mockImplementation(async () => {
          artifactIdCounter++;
          return { id: `artifact-${String(artifactIdCounter).padStart(3, '0')}` };
        }),
      },
      digest: {
        create: jest.fn().mockResolvedValue({ id: 'digest-001' }),
        upsert: jest.fn().mockResolvedValue({ id: 'digest-001' }),
      },
      essayPrompt: {
        create: jest.fn().mockResolvedValue({ id: 'essay-001' }),
      },
      doctrineExtract: {
        create: jest.fn().mockImplementation(async () => {
          doctrineIdCounter++;
          return { id: `doctrine-${String(doctrineIdCounter).padStart(3, '0')}` };
        }),
      },
      doctrineLink: {
        create: jest.fn().mockResolvedValue({ id: 'link-001' }),
      },
      mcqQuestion: {
        create: jest.fn().mockImplementation(async () => {
          mcqQuestionIdCounter++;
          return { id: `mcq-q-${String(mcqQuestionIdCounter).padStart(3, '0')}` };
        }),
      },
      mcqOption: {
        create: jest.fn().mockResolvedValue({ id: 'opt-001' }),
      },
      flashcardSet: {
        create: jest.fn().mockResolvedValue({ id: 'set-001' }),
      },
      flashcard: {
        create: jest.fn().mockImplementation(async (_args: unknown) => {
          const idx = txMocks.flashcard.create.mock.calls.length;
          return { id: `card-${String(idx).padStart(3, '0')}` };
        }),
      },
      provenanceRecord: {
        create: jest.fn().mockResolvedValue({ id: 'prov-001' }),
      },
      budgetLedger: {
        create: jest.fn().mockResolvedValue({ id: 'ledger-001' }),
      },
      derivativeReview: {
        create: jest.fn().mockResolvedValue({ id: 'review-001' }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-001' }),
      },
    };

    prisma = {
      $transaction: jest.fn().mockImplementation(async (fn: (tx: typeof txMocks) => Promise<unknown>) => {
        return fn(txMocks);
      }),
      derivativeGenerationJob: {
        update: jest.fn().mockResolvedValue({}),
      },
      subject: {
        findUnique: jest.fn(),
      },
      subjectTopic: {
        findUnique: jest.fn(),
      },
      documentSubjectAssignment: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(async (args: { create: { subjectId: string } }) => ({
          id: `assign-${args.create.subjectId}`,
        })),
        create: jest.fn().mockImplementation(async (args: { data: { subjectId: string } }) => ({
          id: `assign-${args.data.subjectId}`,
        })),
        update: jest.fn().mockImplementation(async (args: { where: { id: string } }) => ({
          id: args.where.id,
        })),
      },
      legalDocument: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InternalDerivativesService,
        AutoPromoteService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: <T>(key: string, fallback: T): T => fallback,
          },
        },
      ],
    }).compile();

    service = module.get(InternalDerivativesService);
  });

  // ---- writeDerivative ----

  describe('writeDerivative', () => {
    it('1. happy path — creates artifact + provenance records in transaction', async () => {
      const dto = makeWriteDto();

      const result = await service.writeDerivative(dto);

      expect(result).toEqual({ artifactId: 'artifact-001' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledTimes(1);
      expect(txMocks.provenanceRecord.create).toHaveBeenCalledTimes(1);
      expect(txMocks.provenanceRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'derivative_artifact',
          entityId: 'artifact-001',
          sourceDocumentId: '00000000-0000-0000-0000-000000000010',
          provenanceType: 'source_passage',
        }),
      });
    });

    it('2. rejects empty provenance array', async () => {
      const dto = makeWriteDto({ provenanceRecords: [] });

      await expect(service.writeDerivative(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('3. creates budget ledger entry when provided', async () => {
      const dto = makeWriteDto({
        budgetLedgerEntry: {
          periodYearMonth: '2026-04',
          periodDay: '2026-04-12',
          scope: 'global',
          amountUsd: 0.005,
          tokensIn: 500,
          tokensOut: 200,
          modelName: 'gpt-4o-mini',
        },
      });

      await service.writeDerivative(dto);

      expect(txMocks.budgetLedger.create).toHaveBeenCalledTimes(1);
      expect(txMocks.budgetLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          periodYearMonth: '2026-04',
          scope: 'global',
          amountUsd: 0.005,
          tokensIn: 500,
          tokensOut: 200,
        }),
      });
    });

    it('4. omits budget ledger when not provided', async () => {
      const dto = makeWriteDto();

      await service.writeDerivative(dto);

      expect(txMocks.budgetLedger.create).not.toHaveBeenCalled();
    });

    it('5. sets correct default values (visibility, audience, reviewStatus)', async () => {
      const dto = makeWriteDto();

      await service.writeDerivative(dto);

      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          visibility: 'private',
          audience: 'both',
          reviewStatus: 'draft',
        }),
      });
    });

    // ---- Auto-promote at confidence ≥ threshold ----

    it('auto-promote: confidence 0.69 stays private, no review/audit row', async () => {
      const dto = makeWriteDto({
        derivativeType: 'doctrine_extract',
        confidenceScore: 0.69,
      });

      await service.writeDerivative(dto);

      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          visibility: 'private',
          reviewStatus: 'draft',
        }),
      });
      expect(txMocks.derivativeReview.create).not.toHaveBeenCalled();
      expect(txMocks.auditLog.create).not.toHaveBeenCalled();
    });

    it('auto-promote: confidence 0.70 promotes + writes review + audit', async () => {
      const dto = makeWriteDto({
        derivativeType: 'doctrine_extract',
        confidenceScore: 0.7,
      });

      await service.writeDerivative(dto);

      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          visibility: 'public_editorial',
          reviewStatus: 'approved',
        }),
      });
      expect(txMocks.derivativeReview.create).toHaveBeenCalledTimes(1);
      expect(txMocks.derivativeReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          verdict: 'approve',
          reviewerUserId: '00000000-0000-0000-0000-000000000002',
        }),
      });
      expect(txMocks.auditLog.create).toHaveBeenCalledTimes(1);
      expect(txMocks.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'derivative_auto_promoted',
          actorType: 'system',
        }),
      });
    });

    it('auto-promote: mcq_question at 0.99 stays private (excluded type)', async () => {
      const dto = makeWriteDto({
        derivativeType: 'mcq_question',
        confidenceScore: 0.99,
      });

      await service.writeDerivative(dto);

      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          visibility: 'private',
          reviewStatus: 'draft',
        }),
      });
      expect(txMocks.derivativeReview.create).not.toHaveBeenCalled();
      expect(txMocks.auditLog.create).not.toHaveBeenCalled();
    });
  });

  // ---- writeDigest ----

  describe('writeDigest', () => {
    it('creates digest + provenance records in transaction', async () => {
      const dto = makeWriteDigestDto();

      const result = await service.writeDigest(dto);

      expect(result).toEqual({ digestId: 'digest-001' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMocks.digest.upsert).toHaveBeenCalledTimes(1);
      expect(txMocks.provenanceRecord.create).toHaveBeenCalledTimes(1);
      expect(txMocks.provenanceRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'digest',
          entityId: 'digest-001',
          sourceDocumentId: '00000000-0000-0000-0000-000000000020',
          sourceSectionId: '00000000-0000-0000-0000-000000000030',
          provenanceType: 'source_passage',
        }),
      });
    });

    it('rejects empty provenance array', async () => {
      const dto = makeWriteDigestDto({ provenanceRecords: [] });

      await expect(service.writeDigest(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates budget ledger entry when provided', async () => {
      const dto = makeWriteDigestDto({
        budgetLedgerEntry: {
          periodYearMonth: '2026-04',
          periodDay: '2026-04-12',
          scope: 'digest_generation',
          amountUsd: 0.003,
          tokensIn: 1200,
          tokensOut: 800,
          modelName: 'gpt-4o-mini',
        },
      });

      await service.writeDigest(dto);

      expect(txMocks.budgetLedger.create).toHaveBeenCalledTimes(1);
      expect(txMocks.budgetLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          periodYearMonth: '2026-04',
          scope: 'digest_generation',
          amountUsd: 0.003,
          tokensIn: 1200,
          tokensOut: 800,
        }),
      });
    });

    it('sets correct defaults (sourceOrigin, digestType, reviewStatus, visibility)', async () => {
      const dto = makeWriteDigestDto();

      await service.writeDigest(dto);

      expect(txMocks.digest.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            sourceOrigin: 'ai_generated',
            digestType: 'case_digest',
            reviewStatus: 'draft',
            visibility: 'private',
          }),
        }),
      );
    });
  });

  // ---- writeDoctrines ----

  describe('writeDoctrines', () => {
    function makeWriteDoctrinesDto(overrides: Partial<WriteDoctrinesDto> = {}): WriteDoctrinesDto {
      return {
        sourceDocumentId: '00000000-0000-0000-0000-000000000010',
        contentJson: { doctrines: [] },
        contentRights: 'ai_generated_derivative',
        contentDisclaimerId: '00000000-0000-0000-0000-000000000001',
        doctrines: [
          {
            text: 'The doctrine of command responsibility applies to civilian officials.',
            verbatimSourceText: 'command responsibility applies',
            doctrineType: 'rule',
            sourceSectionId: '00000000-0000-0000-0000-000000000030',
          },
        ],
        provenanceRecords: [
          {
            sourceDocumentId: '00000000-0000-0000-0000-000000000010',
            sourceSectionId: '00000000-0000-0000-0000-000000000030',
            provenanceType: 'source_passage',
          },
        ],
        ...overrides,
      } as WriteDoctrinesDto;
    }

    it('W1. happy path — creates artifact + doctrine extracts + provenance', async () => {
      const dto = makeWriteDoctrinesDto();

      const result = await service.writeDoctrines(dto);

      expect(result.artifactId).toBe('artifact-001');
      expect(result.doctrineIds).toHaveLength(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledTimes(1);
      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          derivativeType: 'doctrine_extract',
          sourceDocumentId: '00000000-0000-0000-0000-000000000010',
        }),
      });
      expect(txMocks.doctrineExtract.create).toHaveBeenCalledTimes(1);
      expect(txMocks.provenanceRecord.create).toHaveBeenCalledTimes(1);
    });

    it('W2. creates doctrine links for related doctrines', async () => {
      const dto = makeWriteDoctrinesDto({
        doctrines: [
          {
            text: 'A rule about command responsibility.',
            verbatimSourceText: 'command responsibility',
            doctrineType: 'rule',
            relatedDoctrines: [
              { existingDoctrineId: '00000000-0000-0000-0000-000000000099', linkType: 'supports' },
            ],
          },
        ],
      });

      await service.writeDoctrines(dto);

      expect(txMocks.doctrineLink.create).toHaveBeenCalledTimes(1);
      expect(txMocks.doctrineLink.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          toDoctrineId: '00000000-0000-0000-0000-000000000099',
          linkType: 'supports',
        }),
      });
    });

    it('W3. rejects empty provenance', async () => {
      const dto = makeWriteDoctrinesDto({ provenanceRecords: [] });

      await expect(service.writeDoctrines(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('W4. creates budget ledger when provided', async () => {
      const dto = makeWriteDoctrinesDto({
        budgetLedgerEntry: {
          periodYearMonth: '2026-04',
          periodDay: '2026-04-12',
          scope: 'doctrine_extraction',
          amountUsd: 0.004,
          tokensIn: 1500,
          tokensOut: 800,
          modelName: 'gpt-4o-mini',
        },
      });

      await service.writeDoctrines(dto);

      expect(txMocks.budgetLedger.create).toHaveBeenCalledTimes(1);
      expect(txMocks.budgetLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          periodYearMonth: '2026-04',
          scope: 'doctrine_extraction',
          amountUsd: 0.004,
        }),
      });
    });

    it('W6. accepts full worker-shape payload (modelRunId + jobId + doctrines + provenance, no verbatimSourceText)', async () => {
      // Mirrors the payload generate_doctrine_extract builds today:
      // optional modelRunId/derivativeGenerationJobId are present,
      // doctrine entries omit verbatimSourceText (RAG endpoint does not
      // return it), and the cited section uses the sourceSectionId field
      // (aligned with worker output and Prisma storage).
      const dto = makeWriteDoctrinesDto({
        modelRunId: '00000000-0000-0000-0000-0000000000a1',
        derivativeGenerationJobId: '00000000-0000-0000-0000-0000000000b1',
        doctrines: [
          {
            text: 'Officials with effective control may be held liable for subordinate acts.',
            doctrineType: 'rule',
            sourceSectionId: '00000000-0000-0000-0000-000000000030',
            confidence: 0.82,
          },
        ],
      });

      const result = await service.writeDoctrines(dto);

      expect(result.artifactId).toBe('artifact-001');
      expect(result.doctrineIds).toHaveLength(1);
      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          derivativeType: 'doctrine_extract',
          derivativeGenerationJobId: '00000000-0000-0000-0000-0000000000b1',
          modelRunId: '00000000-0000-0000-0000-0000000000a1',
        }),
      });
      expect(txMocks.doctrineExtract.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceSectionId: '00000000-0000-0000-0000-000000000030',
          confidence: 0.82,
        }),
      });
    });

    it('W5. skips links when existingDoctrineId is null', async () => {
      const dto = makeWriteDoctrinesDto({
        doctrines: [
          {
            text: 'A rule about command responsibility.',
            verbatimSourceText: 'command responsibility',
            doctrineType: 'rule',
            relatedDoctrines: [
              { existingDoctrineId: null, linkType: 'supports' },
            ],
          },
        ],
      });

      await service.writeDoctrines(dto);

      expect(txMocks.doctrineLink.create).not.toHaveBeenCalled();
    });
  });

  // ---- writeMcqBatch ----

  describe('writeMcqBatch', () => {
    function makeWriteMcqBatchDto(
      overrides: Partial<WriteMcqBatchDto> = {},
    ): WriteMcqBatchDto {
      return {
        sourceDocumentId: '00000000-0000-0000-0000-000000000010',
        contentJson: { questions: [] },
        contentRights: 'ai_generated_derivative',
        contentDisclaimerId: '00000000-0000-0000-0000-000000000001',
        questions: [
          {
            questionStem: 'Under the doctrine of command responsibility, who may be held liable?',
            explanation: 'The doctrine applies to civilian officials with effective control.',
            difficulty: 'medium',
            questionFormat: 'single_best',
            options: [
              { label: 'A', text: 'Only military commanders.', isCorrect: false, rationale: 'Wrong.' },
              { label: 'B', text: 'Civilian officials with effective control.', isCorrect: true, rationale: 'Correct.' },
              { label: 'C', text: 'Only the President.', isCorrect: false, rationale: 'Wrong.' },
              { label: 'D', text: 'No one can be held liable.', isCorrect: false, rationale: 'Wrong.' },
            ],
            supportingSectionIds: ['00000000-0000-0000-0000-000000000030'],
          },
        ],
        ...overrides,
      } as WriteMcqBatchDto;
    }

    it('M1. happy path — creates artifacts + questions + options + provenance', async () => {
      const dto = makeWriteMcqBatchDto();

      const result = await service.writeMcqBatch(dto);

      expect(result.artifactIds).toHaveLength(1);
      expect(result.questionIds).toHaveLength(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledTimes(1);
      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          derivativeType: 'mcq_question',
          sourceDocumentId: '00000000-0000-0000-0000-000000000010',
        }),
      });
      expect(txMocks.mcqQuestion.create).toHaveBeenCalledTimes(1);
      expect(txMocks.mcqOption.create).toHaveBeenCalledTimes(4);
      expect(txMocks.provenanceRecord.create).toHaveBeenCalledTimes(1);
    });

    it('M2. creates correct option labels (A, B, C, D)', async () => {
      const dto = makeWriteMcqBatchDto();

      await service.writeMcqBatch(dto);

      const optionCalls = txMocks.mcqOption.create.mock.calls;
      const labels = optionCalls.map(
        (call: [{ data: { optionLabel: string } }]) => call[0].data.optionLabel,
      );
      expect(labels).toEqual(['A', 'B', 'C', 'D']);
    });

    it('M3. creates budget ledger when provided', async () => {
      const dto = makeWriteMcqBatchDto({
        budgetLedgerEntry: {
          periodYearMonth: '2026-04',
          periodDay: '2026-04-12',
          scope: 'mcq_generation',
          amountUsd: 0.006,
          tokensIn: 2000,
          tokensOut: 1500,
          modelName: 'gpt-4o-mini',
        },
      });

      await service.writeMcqBatch(dto);

      expect(txMocks.budgetLedger.create).toHaveBeenCalledTimes(1);
      expect(txMocks.budgetLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          periodYearMonth: '2026-04',
          scope: 'mcq_generation',
          amountUsd: 0.006,
          tokensIn: 2000,
          tokensOut: 1500,
        }),
      });
    });

    it('M4. handles empty questions array (no-op)', async () => {
      const dto = makeWriteMcqBatchDto({ questions: [] });

      const result = await service.writeMcqBatch(dto);

      expect(result.artifactIds).toHaveLength(0);
      expect(result.questionIds).toHaveLength(0);
      expect(txMocks.derivativeArtifact.create).not.toHaveBeenCalled();
      expect(txMocks.mcqQuestion.create).not.toHaveBeenCalled();
    });

    it('M5. each question gets its own provenance records', async () => {
      const dto = makeWriteMcqBatchDto({
        questions: [
          {
            questionStem: 'Question 1 about the doctrine of command responsibility in Philippine law?',
            explanation: 'Explanation 1.',
            difficulty: 'easy',
            questionFormat: 'single_best',
            options: [
              { label: 'A', text: 'A1', isCorrect: false },
              { label: 'B', text: 'B1', isCorrect: true },
              { label: 'C', text: 'C1', isCorrect: false },
              { label: 'D', text: 'D1', isCorrect: false },
            ],
            supportingSectionIds: ['00000000-0000-0000-0000-000000000030'],
          },
          {
            questionStem: 'Question 2 about the doctrine of effective control and its implications?',
            explanation: 'Explanation 2.',
            difficulty: 'hard',
            questionFormat: 'single_best',
            options: [
              { label: 'A', text: 'A2', isCorrect: false },
              { label: 'B', text: 'B2', isCorrect: true },
              { label: 'C', text: 'C2', isCorrect: false },
              { label: 'D', text: 'D2', isCorrect: false },
            ],
            supportingSectionIds: [
              '00000000-0000-0000-0000-000000000030',
              '00000000-0000-0000-0000-000000000031',
            ],
          },
        ],
      });

      const result = await service.writeMcqBatch(dto);

      expect(result.artifactIds).toHaveLength(2);
      expect(result.questionIds).toHaveLength(2);
      // Q1 has 1 section, Q2 has 2 sections -> 3 provenance records total
      expect(txMocks.provenanceRecord.create).toHaveBeenCalledTimes(3);
      // Each provenance record should reference the correct artifact
      const provCalls = txMocks.provenanceRecord.create.mock.calls;
      // First provenance record for artifact-001 (first question)
      expect(provCalls[0][0].data.entityId).toMatch(/^artifact-/);
      expect(provCalls[0][0].data.entityType).toBe('derivative_artifact');
    });
  });

  // ---- writeEssay ----

  describe('writeEssay', () => {
    function makeWriteEssayDto(overrides: Partial<WriteEssayDto> = {}): WriteEssayDto {
      return {
        sourceDocumentId: '00000000-0000-0000-0000-000000000010',
        promptText: 'Discuss the liability of Atty. Santos under the doctrine of command responsibility.',
        suggestedTimeMinutes: 30,
        modelAnswerJson: {
          outlineSections: [
            { heading: 'Answer', paragraphs: ['Direct answer.'], citedSectionIds: ['sec-001'] },
            { heading: 'Law', paragraphs: ['The law states...'], citedSectionIds: ['sec-001'] },
            { heading: 'Application', paragraphs: ['Applying...'], citedSectionIds: ['sec-001'] },
            { heading: 'Conclusion', paragraphs: ['Therefore...'], citedSectionIds: ['sec-001'] },
          ],
        },
        rubricJson: {
          totalPoints: 100,
          criteria: [
            { name: 'Issue ID', maxPoints: 25, description: 'Identifies the issue' },
            { name: 'Knowledge', maxPoints: 25, description: 'Legal knowledge' },
            { name: 'Analysis', maxPoints: 25, description: 'Application' },
            { name: 'Conclusion', maxPoints: 25, description: 'Conclusion' },
          ],
        },
        contentJson: { promptText: 'Discuss...', modelAnswer: {} },
        contentRights: 'ai_generated_derivative',
        contentDisclaimerId: '00000000-0000-0000-0000-000000000001',
        provenanceRecords: [
          {
            sourceDocumentId: '00000000-0000-0000-0000-000000000010',
            sourceSectionId: '00000000-0000-0000-0000-000000000030',
            provenanceType: 'source_passage',
          },
        ],
        ...overrides,
      } as WriteEssayDto;
    }

    it('E1. happy path — creates artifact + essay prompt + provenance', async () => {
      const dto = makeWriteEssayDto();

      const result = await service.writeEssay(dto);

      expect(result).toEqual({ artifactId: 'artifact-001', essayPromptId: 'essay-001' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledTimes(1);
      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          derivativeType: 'essay_prompt',
          sourceDocumentId: '00000000-0000-0000-0000-000000000010',
        }),
      });
      expect(txMocks.essayPrompt.create).toHaveBeenCalledTimes(1);
      expect(txMocks.essayPrompt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          derivativeArtifactId: 'artifact-001',
          promptText: dto.promptText,
          suggestedTimeMinutes: 30,
        }),
      });
      expect(txMocks.provenanceRecord.create).toHaveBeenCalledTimes(1);
    });

    it('E2. rejects empty provenance', async () => {
      const dto = makeWriteEssayDto({ provenanceRecords: [] });

      await expect(service.writeEssay(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('E3. creates budget ledger when provided', async () => {
      const dto = makeWriteEssayDto({
        budgetLedgerEntry: {
          periodYearMonth: '2026-04',
          periodDay: '2026-04-12',
          scope: 'essay_prompt_generation',
          amountUsd: 0.005,
          tokensIn: 1500,
          tokensOut: 800,
          modelName: 'gpt-4o-mini',
        },
      });

      await service.writeEssay(dto);

      expect(txMocks.budgetLedger.create).toHaveBeenCalledTimes(1);
      expect(txMocks.budgetLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          periodYearMonth: '2026-04',
          scope: 'essay_prompt_generation',
          amountUsd: 0.005,
          tokensIn: 1500,
          tokensOut: 800,
        }),
      });
    });

    it('E4. links barExamSittingId when provided', async () => {
      const dto = makeWriteEssayDto({
        barExamSittingId: '00000000-0000-0000-0000-000000000099',
      });

      await service.writeEssay(dto);

      expect(txMocks.essayPrompt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          barExamSittingId: '00000000-0000-0000-0000-000000000099',
        }),
      });
    });

    it('E5. sets correct defaults (visibility, audience, reviewStatus)', async () => {
      const dto = makeWriteEssayDto();

      await service.writeEssay(dto);

      expect(txMocks.derivativeArtifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          visibility: 'private',
          audience: 'both',
          reviewStatus: 'draft',
        }),
      });
    });
  });

  // ---- writeFlashcards ----

  describe('writeFlashcards', () => {
    function makeWriteFlashcardsDto(overrides: Partial<WriteFlashcardsDto> = {}): WriteFlashcardsDto {
      return {
        title: 'Flashcards: Criminal Law Principles',
        description: 'AI-generated flashcards from G.R. No. 123456',
        barSubject: 'Criminal Law',
        visibility: 'private',
        organizationId: '00000000-0000-0000-0000-000000000010',
        userId: '00000000-0000-0000-0000-000000000020',
        sourceDocumentId: '00000000-0000-0000-0000-000000000030',
        cards: [
          {
            front: 'What is the doctrine of command responsibility?',
            back: 'The doctrine applies to civilian officials with effective control.',
            sectionId: '00000000-0000-0000-0000-000000000040',
          },
          {
            front: 'What is required for liability under command responsibility?',
            back: 'Effective control over subordinates and failure to act.',
          },
          {
            front: 'What is the standard of proof in criminal cases?',
            back: 'Proof beyond reasonable doubt is required.',
            legalDocumentId: '00000000-0000-0000-0000-000000000050',
          },
        ],
        ...overrides,
      } as WriteFlashcardsDto;
    }

    it('FC1. creates set + cards in transaction', async () => {
      const dto = makeWriteFlashcardsDto();

      const result = await service.writeFlashcards(dto);

      expect(result.setId).toBe('set-001');
      expect(result.cardIds).toHaveLength(3);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMocks.flashcardSet.create).toHaveBeenCalledTimes(1);
      expect(txMocks.flashcard.create).toHaveBeenCalledTimes(3);
    });

    it('FC2. sets sourceType to ai_generated', async () => {
      const dto = makeWriteFlashcardsDto();

      await service.writeFlashcards(dto);

      const flashcardCalls = txMocks.flashcard.create.mock.calls;
      for (const call of flashcardCalls) {
        expect(call[0].data.sourceType).toBe('ai_generated');
      }
    });

    it('FC3. creates budget ledger', async () => {
      const dto = makeWriteFlashcardsDto({
        budgetLedgerEntry: {
          periodYearMonth: '2026-04',
          periodDay: '2026-04-12',
          scope: 'flashcard_generation',
          amountUsd: 0.004,
          tokensIn: 1200,
          tokensOut: 600,
          modelName: 'gpt-4o-mini',
        },
      });

      await service.writeFlashcards(dto);

      expect(txMocks.budgetLedger.create).toHaveBeenCalledTimes(1);
      expect(txMocks.budgetLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          periodYearMonth: '2026-04',
          scope: 'flashcard_generation',
          amountUsd: 0.004,
          tokensIn: 1200,
          tokensOut: 600,
        }),
      });
    });

    it('FC4. sets correct cardCount on set', async () => {
      const dto = makeWriteFlashcardsDto();

      await service.writeFlashcards(dto);

      expect(txMocks.flashcardSet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          cardCount: 3,
          title: 'Flashcards: Criminal Law Principles',
          barSubject: 'Criminal Law',
          visibility: 'private',
        }),
      });
    });

    it('FC5. cards ordered correctly', async () => {
      const dto = makeWriteFlashcardsDto();

      await service.writeFlashcards(dto);

      const flashcardCalls = txMocks.flashcard.create.mock.calls;
      expect(flashcardCalls[0][0].data.ordering).toBe(0);
      expect(flashcardCalls[1][0].data.ordering).toBe(1);
      expect(flashcardCalls[2][0].data.ordering).toBe(2);
    });
  });

  // ---- updateJobStatus ----

  describe('updateJobStatus', () => {
    it('6. sets startedAt when status = running', async () => {
      const dto: UpdateJobStatusDto = { status: 'running' } as UpdateJobStatusDto;

      await service.updateJobStatus('job-001', dto);

      expect(prisma.derivativeGenerationJob.update).toHaveBeenCalledWith({
        where: { id: 'job-001' },
        data: expect.objectContaining({
          status: 'running',
          startedAt: expect.any(Date),
        }),
      });
      // Should NOT set finishedAt
      const callData = prisma.derivativeGenerationJob.update.mock.calls[0][0].data;
      expect(callData.finishedAt).toBeUndefined();
    });

    it('7. sets finishedAt when status = completed', async () => {
      const dto: UpdateJobStatusDto = { status: 'completed' } as UpdateJobStatusDto;

      await service.updateJobStatus('job-001', dto);

      expect(prisma.derivativeGenerationJob.update).toHaveBeenCalledWith({
        where: { id: 'job-001' },
        data: expect.objectContaining({
          status: 'completed',
          finishedAt: expect.any(Date),
        }),
      });
      // Should NOT set startedAt
      const callData = prisma.derivativeGenerationJob.update.mock.calls[0][0].data;
      expect(callData.startedAt).toBeUndefined();
    });

    it('8. sets finishedAt when status = failed', async () => {
      const dto: UpdateJobStatusDto = {
        status: 'failed',
        errorJson: { message: 'timeout' },
      } as UpdateJobStatusDto;

      await service.updateJobStatus('job-001', dto);

      expect(prisma.derivativeGenerationJob.update).toHaveBeenCalledWith({
        where: { id: 'job-001' },
        data: expect.objectContaining({
          status: 'failed',
          finishedAt: expect.any(Date),
          errorJson: { message: 'timeout' },
        }),
      });
    });
  });
});

// ---------------------------------------------------------------------------
// writeClassification tests
// ---------------------------------------------------------------------------

function makeClassificationDto(overrides: Partial<WriteClassificationDto> = {}): WriteClassificationDto {
  return {
    legalDocumentId: '00000000-0000-0000-0000-000000000040',
    assignments: [
      {
        subjectCode: 'civil_law',
        confidence: 0.92,
        isPrimary: true,
      },
      {
        subjectCode: 'remedial_law',
        subjectTopicCode: 'remedial_law.civil_procedure',
        confidence: 0.65,
        isPrimary: false,
      },
    ],
    classifierModelRunId: '00000000-0000-0000-0000-000000000050',
    ...overrides,
  } as WriteClassificationDto;
}

describe('writeClassification', () => {
  let classService: InternalDerivativesService;
  let classPrisma: {
    $transaction: jest.Mock;
    derivativeGenerationJob: { update: jest.Mock };
    subject: { findUnique: jest.Mock };
    subjectTopic: { findUnique: jest.Mock };
    documentSubjectAssignment: {
      findFirst: jest.Mock;
      upsert: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    legalDocument: { count: jest.Mock };
  };

  beforeEach(async () => {
    classPrisma = {
      $transaction: jest.fn(),
      derivativeGenerationJob: { update: jest.fn() },
      subject: {
        findUnique: jest.fn().mockImplementation(async (args: { where: { code_taxonomyVersion?: { code: string } } }) => {
          const code = args.where.code_taxonomyVersion?.code;
          if (code === 'civil_law') return { id: 'subj-civil', code: 'civil_law' };
          if (code === 'remedial_law') return { id: 'subj-remedial', code: 'remedial_law' };
          return null;
        }),
      },
      subjectTopic: {
        findUnique: jest.fn().mockImplementation(async (args: { where: { subjectId_code?: { code: string } } }) => {
          const code = args.where.subjectId_code?.code;
          if (code === 'remedial_law.civil_procedure') return { id: 'topic-civil-proc', code: 'remedial_law.civil_procedure' };
          return null;
        }),
      },
      documentSubjectAssignment: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(async (args: { create: { subjectId: string } }) => ({
          id: `assign-${args.create.subjectId}`,
        })),
        create: jest.fn().mockImplementation(async (args: { data: { subjectId: string } }) => ({
          id: `assign-${args.data.subjectId}`,
        })),
        update: jest.fn().mockImplementation(async (args: { where: { id: string } }) => ({
          id: args.where.id,
        })),
      },
      legalDocument: { count: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InternalDerivativesService,
        AutoPromoteService,
        { provide: PrismaService, useValue: classPrisma },
        {
          provide: ConfigService,
          useValue: {
            get: <T>(key: string, fallback: T): T => fallback,
          },
        },
      ],
    }).compile();

    classService = module.get(InternalDerivativesService);
  });

  it('11. happy path — creates assignments and resolves subject codes to IDs', async () => {
    const dto = makeClassificationDto();

    const result = await classService.writeClassification(dto);

    expect(result.assignmentIds).toHaveLength(2);
    expect(result.assignmentIds).toContain('assign-subj-civil');
    expect(result.assignmentIds).toContain('assign-subj-remedial');
    expect(classPrisma.subject.findUnique).toHaveBeenCalledTimes(2);
    // civil_law has no topic -> null-topic path (create).
    // remedial_law has a topic -> upsert path on the composite unique.
    expect(classPrisma.documentSubjectAssignment.upsert).toHaveBeenCalledTimes(1);
    expect(classPrisma.documentSubjectAssignment.create).toHaveBeenCalledTimes(1);
  });

  it('12. rejects if no primary assignment', async () => {
    const dto = makeClassificationDto({
      assignments: [
        { subjectCode: 'civil_law', confidence: 0.9, isPrimary: false },
      ],
    });

    await expect(classService.writeClassification(dto)).rejects.toThrow(BadRequestException);
    await expect(classService.writeClassification(dto)).rejects.toThrow(
      'Exactly one primary assignment required, got 0',
    );
  });

  it('13. rejects if multiple primary assignments', async () => {
    const dto = makeClassificationDto({
      assignments: [
        { subjectCode: 'civil_law', confidence: 0.9, isPrimary: true },
        { subjectCode: 'remedial_law', confidence: 0.8, isPrimary: true },
      ],
    });

    await expect(classService.writeClassification(dto)).rejects.toThrow(BadRequestException);
    await expect(classService.writeClassification(dto)).rejects.toThrow(
      'Exactly one primary assignment required, got 2',
    );
  });

  it('14. resolves subject codes and topic codes to IDs', async () => {
    const dto = makeClassificationDto();

    await classService.writeClassification(dto);

    // civil_law has no subjectTopic -> null-topic branch uses `create`
    // (not upsert) because Prisma composite uniques can't match NULL.
    expect(classPrisma.documentSubjectAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectId: 'subj-civil',
          subjectTopicId: null,
          isPrimary: true,
        }),
      }),
    );

    // remedial_law has a topic -> upsert on composite unique works
    expect(classPrisma.documentSubjectAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          legalDocumentId_subjectId_subjectTopicId: {
            legalDocumentId: expect.any(String),
            subjectId: 'subj-remedial',
            subjectTopicId: 'topic-civil-proc',
          },
        },
        create: expect.objectContaining({
          subjectId: 'subj-remedial',
          subjectTopicId: 'topic-civil-proc',
          isPrimary: false,
        }),
      }),
    );
  });

  it('14b. null-topic path re-uses the existing NULL row instead of creating a duplicate', async () => {
    // Regression: the old code coerced null topic to '' in the upsert
    // where-clause, which (a) blew up on Postgres uuid validation and
    // (b) would have produced duplicate rows if it had worked (since
    // NULL != NULL in Postgres composite unique lookups). The new path
    // uses findFirst + update when a NULL-topic row already exists.
    classPrisma.documentSubjectAssignment.findFirst
      // manualOverride check for civil_law
      .mockResolvedValueOnce(null)
      // null-topic existence check for civil_law
      .mockResolvedValueOnce({ id: 'existing-civil-null-topic' })
      // manualOverride check for remedial_law
      .mockResolvedValueOnce(null);

    const dto = makeClassificationDto();

    await classService.writeClassification(dto);

    expect(classPrisma.documentSubjectAssignment.create).not.toHaveBeenCalled();
    expect(classPrisma.documentSubjectAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-civil-null-topic' },
        data: expect.objectContaining({ isPrimary: true }),
      }),
    );
  });

  it('15. skips subjects with manualOverride', async () => {
    // First subject has manual override, second does not
    classPrisma.documentSubjectAssignment.findFirst
      .mockResolvedValueOnce({ id: 'existing-manual', manualOverride: true })
      .mockResolvedValueOnce(null);

    const dto = makeClassificationDto();

    const result = await classService.writeClassification(dto);

    // Only the second assignment (remedial_law) should be created
    expect(result.assignmentIds).toHaveLength(1);
    expect(result.assignmentIds).toContain('assign-subj-remedial');
    expect(classPrisma.documentSubjectAssignment.upsert).toHaveBeenCalledTimes(1);
  });

  it('16. rejects unknown subject code', async () => {
    classPrisma.subject.findUnique.mockResolvedValue(null);

    const dto = makeClassificationDto({
      assignments: [
        { subjectCode: 'nonexistent_law', confidence: 0.9, isPrimary: true },
      ],
    });

    await expect(classService.writeClassification(dto)).rejects.toThrow(BadRequestException);
    await expect(classService.writeClassification(dto)).rejects.toThrow(
      'Unknown subject code: nonexistent_law',
    );
  });
});

// ---------------------------------------------------------------------------
// InternalAuthGuard tests
// ---------------------------------------------------------------------------

describe('InternalAuthGuard', () => {
  let guard: InternalAuthGuard;
  let configService: { get: jest.Mock };

  function makeContext(headers: Record<string, string> = {}) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as unknown as import('@nestjs/common').ExecutionContext;
  }

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue('test-secret-key') };
    guard = new InternalAuthGuard(configService as unknown as ConfigService);
  });

  it('9. rejects missing X-Internal-Auth header', () => {
    const context = makeContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('10. rejects wrong token', () => {
    const context = makeContext({ 'x-internal-auth': 'wrong-token' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('allows correct token', () => {
    const context = makeContext({ 'x-internal-auth': 'test-secret-key' });

    expect(guard.canActivate(context)).toBe(true);
  });
});

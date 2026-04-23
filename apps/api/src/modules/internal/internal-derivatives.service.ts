import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { WriteDerivativeDto, WriteDigestDto, WriteClassificationDto, WriteDoctrinesDto, WriteMcqBatchDto, WriteEssayDto, WriteFlashcardsDto } from './dto';
import { UpdateJobStatusDto } from './dto';

/**
 * Internal service for derivative artifact writes from the Python
 * worker-service. All writes go through a single Prisma interactive
 * transaction: artifact + provenance + optional budget ledger entry.
 *
 * This is the NestJS side of the "Python stays read-only" architecture
 * decision (§11.6). The Celery pipeline validates content, then POSTs
 * to this endpoint to persist the result.
 */
@Injectable()
export class InternalDerivativesService {
  private readonly logger = new Logger(InternalDerivativesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async writeDerivative(dto: WriteDerivativeDto): Promise<{ artifactId: string }> {
    // Enforce provenance invariant (§4.5)
    if (!dto.provenanceRecords || dto.provenanceRecords.length === 0) {
      throw new BadRequestException('At least one provenance record is required');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create DerivativeArtifact
      const artifact = await tx.derivativeArtifact.create({
        data: {
          derivativeType: dto.derivativeType,
          sourceDocumentId: dto.sourceDocumentId,
          sourceSectionId: dto.sourceSectionId,
          organizationId: dto.organizationId,
          derivativeGenerationJobId: dto.derivativeGenerationJobId,
          title: dto.title,
          contentJson: dto.contentJson as Prisma.InputJsonValue,
          contentHash: dto.contentHash,
          contentRights: dto.contentRights,
          contentDisclaimerId: dto.contentDisclaimerId,
          visibility: dto.visibility ?? 'private',
          audience: dto.audience ?? 'both',
          reviewStatus: dto.reviewStatus ?? 'draft',
          validatorVerdict: dto.validatorVerdict,
          validatorReasonsJson: dto.validatorReasonsJson as Prisma.InputJsonValue | undefined,
          confidenceScore: dto.confidenceScore,
          modelRunId: dto.modelRunId,
        },
      });

      // 2. Create ProvenanceRecords
      for (const prov of dto.provenanceRecords) {
        await tx.provenanceRecord.create({
          data: {
            entityType: 'derivative_artifact',
            entityId: artifact.id,
            sourceDocumentId: prov.sourceDocumentId,
            sourceSectionId: prov.sourceSectionId,
            provenanceType: prov.provenanceType,
          },
        });
      }

      // 3. Optional budget ledger entry
      if (dto.budgetLedgerEntry) {
        await tx.budgetLedger.create({
          data: {
            periodYearMonth: dto.budgetLedgerEntry.periodYearMonth,
            periodDay: dto.budgetLedgerEntry.periodDay,
            scope: dto.budgetLedgerEntry.scope,
            amountUsd: dto.budgetLedgerEntry.amountUsd,
            tokensIn: dto.budgetLedgerEntry.tokensIn,
            tokensOut: dto.budgetLedgerEntry.tokensOut,
            modelName: dto.budgetLedgerEntry.modelName,
            modelRunId: dto.budgetLedgerEntry.modelRunId,
          },
        });
      }

      return artifact;
    });

    return { artifactId: result.id };
  }

  async writeDigest(dto: WriteDigestDto): Promise<{ digestId: string }> {
    // Enforce provenance invariant (§4.5)
    if (!dto.provenanceRecords || dto.provenanceRecords.length === 0) {
      throw new BadRequestException('At least one provenance record is required');
    }

    const digestType = dto.digestType ?? 'case_digest';

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Upsert Digest row (prevents duplicates per legalDocumentId + digestType)
      const digest = await tx.digest.upsert({
        where: {
          legalDocumentId_digestType: {
            legalDocumentId: dto.legalDocumentId,
            digestType,
          },
        },
        create: {
          legalDocumentId: dto.legalDocumentId,
          title: dto.title,
          sourceOrigin: dto.sourceOrigin,
          digestType,
          facts: dto.facts,
          issues: dto.issues,
          ruling: dto.ruling,
          doctrine: dto.doctrine,
          dispositive: dto.dispositive,
          summary: dto.summary,
          petitionerArguments: dto.petitionerArguments,
          respondentArguments: dto.respondentArguments,
          citedAuthoritiesJson: (dto.citedAuthoritiesJson ?? []) as Prisma.InputJsonValue,
          confidenceScore: dto.confidenceScore,
          reviewStatus: dto.reviewStatus ?? 'draft',
          visibility: dto.visibility ?? 'private',
          validatorVerdict: dto.validatorVerdict,
          validatorReasonsJson: dto.validatorReasonsJson as Prisma.InputJsonValue | undefined,
          modelRunId: dto.modelRunId,
          promptTemplateVersion: dto.promptTemplateVersion,
          contentDisclaimerId: dto.contentDisclaimerId,
          derivativeGenerationJobId: dto.derivativeGenerationJobId,
          sectionUsageJson: dto.sectionUsageJson as Prisma.InputJsonValue | undefined,
        },
        update: {
          title: dto.title,
          sourceOrigin: dto.sourceOrigin,
          facts: dto.facts,
          issues: dto.issues,
          ruling: dto.ruling,
          doctrine: dto.doctrine,
          dispositive: dto.dispositive,
          summary: dto.summary,
          petitionerArguments: dto.petitionerArguments,
          respondentArguments: dto.respondentArguments,
          citedAuthoritiesJson: (dto.citedAuthoritiesJson ?? []) as Prisma.InputJsonValue,
          confidenceScore: dto.confidenceScore,
          validatorVerdict: dto.validatorVerdict,
          validatorReasonsJson: dto.validatorReasonsJson as Prisma.InputJsonValue | undefined,
          modelRunId: dto.modelRunId,
          promptTemplateVersion: dto.promptTemplateVersion,
          contentDisclaimerId: dto.contentDisclaimerId,
          derivativeGenerationJobId: dto.derivativeGenerationJobId,
          sectionUsageJson: dto.sectionUsageJson as Prisma.InputJsonValue | undefined,
        },
      });

      // 2. Create ProvenanceRecords
      for (const prov of dto.provenanceRecords) {
        await tx.provenanceRecord.create({
          data: {
            entityType: 'digest',
            entityId: digest.id,
            sourceDocumentId: prov.sourceDocumentId,
            sourceSectionId: prov.sourceSectionId,
            provenanceType: prov.provenanceType,
          },
        });
      }

      // 3. Optional budget ledger entry
      if (dto.budgetLedgerEntry) {
        await tx.budgetLedger.create({
          data: {
            periodYearMonth: dto.budgetLedgerEntry.periodYearMonth,
            periodDay: dto.budgetLedgerEntry.periodDay,
            scope: dto.budgetLedgerEntry.scope,
            amountUsd: dto.budgetLedgerEntry.amountUsd,
            tokensIn: dto.budgetLedgerEntry.tokensIn,
            tokensOut: dto.budgetLedgerEntry.tokensOut,
            modelName: dto.budgetLedgerEntry.modelName,
            modelRunId: dto.budgetLedgerEntry.modelRunId,
          },
        });
      }

      return digest;
    });

    return { digestId: result.id };
  }

  async writeDoctrines(dto: WriteDoctrinesDto): Promise<{ artifactId: string; doctrineIds: string[] }> {
    // Enforce provenance invariant (§4.5)
    if (!dto.provenanceRecords || dto.provenanceRecords.length === 0) {
      throw new BadRequestException('At least one provenance record is required');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create DerivativeArtifact
      const artifact = await tx.derivativeArtifact.create({
        data: {
          derivativeType: 'doctrine_extract',
          sourceDocumentId: dto.sourceDocumentId,
          derivativeGenerationJobId: dto.derivativeGenerationJobId,
          title: `Doctrine Extract: ${dto.sourceDocumentId.slice(0, 8)}`,
          contentJson: dto.contentJson as Prisma.InputJsonValue,
          contentHash: '',
          contentRights: dto.contentRights,
          contentDisclaimerId: dto.contentDisclaimerId,
          visibility: 'private',
          audience: 'both',
          reviewStatus: dto.reviewStatus ?? 'draft',
          validatorVerdict: dto.validatorVerdict,
          validatorReasonsJson: dto.validatorReasonsJson as Prisma.InputJsonValue | undefined,
          confidenceScore: dto.confidenceScore,
          modelRunId: dto.modelRunId,
        },
      });

      // 2. Create ProvenanceRecords
      for (const prov of dto.provenanceRecords ?? []) {
        await tx.provenanceRecord.create({
          data: {
            entityType: 'derivative_artifact',
            entityId: artifact.id,
            sourceDocumentId: prov.sourceDocumentId,
            sourceSectionId: prov.sourceSectionId,
            provenanceType: prov.provenanceType,
          },
        });
      }

      // 3. Create DoctrineExtract rows
      const doctrineIds: string[] = [];
      for (const d of dto.doctrines ?? []) {
        const extract = await tx.doctrineExtract.create({
          data: {
            legalDocumentId: dto.sourceDocumentId,
            text: d.text,
            normalizedText: d.normalizedText,
            doctrineType: d.doctrineType,
            sourceSectionId: d.sourceSectionId,
            confidence: d.confidence,
            reviewStatus: dto.reviewStatus ?? 'draft',
          },
        });
        doctrineIds.push(extract.id);

        // 4. Create DoctrineLinks for related doctrines
        if (d.relatedDoctrines) {
          for (const link of d.relatedDoctrines) {
            if (link.existingDoctrineId) {
              await tx.doctrineLink.create({
                data: {
                  fromDoctrineId: extract.id,
                  toDoctrineId: link.existingDoctrineId,
                  linkType: link.linkType,
                },
              });
            }
          }
        }
      }

      // 5. Optional budget ledger entry
      if (dto.budgetLedgerEntry) {
        await tx.budgetLedger.create({
          data: {
            periodYearMonth: dto.budgetLedgerEntry.periodYearMonth,
            periodDay: dto.budgetLedgerEntry.periodDay,
            scope: dto.budgetLedgerEntry.scope,
            amountUsd: dto.budgetLedgerEntry.amountUsd,
            tokensIn: dto.budgetLedgerEntry.tokensIn,
            tokensOut: dto.budgetLedgerEntry.tokensOut,
            modelName: dto.budgetLedgerEntry.modelName,
            modelRunId: dto.budgetLedgerEntry.modelRunId,
          },
        });
      }

      return { artifact, doctrineIds };
    });

    return { artifactId: result.artifact.id, doctrineIds: result.doctrineIds };
  }

  async writeMcqBatch(
    dto: WriteMcqBatchDto,
  ): Promise<{ artifactIds: string[]; questionIds: string[] }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const artifactIds: string[] = [];
      const questionIds: string[] = [];

      for (const q of dto.questions) {
        // 1. Create DerivativeArtifact per question
        const artifact = await tx.derivativeArtifact.create({
          data: {
            derivativeType: 'mcq_question',
            sourceDocumentId: dto.sourceDocumentId,
            derivativeGenerationJobId: dto.derivativeGenerationJobId,
            title: `MCQ: ${q.questionStem.slice(0, 60)}`,
            contentJson: {
              questionStem: q.questionStem,
              options: q.options.map((o) => ({
                label: o.label,
                text: o.text,
                isCorrect: o.isCorrect,
                rationale: o.rationale,
              })),
              explanation: q.explanation,
            } as unknown as Prisma.InputJsonValue,
            contentHash: '',
            contentRights: dto.contentRights,
            contentDisclaimerId: dto.contentDisclaimerId,
            visibility: 'private',
            audience: 'both',
            reviewStatus: dto.reviewStatus ?? 'draft',
            validatorVerdict: dto.validatorVerdict,
            validatorReasonsJson: dto.validatorReasonsJson as
              | Prisma.InputJsonValue
              | undefined,
            confidenceScore: dto.confidenceScore,
            modelRunId: dto.modelRunId,
          },
        });
        artifactIds.push(artifact.id);

        // 2. Create McqQuestion
        const mcq = await tx.mcqQuestion.create({
          data: {
            derivativeArtifactId: artifact.id,
            questionStem: q.questionStem,
            explanation: q.explanation,
            difficulty: q.difficulty,
            questionFormat: q.questionFormat,
            subjectTopicId: q.subjectTopicId,
          },
        });
        questionIds.push(mcq.id);

        // 3. Create McqOptions
        for (const opt of q.options) {
          await tx.mcqOption.create({
            data: {
              mcqQuestionId: mcq.id,
              optionLabel: opt.label,
              optionText: opt.text,
              isCorrect: opt.isCorrect,
              rationale: opt.rationale,
            },
          });
        }

        // 4. Create provenance records per question
        for (const sectionId of q.supportingSectionIds) {
          await tx.provenanceRecord.create({
            data: {
              entityType: 'derivative_artifact',
              entityId: artifact.id,
              sourceDocumentId: dto.sourceDocumentId,
              sourceSectionId: sectionId,
              provenanceType: 'source_passage',
            },
          });
        }
      }

      // 5. Budget ledger (once for the whole batch/LLM call)
      if (dto.budgetLedgerEntry) {
        await tx.budgetLedger.create({
          data: {
            periodYearMonth: dto.budgetLedgerEntry.periodYearMonth,
            periodDay: dto.budgetLedgerEntry.periodDay,
            scope: dto.budgetLedgerEntry.scope,
            amountUsd: dto.budgetLedgerEntry.amountUsd,
            tokensIn: dto.budgetLedgerEntry.tokensIn,
            tokensOut: dto.budgetLedgerEntry.tokensOut,
            modelName: dto.budgetLedgerEntry.modelName,
            modelRunId: dto.budgetLedgerEntry.modelRunId,
          },
        });
      }

      return { artifactIds, questionIds };
    });

    return result;
  }

  async writeEssay(dto: WriteEssayDto): Promise<{ artifactId: string; essayPromptId: string }> {
    // Enforce provenance invariant (§4.5)
    if (!dto.provenanceRecords || dto.provenanceRecords.length === 0) {
      throw new BadRequestException('At least one provenance record is required');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create DerivativeArtifact
      const artifact = await tx.derivativeArtifact.create({
        data: {
          derivativeType: 'essay_prompt',
          sourceDocumentId: dto.sourceDocumentId,
          derivativeGenerationJobId: dto.derivativeGenerationJobId,
          title: `Essay Prompt: ${dto.promptText.slice(0, 60)}`,
          contentJson: dto.contentJson as Prisma.InputJsonValue,
          contentHash: '',
          contentRights: dto.contentRights,
          contentDisclaimerId: dto.contentDisclaimerId,
          visibility: 'private',
          audience: 'both',
          reviewStatus: dto.reviewStatus ?? 'draft',
          validatorVerdict: dto.validatorVerdict,
          validatorReasonsJson: dto.validatorReasonsJson as Prisma.InputJsonValue | undefined,
          confidenceScore: dto.confidenceScore,
          modelRunId: dto.modelRunId,
        },
      });

      // 2. Create EssayPrompt child
      const essay = await tx.essayPrompt.create({
        data: {
          derivativeArtifactId: artifact.id,
          promptText: dto.promptText,
          suggestedTimeMinutes: dto.suggestedTimeMinutes,
          modelAnswerJson: dto.modelAnswerJson as Prisma.InputJsonValue | undefined,
          rubricJson: dto.rubricJson as Prisma.InputJsonValue | undefined,
          subjectTopicId: dto.subjectTopicId,
          barExamSittingId: dto.barExamSittingId,
        },
      });

      // 3. Create ProvenanceRecords
      for (const prov of dto.provenanceRecords) {
        await tx.provenanceRecord.create({
          data: {
            entityType: 'derivative_artifact',
            entityId: artifact.id,
            sourceDocumentId: prov.sourceDocumentId,
            sourceSectionId: prov.sourceSectionId,
            provenanceType: prov.provenanceType,
          },
        });
      }

      // 4. Optional budget ledger entry
      if (dto.budgetLedgerEntry) {
        await tx.budgetLedger.create({
          data: {
            periodYearMonth: dto.budgetLedgerEntry.periodYearMonth,
            periodDay: dto.budgetLedgerEntry.periodDay,
            scope: dto.budgetLedgerEntry.scope,
            amountUsd: dto.budgetLedgerEntry.amountUsd,
            tokensIn: dto.budgetLedgerEntry.tokensIn,
            tokensOut: dto.budgetLedgerEntry.tokensOut,
            modelName: dto.budgetLedgerEntry.modelName,
            modelRunId: dto.budgetLedgerEntry.modelRunId,
          },
        });
      }

      return { artifact, essay };
    });

    return { artifactId: result.artifact.id, essayPromptId: result.essay.id };
  }

  async writeFlashcards(dto: WriteFlashcardsDto): Promise<{ setId: string; cardIds: string[] }> {
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create FlashcardSet. The DTO marks organizationId + userId
      // required, so this never receives an empty string for the tenant
      // scope — callers without a user/org (admin bulk-gen) write a
      // derivative_artifact via POST /internal/derivatives/write instead.
      const set = await tx.flashcardSet.create({
        data: {
          organizationId: dto.organizationId,
          userId: dto.userId,
          title: dto.title,
          description: dto.description,
          barSubject: dto.barSubject,
          visibility: dto.visibility ?? 'private',
          cardCount: dto.cards.length,
        },
      });

      // 2. Create Flashcard rows
      const cardIds: string[] = [];
      for (let i = 0; i < dto.cards.length; i++) {
        const c = dto.cards[i]!;
        const card = await tx.flashcard.create({
          data: {
            flashcardSetId: set.id,
            legalDocumentId: c.legalDocumentId ?? dto.sourceDocumentId,
            sectionId: c.sectionId,
            digestId: dto.digestId,
            front: c.front,
            back: c.back,
            sourceType: 'ai_generated',
            ordering: i,
          },
        });
        cardIds.push(card.id);
      }

      // 3. Optional budget ledger entry
      if (dto.budgetLedgerEntry) {
        await tx.budgetLedger.create({
          data: {
            periodYearMonth: dto.budgetLedgerEntry.periodYearMonth,
            periodDay: dto.budgetLedgerEntry.periodDay,
            scope: dto.budgetLedgerEntry.scope,
            amountUsd: dto.budgetLedgerEntry.amountUsd,
            tokensIn: dto.budgetLedgerEntry.tokensIn,
            tokensOut: dto.budgetLedgerEntry.tokensOut,
            modelName: dto.budgetLedgerEntry.modelName,
            modelRunId: dto.budgetLedgerEntry.modelRunId,
          },
        });
      }

      return { set, cardIds };
    });

    return { setId: result.set.id, cardIds: result.cardIds };
  }

  async writeClassification(dto: WriteClassificationDto): Promise<{ assignmentIds: string[] }> {
    // 1. Validate: exactly one assignment has isPrimary=true
    const primaries = dto.assignments.filter((a) => a.isPrimary);
    if (primaries.length !== 1) {
      throw new BadRequestException(
        `Exactly one primary assignment required, got ${primaries.length}`,
      );
    }

    const assignmentIds: string[] = [];

    for (const assignment of dto.assignments) {
      // 2. Resolve subject code to ID (study_8 taxonomy)
      const subject = await this.prisma.subject.findUnique({
        where: {
          code_taxonomyVersion: {
            code: assignment.subjectCode,
            taxonomyVersion: 'study_8',
          },
        },
      });

      if (!subject) {
        throw new BadRequestException(
          `Unknown subject code: ${assignment.subjectCode}`,
        );
      }

      // 3. Resolve optional topic code
      let subjectTopicId: string | null = null;
      if (assignment.subjectTopicCode) {
        const topic = await this.prisma.subjectTopic.findUnique({
          where: {
            subjectId_code: {
              subjectId: subject.id,
              code: assignment.subjectTopicCode,
            },
          },
        });

        if (!topic) {
          throw new BadRequestException(
            `Unknown topic code: ${assignment.subjectTopicCode} under subject ${assignment.subjectCode}`,
          );
        }
        subjectTopicId = topic.id;
      }

      // 4. Check for manualOverride — skip if existing assignment has manualOverride=true
      const existing = await this.prisma.documentSubjectAssignment.findFirst({
        where: {
          legalDocumentId: dto.legalDocumentId,
          subjectId: subject.id,
          manualOverride: true,
        },
      });

      if (existing) {
        this.logger.log(
          `Skipping subject ${assignment.subjectCode} for doc ${dto.legalDocumentId} — manual override exists`,
        );
        continue;
      }

      // 5. Upsert DocumentSubjectAssignment
      const result = await this.prisma.documentSubjectAssignment.upsert({
        where: {
          legalDocumentId_subjectId_subjectTopicId: {
            legalDocumentId: dto.legalDocumentId,
            subjectId: subject.id,
            subjectTopicId: subjectTopicId ?? '',
          },
        },
        update: {
          isPrimary: assignment.isPrimary,
          confidence: assignment.confidence,
          classifiedBy: dto.classifiedBy ?? 'ai',
          classifierModelRunId: dto.classifierModelRunId,
        },
        create: {
          legalDocumentId: dto.legalDocumentId,
          subjectId: subject.id,
          subjectTopicId: subjectTopicId,
          isPrimary: assignment.isPrimary,
          confidence: assignment.confidence,
          classifiedBy: dto.classifiedBy ?? 'ai',
          classifierModelRunId: dto.classifierModelRunId,
        },
      });

      assignmentIds.push(result.id);
    }

    return { assignmentIds };
  }

  async updateJobStatus(jobId: string, dto: UpdateJobStatusDto): Promise<void> {
    await this.prisma.derivativeGenerationJob.update({
      where: { id: jobId },
      data: {
        status: dto.status,
        promptTemplateVersion: dto.promptTemplateVersion,
        modelName: dto.modelName,
        tokensIn: dto.tokensIn,
        tokensOut: dto.tokensOut,
        estimatedCostUsd: dto.estimatedCostUsd,
        errorJson: dto.errorJson as Prisma.InputJsonValue | undefined,
        ...(dto.status === 'running' ? { startedAt: new Date() } : {}),
        ...(['completed', 'failed', 'skipped_budget', 'skipped_ineligible'].includes(dto.status)
          ? { finishedAt: new Date() }
          : {}),
      },
    });
  }
}

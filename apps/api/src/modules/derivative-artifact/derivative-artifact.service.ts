import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  DerivativeArtifact,
  McqOption,
  McqQuestion,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateDerivativeArtifactDto,
  CreateMcqQuestionDto,
  MCQ_OPTION_LABELS,
} from './dto';

/**
 * Low-level write path for `DerivativeArtifact` rows and their per-type
 * child tables.
 *
 * This service is the only place in the API that should insert into
 * `derivative_artifacts`. It enforces the §4.5 invariant — every artifact
 * has at least one `ProvenanceRecord` row written in the same transaction
 * — at the code layer, because the architecture spec (§2.4) explicitly
 * rules out a DB-level CHECK constraint. See
 * `docs/architecture/corpus-platform-target-architecture.md` §2.2, §4.5.
 *
 * No controller is wired to this service yet. It is the foundation the
 * derivative generation pipeline (Phase 5+) will call. A later PR will
 * add the admin read endpoints once more per-type child tables land.
 */
@Injectable()
export class DerivativeArtifactService {
  private readonly logger = new Logger(DerivativeArtifactService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Transactionally write a `DerivativeArtifact` together with its
   * `ProvenanceRecord` rows. The whole operation rolls back if any step
   * fails.
   *
   * Invariants enforced here (not in the database):
   * 1. `provenanceRecords.length >= 1` — §4.5 "no derivative without
   *    provenance." Empty arrays are rejected at the DTO layer by
   *    `@ArrayMinSize(1)` but we defend in depth here too.
   * 2. `contentDisclaimerId` resolves to an existing `content_disclaimers`
   *    row. The FK would reject at the DB layer anyway, but the pre-check
   *    produces a clean `NotFoundException` instead of a noisy P2003.
   * 3. Duplicate `(sourceDocumentId, derivativeType, taxonomyVersion)`
   *    triples surface as `ConflictException` — the §2.2 unique constraint
   *    prevents accidentally re-running generation against the same
   *    source without first deleting the existing artifact.
   */
  async create(dto: CreateDerivativeArtifactDto): Promise<DerivativeArtifact> {
    if (!dto.provenanceRecords || dto.provenanceRecords.length === 0) {
      // Defence in depth — the DTO layer already enforces this.
      throw new BadRequestException(
        'DerivativeArtifact requires at least one provenance record (§4.5)',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        return this.writeArtifactInTx(tx, dto);
      });
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  /**
   * Transactionally write an MCQ: one `DerivativeArtifact` row with
   * `derivativeType = 'mcq_question'`, one `McqQuestion` row, and exactly
   * four `McqOption` rows. Either the whole graph lands or nothing lands.
   *
   * Structural invariants enforced here, BEFORE the transaction opens, so
   * a failing DTO never touches the database:
   *
   *   1. `options.length === 4` (also bounded by `@ArrayMinSize(4)` /
   *      `@ArrayMaxSize(4)` at the DTO layer, but we defend in depth).
   *   2. Exactly one option has `isCorrect: true`.
   *   3. Option labels are exactly the set `{A, B, C, D}` — rejects
   *      duplicates AND out-of-range labels in one check.
   *   4. `questionStem` is present and non-empty after trimming.
   *   5. `explanation` is present and non-empty after trimming.
   *
   * Intentionally NOT enforced here:
   *   - §5.3 content-quality rules (distractor plausibility, stem does
   *     not leak the answer, supporting section IDs exist, subject
   *     coherence with §5.3a check 8). Those are the `McqQuestionValidator`
   *     (§4.4) and run upstream in the generation pipeline before this
   *     DTO is ever constructed. The generator is responsible for
   *     rejecting or retrying bad outputs; this service only persists
   *     outputs that are already structurally well-formed.
   *   - The `ai_mcq` content_disclaimers row must exist — but that is
   *     delegated to the generic base-write FK pre-check (see
   *     `writeArtifactInTx`). Callers pass its ID in the base DTO fields.
   *
   * Returns the persisted artifact + question + all four options so the
   * caller can continue wiring (e.g., emit an analytics event or enqueue
   * a validator follow-up) without a round-trip re-read.
   */
  async createMcqQuestion(dto: CreateMcqQuestionDto): Promise<{
    artifact: DerivativeArtifact;
    mcqQuestion: McqQuestion;
    mcqOptions: McqOption[];
  }> {
    // -------- Structural invariants (pre-transaction) ----------------
    if (!dto.questionStem || dto.questionStem.trim().length === 0) {
      throw new BadRequestException(
        'McqQuestion requires a non-empty questionStem',
      );
    }
    if (!dto.explanation || dto.explanation.trim().length === 0) {
      throw new BadRequestException(
        'McqQuestion requires a non-empty explanation',
      );
    }
    if (!Array.isArray(dto.options) || dto.options.length !== 4) {
      throw new BadRequestException(
        `McqQuestion requires exactly 4 options, got ${dto.options?.length ?? 0}`,
      );
    }

    const labels = dto.options.map((o) => o.optionLabel);
    const expected = new Set<string>(MCQ_OPTION_LABELS);
    const got = new Set<string>(labels);
    const labelSetMatches =
      got.size === expected.size &&
      [...expected].every((l) => got.has(l)) &&
      labels.length === expected.size;
    if (!labelSetMatches) {
      throw new BadRequestException(
        `McqQuestion options must have exactly the labels {A, B, C, D}; got [${labels.join(', ')}]`,
      );
    }

    const correctCount = dto.options.filter((o) => o.isCorrect === true).length;
    if (correctCount !== 1) {
      throw new BadRequestException(
        `McqQuestion must have exactly one correct option; got ${correctCount}`,
      );
    }

    // Base-DTO §4.5 defence-in-depth guard. The DTO layer enforces
    // ArrayMinSize(1) too but a programmatic caller can bypass that.
    if (!dto.provenanceRecords || dto.provenanceRecords.length === 0) {
      throw new BadRequestException(
        'DerivativeArtifact requires at least one provenance record (§4.5)',
      );
    }

    // -------- Build base DTO + structured contentJson ----------------
    const difficulty = dto.difficulty ?? dto.difficultySelfReport ?? 'medium';
    const difficultySelfReport =
      dto.difficultySelfReport ?? dto.difficulty ?? 'medium';

    // Mirrors the §5.3 generator output schema shape, minus the
    // `abstain` / `abstainReason` fields (abstention is a generation-path
    // concern — if a generation abstains, it doesn't produce an artifact
    // to persist in the first place). This payload lives on the base
    // row so reads can render the MCQ without joining the child tables.
    const contentJson = {
      questionStem: dto.questionStem,
      explanation: dto.explanation,
      options: dto.options.map((o) => ({
        label: o.optionLabel,
        text: o.optionText,
        isCorrect: o.isCorrect,
        rationale: o.rationale ?? null,
      })),
      difficultySelfReport,
      supportingSectionIds: dto.supportingSectionIds ?? [],
    };

    const baseDto: CreateDerivativeArtifactDto = {
      derivativeType: 'mcq_question',
      sourceDocumentId: dto.sourceDocumentId,
      sourceSectionId: dto.sourceSectionId,
      organizationId: dto.organizationId,
      createdByUserId: dto.createdByUserId,
      derivativeGenerationJobId: dto.derivativeGenerationJobId,
      title: dto.title,
      contentJson: contentJson as Record<string, unknown>,
      contentPlainText: dto.contentPlainText,
      contentHash: dto.contentHash,
      tokenCount: dto.tokenCount,
      confidenceScore: dto.confidenceScore,
      reviewStatus: dto.reviewStatus,
      validatorVerdict: dto.validatorVerdict,
      validatorReasonsJson: dto.validatorReasonsJson,
      visibility: dto.visibility,
      audience: dto.audience,
      contentRights: dto.contentRights,
      contentDisclaimerId: dto.contentDisclaimerId,
      modelRunId: dto.modelRunId,
      taxonomyVersion: dto.taxonomyVersion,
      language: dto.language,
      provenanceRecords: dto.provenanceRecords,
    };

    // -------- Transactional write ------------------------------------
    try {
      return await this.prisma.$transaction(async (tx) => {
        const artifact = await this.writeArtifactInTx(tx, baseDto);

        const mcqQuestion = await tx.mcqQuestion.create({
          data: {
            derivativeArtifactId: artifact.id,
            questionStem: dto.questionStem,
            explanation: dto.explanation,
            difficulty,
            questionFormat: dto.questionFormat ?? 'single_best',
            subjectTopicId: dto.subjectTopicId,
          },
        });

        // createMany does not return the inserted rows, so use a parallel
        // sequence of creates. Four rows in a single transaction is
        // negligible — the simpler read-back is worth it.
        const mcqOptions = await Promise.all(
          dto.options.map((o) =>
            tx.mcqOption.create({
              data: {
                mcqQuestionId: mcqQuestion.id,
                optionLabel: o.optionLabel,
                optionText: o.optionText,
                isCorrect: o.isCorrect,
                rationale: o.rationale,
              },
            }),
          ),
        );

        return { artifact, mcqQuestion, mcqOptions };
      });
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  /**
   * Inner transactional helper — writes one artifact + its provenance
   * rows inside an already-open transaction context. Caller owns the
   * `$transaction` bracket and the error mapping.
   *
   * Extracted so both `create()` and `createMcqQuestion()` share exactly
   * one copy of the §4.5 invariant enforcement and the disclaimer
   * pre-check. If you change this method, re-run the derivative-artifact
   * unit suite AND the mcq-question suite.
   */
  private async writeArtifactInTx(
    tx: Prisma.TransactionClient,
    dto: CreateDerivativeArtifactDto,
  ): Promise<DerivativeArtifact> {
    // Pre-check the disclaimer FK. We want a clean error rather than a
    // P2003 foreign-key violation, because the §8.6 launch gate treats
    // "no disclaimer attached" as a load-bearing contract.
    const disclaimer = await tx.contentDisclaimer.findUnique({
      where: { id: dto.contentDisclaimerId },
      select: { id: true, isActive: true },
    });
    if (!disclaimer) {
      throw new NotFoundException(
        `ContentDisclaimer ${dto.contentDisclaimerId} not found — ` +
          'every derivative must attach a seeded disclaimer row (§2.5, §8.6)',
      );
    }

    const artifact = await tx.derivativeArtifact.create({
      data: {
        derivativeType: dto.derivativeType,
        sourceDocumentId: dto.sourceDocumentId,
        sourceSectionId: dto.sourceSectionId,
        organizationId: dto.organizationId,
        createdByUserId: dto.createdByUserId,
        derivativeGenerationJobId: dto.derivativeGenerationJobId,
        title: dto.title,
        contentJson: dto.contentJson as Prisma.InputJsonValue,
        contentPlainText: dto.contentPlainText,
        contentHash: dto.contentHash,
        tokenCount: dto.tokenCount,
        confidenceScore: dto.confidenceScore,
        reviewStatus: dto.reviewStatus ?? 'draft',
        validatorVerdict: dto.validatorVerdict,
        validatorReasonsJson: dto.validatorReasonsJson as
          | Prisma.InputJsonValue
          | undefined,
        visibility: dto.visibility ?? 'private',
        audience: dto.audience ?? 'both',
        contentRights: dto.contentRights,
        contentDisclaimerId: dto.contentDisclaimerId,
        modelRunId: dto.modelRunId,
        taxonomyVersion: dto.taxonomyVersion,
        language: dto.language ?? 'en',
      },
    });

    // §4.5 provenance — written in the same bracket as the artifact so
    // the invariant "no derivative without provenance" holds on every
    // committed transaction. ProvenanceRecord uses the generic
    // entityType/entityId shape (no FK from entityId).
    await tx.provenanceRecord.createMany({
      data: dto.provenanceRecords.map((p) => ({
        entityType: 'derivative_artifact',
        entityId: artifact.id,
        sourceDocumentId: p.sourceDocumentId,
        sourceSectionId: p.sourceSectionId,
        provenanceType: p.provenanceType,
      })),
    });

    return artifact;
  }

  /**
   * Translate Prisma errors into the appropriate NestJS HTTP exceptions.
   * Explicit NestJS exceptions are let through unchanged so the §4.5
   * `BadRequestException`, the disclaimer `NotFoundException`, and the
   * §2.2 `ConflictException` all keep their original call-site messages.
   */
  private mapWriteError(err: unknown): Error {
    if (
      err instanceof NotFoundException ||
      err instanceof BadRequestException ||
      err instanceof ConflictException
    ) {
      return err;
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Unique constraint — either §2.2 (source, type, taxonomy) on
      // derivative_artifacts, or (mcqQuestionId, optionLabel) on
      // mcq_options (duplicate labels slipping through the pre-check).
      if (err.code === 'P2002') {
        return new ConflictException(
          'A derivative_artifact with the same (sourceDocumentId, ' +
            'derivativeType, taxonomyVersion) already exists, or an MCQ ' +
            'option label collided within the same question. Delete the ' +
            'existing row before regenerating.',
        );
      }
      // Foreign-key violation on any of the other relations.
      if (err.code === 'P2003') {
        return new BadRequestException(
          `Referenced row does not exist: ${err.meta?.['field_name'] ?? 'unknown field'}`,
        );
      }
    }

    // Don't log the full DTO — it may carry PII in title / contentPlainText.
    this.logger.error(
      `DerivativeArtifact write failed: ${(err as Error).message}`,
    );
    return err as Error;
  }
}

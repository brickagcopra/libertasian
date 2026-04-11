import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DerivativeArtifact } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateDerivativeArtifactDto } from './dto';

/**
 * Low-level write path for `DerivativeArtifact` rows.
 *
 * This service is the only place in the API that should insert into
 * `derivative_artifacts`. It enforces the §4.5 invariant — every artifact
 * has at least one `ProvenanceRecord` row written in the same transaction
 * — at the code layer, because the architecture spec (§2.4) explicitly
 * rules out a DB-level CHECK constraint. See
 * `docs/architecture/corpus-platform-target-architecture.md` §2.2, §4.5.
 *
 * No controller is wired to this service yet. It is the foundation the
 * derivative generation pipeline (Phase 3+) will call. A later PR will
 * add the admin read endpoints once the per-type child tables land.
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
        // (2) Pre-check the disclaimer FK. We want a clean error rather
        // than a P2003 foreign-key violation, because the §8.6 launch gate
        // treats "no disclaimer attached" as a load-bearing contract.
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

        // (1) Write all provenance rows. ProvenanceRecord uses the generic
        // entityType/entityId shape (no FK from entityId) — the
        // transactional bracket is what keeps the two in sync.
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
      });
    } catch (err) {
      // Let explicit NestJS exceptions flow through unchanged.
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException ||
        err instanceof ConflictException
      ) {
        throw err;
      }

      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // (3) Unique constraint on (sourceDocumentId, derivativeType, taxonomyVersion).
        if (err.code === 'P2002') {
          throw new ConflictException(
            'A derivative_artifact with the same (sourceDocumentId, ' +
              'derivativeType, taxonomyVersion) already exists. Delete the ' +
              'existing row before regenerating.',
          );
        }
        // Foreign-key violation on any of the other relations.
        if (err.code === 'P2003') {
          throw new BadRequestException(
            `Referenced row does not exist: ${err.meta?.['field_name'] ?? 'unknown field'}`,
          );
        }
      }

      // Don't log the full DTO — it may carry PII in title / contentPlainText.
      this.logger.error(
        `DerivativeArtifact create failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }
}

/**
 * One-shot backfill for derivative subject assignments.
 *
 * Context: two things combined to leave derivative artifacts without
 * subject chips on prod:
 *   1. The classifier has been failing validation for every legal_document
 *      since 2026-04-15 (see classification_generation_tasks.py fix),
 *      so document_subject_assignments has 0 rows for all ~92 docs.
 *   2. The on-approve fallback in derivatives-review.service.ts copies
 *      from parent-doc assignments, so approved artifacts inherit
 *      nothing when the parent has nothing.
 *
 * Run this AFTER:
 *   (a) the classifier LLM-output shape has been diagnosed and fixed
 *       (use classify_one CLI + the new instrumentation)
 *   (b) classify_unclassified_batch has been triggered at least once
 *       with a high limit so all legal_documents have assignments.
 *
 * Then this script will:
 *   - Find every approved DerivativeArtifact with zero subjectAssignments
 *     whose parent LegalDocument now has ≥1 assignments.
 *   - Copy the parent's (subjectId, subjectTopicId, isPrimary) tuples to
 *     the artifact, with classifiedBy='manual' to reflect that this is
 *     an operator-run backfill, not a fresh classifier run.
 *
 * Usage (run from repo root):
 *   pnpm --filter @libertasian/api exec ts-node scripts/backfill-derivative-subjects.ts --dry-run
 *   pnpm --filter @libertasian/api exec ts-node scripts/backfill-derivative-subjects.ts
 *
 * Phase 1 (classify the 92 documents) is NOT done here — it's a pure
 * Celery dispatch. On prod, run:
 *   docker compose exec worker-service \
 *     celery -A src.celery_app call classification.classify_unclassified_batch \
 *     --kwargs='{"limit": 200}'
 * then wait for the tasks to complete before re-running this script.
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();

  try {
    const unclassifiedDocCount = await prisma.legalDocument.count({
      where: { subjectAssignments: { none: {} } },
    });
    console.log(
      `LegalDocuments with zero subject assignments: ${unclassifiedDocCount}`,
    );
    if (unclassifiedDocCount > 0) {
      console.log(
        '  -> Run Phase 1 (classification) before this script will fully back-fill artifacts.',
      );
    }

    const candidates = await prisma.derivativeArtifact.findMany({
      where: {
        deletedAt: null,
        reviewStatus: 'approved',
        subjectAssignments: { none: {} },
        sourceDocumentId: { not: null },
      },
      select: {
        id: true,
        derivativeType: true,
        sourceDocumentId: true,
        sourceDocument: {
          select: {
            subjectAssignments: {
              select: {
                subjectId: true,
                subjectTopicId: true,
                isPrimary: true,
              },
            },
          },
        },
      },
    });

    console.log(
      `Approved artifacts missing subjects: ${candidates.length}`,
    );

    let artifactsUpdated = 0;
    let assignmentsWritten = 0;
    let parentEmpty = 0;

    for (const artifact of candidates) {
      const parentAssignments =
        artifact.sourceDocument?.subjectAssignments ?? [];

      if (parentAssignments.length === 0) {
        parentEmpty += 1;
        continue;
      }

      if (dryRun) {
        artifactsUpdated += 1;
        assignmentsWritten += parentAssignments.length;
        console.log(
          `[dry-run] artifact ${artifact.id} (${artifact.derivativeType}) <- ${parentAssignments.length} assignment(s)`,
        );
        continue;
      }

      const result = await prisma.documentSubjectAssignment.createMany({
        data: parentAssignments.map((a) => ({
          derivativeArtifactId: artifact.id,
          subjectId: a.subjectId,
          subjectTopicId: a.subjectTopicId,
          isPrimary: a.isPrimary,
          classifiedBy: 'manual',
          confidence: null,
        })),
        skipDuplicates: true,
      });

      if (result.count > 0) {
        artifactsUpdated += 1;
        assignmentsWritten += result.count;
      }
    }

    console.log('---');
    console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'EXECUTED'}`);
    console.log(`Artifacts updated: ${artifactsUpdated}`);
    console.log(`Total assignments written: ${assignmentsWritten}`);
    console.log(
      `Artifacts skipped (parent still unclassified): ${parentEmpty}`,
    );
    if (parentEmpty > 0) {
      console.log(
        '  -> Those artifacts need Phase 1 (classification) to complete before re-running.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

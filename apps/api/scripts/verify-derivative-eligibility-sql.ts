/**
 * Ad-hoc verification for the two derivative-eligibility queries.
 *
 * They are raw SQL (a Prisma `notIn` over ~190k artifact ids blows the
 * driver's parameter limit on prod), so unit tests can only assert the
 * text. This script runs them against a real Postgres with the real
 * schema and checks the anti-joins actually behave.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx ts-node scripts/verify-derivative-eligibility-sql.ts
 *
 * Point it at a THROWAWAY database — it writes and then deletes rows.
 */
import { PrismaClient } from '@prisma/client';

import { DerivativesAdminService } from '../src/modules/derivatives-admin/derivatives-admin.service';
import { AdminPipelineOpsService } from '../src/modules/admin-pipeline-ops/admin-pipeline-ops.service';

const prisma = new PrismaClient();

const aiSettings = {
  getSetting: async (key: string) =>
    key === 'derivative_generation.enabled'
      ? { key, value: { enabled: true }, description: null }
      : {
          key,
          value: {
            case_digest: true,
            doctrine_extract: true,
            mcq_question: true,
            essay_prompt: true,
            flashcard: true,
            subject_outline: true,
          },
          description: null,
        },
  updateSetting: async () => undefined,
};
const audit = { log: async () => undefined };
const celery = { sendTask: async () => 'task-id' };
const redis = {
  get: async () => null,
  set: async () => undefined,
  del: async () => 1,
};
const config = { get: (_k: string, fallback: unknown) => fallback };



function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  // eslint-disable-next-line no-console
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, want ${JSON.stringify(expected)}`}`,
  );
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: 'sql-check@libertasian.invalid' },
    update: {},
    create: { email: 'sql-check@libertasian.invalid', fullName: 'SQL Check' },
  });
  const USER_ID = user.id;

  const source = await prisma.source.create({
    data: { name: 'sql-check source', type: 'official', trustLevel: 'high' },
  });

  const disclaimer = await prisma.contentDisclaimer.upsert({
    where: { contentClass: 'sql-check' },
    update: {},
    create: {
      contentClass: 'sql-check',
      bodyHtml: '<p>check</p>',
      bodyPlain: 'check',
    },
  });

  // Three documents, oldest first by created_at.
  const docs = [];
  for (let i = 0; i < 3; i++) {
    docs.push(
      await prisma.legalDocument.create({
        data: {
          sourceId: source.id,
          title: `sql-check doc ${i}`,
          documentType: 'case',
          court: i === 2 ? 'Court of Appeals' : 'Supreme Court',
          decisionDate: new Date(`202${i}-06-01`),
          createdAt: new Date(`202${i}-01-01`),
        },
      }),
    );
  }

  // doc[0] already has a live case_digest artifact.
  await prisma.derivativeArtifact.create({
    data: {
      derivativeType: 'case_digest',
      sourceDocumentId: docs[0]!.id,
      title: 'existing',
      contentJson: {},
      contentHash: 'hash-existing',
      contentRights: 'internal',
      contentDisclaimerId: disclaimer.id,
    },
  });
  // doc[1] has a soft-deleted one — it must still count as missing.
  await prisma.derivativeArtifact.create({
    data: {
      derivativeType: 'case_digest',
      sourceDocumentId: docs[1]!.id,
      title: 'soft-deleted',
      deletedAt: new Date(),
      taxonomyVersion: 'v2',
      contentJson: {},
      contentHash: 'hash-deleted',
      contentRights: 'internal',
      contentDisclaimerId: disclaimer.id,
    },
  });

  const derivatives = new DerivativesAdminService(
    prisma as never,
    aiSettings as never,
    audit as never,
  );

  // ── enqueueGeneration: NOT EXISTS path ──────────────────
  const enqueued = await derivatives.enqueueGeneration(
    { derivativeType: 'case_digest', maxCount: 50 },
    USER_ID,
  );
  check('enqueueGeneration skips the doc with a live artifact', enqueued.enqueuedCount, 2);
  check(
    'enqueueGeneration quotes the measured cost',
    Number(enqueued.estimatedCostUsd.toFixed(4)),
    0.0034,
  );

  await prisma.derivativeGenerationJob.deleteMany({
    where: { id: { in: enqueued.jobIds } },
  });

  // ── enqueueGeneration: regenerateExisting drops the anti-join ──
  const regen = await derivatives.enqueueGeneration(
    { derivativeType: 'case_digest', regenerateExisting: true, maxCount: 50 },
    USER_ID,
  );
  check('regenerateExisting re-picks every document', regen.enqueuedCount, 3);
  await prisma.derivativeGenerationJob.deleteMany({
    where: { id: { in: regen.jobIds } },
  });

  // ── enqueueGeneration: filters are applied in SQL ───────
  const filtered = await derivatives.enqueueGeneration(
    {
      derivativeType: 'case_digest',
      court: 'Court of Appeals',
      sourceId: source.id,
      dateFrom: '2020-01-01',
      dateTo: '2030-01-01',
      regenerateExisting: true,
      maxCount: 50,
    },
    USER_ID,
  );
  check('court + sourceId + date filters narrow to one doc', filtered.enqueuedCount, 1);
  await prisma.derivativeGenerationJob.deleteMany({
    where: { id: { in: filtered.jobIds } },
  });

  // ── backfillMissingDerivatives: whole-corpus, oldest first ──
  const ops = new AdminPipelineOpsService(
    prisma as never,
    celery as never,
    { sweepBacklog: async () => ({ promoted: 0, scanned: 0 }) } as never,
    redis as never,
    config as never,
  );

  const firstRun = await ops.backfillMissingDerivatives(
    [{ type: 'flashcard', limit: 2 }],
    USER_ID,
  );
  check('first run dispatches up to the limit', firstRun.totalDispatched, 2);
  check('first run reports the rest as remaining', firstRun.totalRemaining, 1);

  const dispatched = await prisma.derivativeGenerationJob.findMany({
    where: { derivativeType: 'flashcard' },
    orderBy: { createdAt: 'asc' },
    select: { sourceDocumentId: true },
  });
  check(
    'oldest documents drained first',
    dispatched.map((j) => j.sourceDocumentId).sort(),
    [docs[0]!.id, docs[1]!.id].sort(),
  );

  // Second run must reach the doc the first run could not — the exact
  // case the old newest-N scan could never get to.
  const secondRun = await ops.backfillMissingDerivatives(
    [{ type: 'flashcard', limit: 2 }],
    USER_ID,
  );
  check('second run reaches the older remainder', secondRun.totalDispatched, 1);
  check('nothing left afterwards', secondRun.totalRemaining, 0);

  const thirdRun = await ops.backfillMissingDerivatives(
    [{ type: 'flashcard', limit: 2 }],
    USER_ID,
  );
  check('a drained corpus dispatches nothing', thirdRun.totalDispatched, 0);

  // ── cleanup ─────────────────────────────────────────────
  await prisma.derivativeGenerationJob.deleteMany({
    where: { sourceDocumentId: { in: docs.map((d) => d.id) } },
  });
  await prisma.derivativeArtifact.deleteMany({
    where: { contentDisclaimerId: disclaimer.id },
  });
  await prisma.legalDocument.deleteMany({
    where: { id: { in: docs.map((d) => d.id) } },
  });
  await prisma.contentDisclaimer.delete({ where: { id: disclaimer.id } });
  await prisma.source.delete({ where: { id: source.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

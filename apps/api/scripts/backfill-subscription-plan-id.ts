/**
 * Idempotent backfill for `subscriptions.plan_id`.
 *
 * Context: every one of the twelve subscription create/upsert sites wrote
 * `plan_code` only, and the plans table was re-seeded with fresh UUIDs on
 * 2026-07-13. Rows created before the re-seed point at plan ids that no longer
 * exist or were never set; rows created after it have `plan_id IS NULL`.
 * Measured on prod 2026-09-12: 57 subscriptions, 41 with `plan_id IS NULL`
 * (33 of them active), 47 active on `plan_code = 'free'` of which only 14
 * carry a `plan_id`.
 *
 * `plan_code` stays authoritative — this only fills in the convenience
 * relation used for display, joins and reporting. New rows are handled at
 * write time by the Prisma extension in PrismaService
 * (src/prisma/subscription-plan-link.ts); this script repairs the existing
 * ones.
 *
 * What it touches: `subscriptions.plan_id`, and only on rows where it is
 * currently NULL and the row's `plan_code` matches a plans row. Nothing else
 * is read for writing, no other column is written, and rows whose code has no
 * plan are reported and left alone. Running it twice is a no-op the second
 * time (the WHERE clause no longer matches anything it already fixed).
 *
 * Usage (run from repo root):
 *   pnpm --filter @libertasian/api exec ts-node scripts/backfill-subscription-plan-id.ts --dry-run
 *   pnpm --filter @libertasian/api exec ts-node scripts/backfill-subscription-plan-id.ts
 */
import { PrismaClient } from '@prisma/client';

interface CodeReport {
  planCode: string;
  planId: string | null;
  nullPlanIdRows: number;
  updated: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();

  try {
    const plans = await prisma.plan.findMany({ select: { id: true, code: true } });
    const planIdByCode = new Map(plans.map((plan) => [plan.code, plan.id]));
    console.log(`Plans in registry: ${plans.length}`);

    // Group the rows that still need a plan_id by their authoritative code.
    const pending = await prisma.subscription.groupBy({
      by: ['planCode'],
      where: { planId: null },
      _count: { _all: true },
    });

    const totalPending = pending.reduce((sum, row) => sum + row._count._all, 0);
    console.log(`Subscriptions with plan_id IS NULL: ${totalPending}`);
    if (totalPending === 0) {
      console.log('Nothing to backfill.');
      return;
    }

    const reports: CodeReport[] = [];
    for (const row of pending.sort((a, b) => a.planCode.localeCompare(b.planCode))) {
      const planId = planIdByCode.get(row.planCode) ?? null;
      const report: CodeReport = {
        planCode: row.planCode,
        planId,
        nullPlanIdRows: row._count._all,
        updated: 0,
      };

      if (planId && !dryRun) {
        const result = await prisma.subscription.updateMany({
          // planId: null is what makes this idempotent — a second run matches
          // nothing this run already fixed.
          where: { planCode: row.planCode, planId: null },
          data: { planId },
        });
        report.updated = result.count;
      } else if (planId) {
        report.updated = row._count._all; // dry run: what would be written
      }

      reports.push(report);
    }

    console.log('');
    console.log(dryRun ? 'Would update (dry run):' : 'Updated:');
    for (const report of reports) {
      if (report.planId) {
        console.log(
          `  ${report.planCode.padEnd(24)} ${String(report.updated).padStart(6)} row(s) -> ${report.planId}`,
        );
      } else {
        console.log(
          `  ${report.planCode.padEnd(24)} ${String(report.nullPlanIdRows).padStart(6)} row(s) SKIPPED — no plan row for this code`,
        );
      }
    }

    const updated = reports.reduce((sum, report) => sum + report.updated, 0);
    const skipped = reports
      .filter((report) => !report.planId)
      .reduce((sum, report) => sum + report.nullPlanIdRows, 0);
    console.log('');
    console.log(`Total ${dryRun ? 'resolvable' : 'updated'}: ${updated}`);
    console.log(`Total skipped (unresolvable plan_code): ${skipped}`);
    if (skipped > 0) {
      console.log(
        'Skipped rows keep working — plan_code is authoritative and plan_id stays NULL.',
      );
    }
    if (dryRun) {
      console.log('');
      console.log('Dry run — no rows were written. Re-run without --dry-run to apply.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

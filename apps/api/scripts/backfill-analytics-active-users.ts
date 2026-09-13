/**
 * Idempotent backfill for the `dau`, `wau` and `mau` daily aggregates.
 *
 * Context: `AnalyticsAggregationService` computed DAU as distinct users in
 * `analytics_events`, a table with 60 rows in its entire history because no
 * client surface emits events yet — so every KPI card on /admin/analytics read
 * 0. `wau` and `mau` were requested by `getOverview` but had never been
 * computed at all, so those two cards were permanently blank. The service now
 * unions `login_events` (`event_type = 'login_success'`) into all three, which
 * fixes the numbers from the next cron run forward. This script recomputes the
 * same three metrics for the trailing 90 days so the history and the trend
 * charts are honest too, rather than a flat line of zeros with a step in it.
 *
 * What it touches: `analytics_daily_aggregates` rows whose `metric_name` is
 * `dau`, `wau` or `mau`, undimensioned and `platform:*`. It writes through the
 * service's own `upsertAggregate`, which is an `INSERT ... ON CONFLICT (date,
 * metric_name, dimension, organization_id) DO UPDATE`, so running it twice is
 * a no-op the second time and it can safely overlap the 02:00 UTC cron. No
 * other metric, table or column is written, and it only ever reads
 * `login_events` and `analytics_events`.
 *
 * Note the windows overlap by design: the `mau` row for a given date counts
 * the 30 days ending on that date, so recomputing 90 days reads roughly 120
 * days of logins.
 *
 * Usage (run from repo root):
 *   pnpm --filter @libertasian/api exec ts-node scripts/backfill-analytics-active-users.ts --dry-run
 *   pnpm --filter @libertasian/api exec ts-node scripts/backfill-analytics-active-users.ts
 *   pnpm --filter @libertasian/api exec ts-node scripts/backfill-analytics-active-users.ts --days=30
 */
import { PrismaClient } from '@prisma/client';

import { PrismaService } from '../src/prisma/prisma.service';
import { AnalyticsAggregationService } from '../src/modules/analytics/analytics-aggregation.service';

const DEFAULT_DAYS = 90;

function parseDays(): number {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  if (!arg) return DEFAULT_DAYS;
  const days = Number.parseInt(arg.slice('--days='.length), 10);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error(`--days must be an integer between 1 and 365, got "${arg}"`);
  }
  return days;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const days = parseDays();
  const prisma = new PrismaClient();

  // The aggregation service only ever touches `prisma.loginEvent`,
  // `prisma.analyticsEvent` and `$executeRaw`, all of which a plain
  // PrismaClient provides. Reusing the service is the point: the backfill and
  // the nightly cron must not be able to compute these three metrics
  // differently.
  const service = new AnalyticsAggregationService(prisma as unknown as PrismaService);

  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const logins = await prisma.loginEvent.count({
      where: {
        eventType: 'login_success',
        createdAt: { gte: new Date(today.getTime() - days * 24 * 60 * 60 * 1000) },
      },
    });
    console.log(`Backfilling dau/wau/mau for the last ${days} days (ending ${today.toISOString().split('T')[0]}).`);
    console.log(`Successful logins in range: ${logins}`);

    if (dryRun) {
      console.log('--dry-run: no aggregates written.');
      return;
    }

    // Oldest first, so a run interrupted part-way leaves a contiguous history.
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - offset);
      await service.computeActiveUserMetrics(date);
      const dateStr = date.toISOString().split('T')[0];
      console.log(`  ${dateStr} done (${days - offset}/${days})`);
    }

    console.log('Backfill complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

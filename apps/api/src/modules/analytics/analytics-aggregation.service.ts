import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';

/** The platform buckets the active-user metrics are split by. */
export type AnalyticsPlatform = 'ios' | 'android' | 'web';

export const ANALYTICS_PLATFORMS: readonly AnalyticsPlatform[] = ['ios', 'android', 'web'];

/**
 * Classify a `login_events.user_agent` into a platform bucket.
 *
 * Older mobile builds send no `deviceType` on anything, so the login request's
 * user agent is the only platform signal we have for the existing corpus of
 * logins. The two mobile HTTP stacks are unambiguous in it:
 *   - iOS  — `CFNetwork/x Darwin/y` appended by URLSession.
 *   - Android — `okhttp/x`.
 * Everything else, including an absent or unrecognised agent, is counted as
 * web. That is a deliberate bias: a desktop browser is the overwhelmingly
 * likely source of an agent that is neither of the two above, and silently
 * dropping unknowns would make the dimensioned rows disagree with the total
 * for a reason nobody could see on the dashboard.
 */
export function classifyPlatformFromUserAgent(
  userAgent: string | null | undefined,
): AnalyticsPlatform {
  const ua = (userAgent ?? '').toLowerCase();
  if (ua.includes('cfnetwork') || ua.includes('darwin')) return 'ios';
  if (ua.includes('okhttp')) return 'android';
  return 'web';
}

/**
 * The three active-user windows, in days, counted back from and including the
 * aggregation date.
 */
export const ACTIVE_USER_WINDOWS: readonly { metric: string; days: number }[] = [
  { metric: 'dau', days: 1 },
  { metric: 'wau', days: 7 },
  { metric: 'mau', days: 30 },
];

/**
 * How far back a catch-up run will look for days that were never aggregated.
 * Matches the dashboard's default 30-day window: a gap older than the window
 * anybody looks at is not worth the query budget on every boot.
 */
export const CATCH_UP_WINDOW_DAYS = 30;

/**
 * Ceiling on how many missing days one catch-up run will fill. A cold database
 * has 30 empty days in the window and each day is ~40 aggregate queries, so an
 * uncapped catch-up would turn a container restart loop into a self-inflicted
 * load test. Whatever is left over is filled by the next run.
 */
export const CATCH_UP_MAX_DAYS_PER_RUN = 7;

/** `YYYY-MM-DD` for a Date, in UTC. */
function toUtcDateString(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

/** Midnight UTC on the given UTC calendar date. */
function utcMidnight(date: Date): Date {
  const out = new Date(date);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/**
 * Daily aggregation cron job.
 *
 * Runs at 02:00 UTC daily — the `timeZone: 'UTC'` option on the decorator is
 * load-bearing, not decoration. `@nestjs/schedule` evaluates a cron expression
 * in the process timezone, and the API container sets `TZ=Asia/Manila`
 * (docker-compose.prod.yml) for dev parity, so a bare `'0 2 * * *'` fired at
 * 02:00 PHT = 18:00 UTC — eight hours away from the comment that used to sit
 * here, and in the middle of the day it was meant to be aggregating. Every
 * window in this service is computed in UTC, so the schedule is pinned to UTC
 * as well.
 *
 * Per LIBERTASIAN-ANALYTICS.md:
 * - Never queries raw events in dashboard endpoints
 * - Aggregates are UPSERTED (idempotent — safe to re-run)
 * - Should complete in <5 minutes for up to 1M daily events
 */
@Injectable()
export class AnalyticsAggregationService implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------------
  // Self-healing catch-up
  // -----------------------------------------------------------------------

  /**
   * Fill any day in the trailing window that has no aggregate rows, on boot.
   *
   * A deploy that restarts the container across the cron's fire minute used to
   * lose that day permanently — nothing retried it, and the dashboard rendered
   * the hole as a zero. That is what happened to 2026-09-12. The cron is a
   * one-shot trigger, so durability has to come from reconciling state rather
   * than from hoping the process is alive at 02:00.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.catchUpMissingDays();
    } catch (err) {
      // A boot-time backfill failure must never stop the API from starting.
      // The next cron run will try again.
      this.logger.error(`Startup analytics catch-up failed: ${(err as Error).message}`);
    }
  }

  /**
   * Aggregate every date in the trailing `CATCH_UP_WINDOW_DAYS` that has no
   * `analytics_daily_aggregates` row at all, oldest first, up to
   * `CATCH_UP_MAX_DAYS_PER_RUN`.
   *
   * "No row at all" is the gap test rather than "no row for metric X": the
   * per-date work is one sweep of every compute* method, so a date either got
   * the sweep or it did not. Re-running a date that already has rows is
   * harmless — every write is an upsert — but not free, so it is skipped.
   *
   * Returns the dates it filled, for the caller to log and for tests to assert
   * idempotency on.
   */
  async catchUpMissingDays(now: Date = new Date()): Promise<string[]> {
    // Yesterday is the newest date that can be complete; today is still open.
    const newest = utcMidnight(now);
    newest.setUTCDate(newest.getUTCDate() - 1);

    const oldest = new Date(newest);
    oldest.setUTCDate(oldest.getUTCDate() - (CATCH_UP_WINDOW_DAYS - 1));

    const candidates: Date[] = [];
    const cursor = new Date(oldest);
    while (cursor <= newest) {
      candidates.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const present = await this.prisma.analyticsDailyAggregate.findMany({
      where: { date: { gte: oldest, lte: newest } },
      select: { date: true },
      distinct: ['date'],
    });
    const haveDates = new Set(present.map((row) => toUtcDateString(row.date)));

    const missing = candidates.filter((date) => !haveDates.has(toUtcDateString(date)));
    if (missing.length === 0) {
      this.logger.log(
        `Analytics catch-up: no gaps in the trailing ${CATCH_UP_WINDOW_DAYS} days`,
      );
      return [];
    }

    const toFill = missing.slice(0, CATCH_UP_MAX_DAYS_PER_RUN);
    const deferred = missing.length - toFill.length;
    this.logger.warn(
      `Analytics catch-up: ${missing.length} missing day(s) in the trailing ` +
        `${CATCH_UP_WINDOW_DAYS} days; filling ${toFill.length}` +
        (deferred > 0 ? `, deferring ${deferred} to the next run` : ''),
    );

    const filled: string[] = [];
    for (const date of toFill) {
      const dateStr = toUtcDateString(date);
      try {
        await this.aggregateForDate(date);
        filled.push(dateStr);
      } catch (err) {
        // One bad day must not block the rest of the backfill.
        this.logger.error(
          `Analytics catch-up: failed to fill ${dateStr}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Analytics catch-up filled ${filled.length} day(s): ${filled.join(', ') || 'none'}`,
    );
    return filled;
  }

  // -----------------------------------------------------------------------
  // Cron entry point — runs at 02:00 UTC daily (timeZone pinned, see above)
  // -----------------------------------------------------------------------

  @Cron('0 2 * * *', { name: 'aggregate_daily_metrics', timeZone: 'UTC' })
  async aggregateDailyMetrics(): Promise<void> {
    // Reconcile first: if a restart, an outage or a failed run lost a day, fix
    // it before adding today's, so a hole never becomes permanent.
    await this.catchUpMissingDays();

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);

    const dateStr = toUtcDateString(yesterday);
    this.logger.log(`Starting daily aggregation for ${dateStr}`);
    const startTime = Date.now();

    try {
      await this.aggregateForDate(yesterday);
      await this.ensurePartitions();

      const durationMs = Date.now() - startTime;
      this.logger.log(`Daily aggregation for ${dateStr} completed in ${durationMs}ms`);
    } catch (err) {
      this.logger.error(`Daily aggregation failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Every metric for one UTC date. The single place that knows the full sweep,
   * so the cron and the catch-up backfill cannot drift apart — a backfill that
   * computed a subset would leave a day that looks aggregated and is not.
   */
  async aggregateForDate(date: Date): Promise<void> {
    const day = utcMidnight(date);
    await this.computeEngagementMetrics(day);
    await this.computeSurfaceMetrics(day);
    await this.computeSearchMetrics(day);
    await this.computeAiMetrics(day);
    await this.computeDigestMetrics(day);
    await this.computeScanMetrics(day);
    await this.computeStudyMetrics(day);
    await this.computeWorkspaceMetrics(day);
    await this.computeRevenueMetrics(day);
    await this.computeIngestionMetrics(day);
    await this.computeFunnels(day);
  }

  // -----------------------------------------------------------------------
  // Ensure future partitions exist (runs monthly)
  // -----------------------------------------------------------------------

  /**
   * 00:00 UTC on the 25th. `timeZone: 'UTC'` for the same reason as the daily
   * job: without it this fired at 00:00 PHT on the 25th, which is 16:00 UTC on
   * the 24th — a different month on the last week of a month.
   */
  @Cron('0 0 25 * *', { name: 'ensure_analytics_partitions', timeZone: 'UTC' })
  async ensurePartitions(): Promise<void> {
    try {
      await this.prisma.$executeRaw`SELECT ensure_analytics_partitions()`;
      this.logger.log('Analytics partitions ensured for upcoming months');
    } catch (err) {
      this.logger.error(`Partition creation failed: ${(err as Error).message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Upsert helper
  // -----------------------------------------------------------------------

  private async upsertAggregate(
    date: Date,
    metricName: string,
    metricValue: bigint | number,
    uniqueUsers: number,
    dimension?: string,
    organizationId?: string,
  ): Promise<void> {
    const dateOnly = new Date(date.toISOString().split('T')[0]!);

    // Use raw SQL for the upsert with the composite unique constraint
    await this.prisma.$executeRaw`
      INSERT INTO analytics_daily_aggregates (id, date, metric_name, dimension, metric_value, unique_users, organization_id, created_at)
      VALUES (gen_random_uuid(), ${dateOnly}, ${metricName}, ${dimension ?? null}, ${BigInt(metricValue)}, ${uniqueUsers}, ${organizationId ?? null}::uuid, NOW())
      ON CONFLICT (date, metric_name, dimension, organization_id)
      DO UPDATE SET metric_value = ${BigInt(metricValue)}, unique_users = ${uniqueUsers}
    `;
  }

  // -----------------------------------------------------------------------
  // Engagement Metrics
  // -----------------------------------------------------------------------

  /**
   * DAU, WAU and MAU — distinct active users over the trailing 1, 7 and 30 day
   * windows ending on (and including) `date`.
   *
   * Each window unions two sources of activity:
   *
   *   1. `login_events` where `event_type = 'login_success'`. This is the only
   *      source that has ever had volume: 104 successful logins from 21
   *      distinct users in the trailing 30 days as of 2026-09-12.
   *   2. `analytics_events` with a non-null `user_id` — 60 rows in the table's
   *      entire history, because no client surface is instrumented yet.
   *
   * The union is over user ids, not a sum of two counts, so a user who both
   * logged in and emitted an event on the same day is counted once. It is a
   * union rather than a replacement so these numbers keep working — and grow
   * to the real figure — as instrumentation lands, without a second migration
   * of this code.
   *
   * Each metric is written twice: an undimensioned row that is the total, and
   * one `platform:*` row per bucket. The platform rows are derived from login
   * user agents only (see classifyPlatformFromUserAgent), so they do NOT sum
   * to the total — a user known only from `analytics_events` has no platform
   * signal at all. Consumers must read the undimensioned row for a total and
   * never add the dimensioned ones up.
   */
  async computeActiveUserMetrics(date: Date): Promise<void> {
    const dayEnd = new Date(date);
    dayEnd.setUTCHours(0, 0, 0, 0);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    for (const { metric, days } of ACTIVE_USER_WINDOWS) {
      const windowStart = new Date(dayEnd);
      windowStart.setUTCDate(windowStart.getUTCDate() - days);

      const logins = await this.prisma.loginEvent.findMany({
        where: {
          eventType: 'login_success',
          createdAt: { gte: windowStart, lt: dayEnd },
        },
        select: { userId: true, userAgent: true },
        distinct: ['userId', 'userAgent'],
      });

      const events = await this.prisma.analyticsEvent.groupBy({
        by: ['userId'],
        where: {
          createdAt: { gte: windowStart, lt: dayEnd },
          userId: { not: null },
        },
      });

      const activeUsers = new Set<string>();
      const usersByPlatform = new Map<AnalyticsPlatform, Set<string>>(
        ANALYTICS_PLATFORMS.map((platform) => [platform, new Set<string>()]),
      );

      for (const login of logins) {
        activeUsers.add(login.userId);
        usersByPlatform.get(classifyPlatformFromUserAgent(login.userAgent))!.add(login.userId);
      }
      for (const row of events) {
        if (row.userId) activeUsers.add(row.userId);
      }

      const total = activeUsers.size;
      await this.upsertAggregate(date, metric, total, total);

      // Always write all three platform rows, zeros included: a missing row and
      // a genuine zero are indistinguishable to the dashboard otherwise.
      for (const platform of ANALYTICS_PLATFORMS) {
        const count = usersByPlatform.get(platform)!.size;
        await this.upsertAggregate(date, metric, count, count, `platform:${platform}`);
      }
    }
  }

  private async computeEngagementMetrics(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    // DAU / WAU / MAU — see computeActiveUserMetrics
    await this.computeActiveUserMetrics(date);

    // Sessions
    const sessionsResult = await this.prisma.analyticsSession.count({
      where: { startedAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'sessions', sessionsResult, 0);

    // Average session duration
    const avgDuration = await this.prisma.analyticsSession.aggregate({
      _avg: { durationSeconds: true },
      where: {
        startedAt: { gte: dayStart, lt: dayEnd },
        durationSeconds: { not: null },
      },
    });
    if (avgDuration._avg.durationSeconds !== null) {
      await this.upsertAggregate(date, 'avg_session_duration_seconds', Math.round(avgDuration._avg.durationSeconds), 0);
    }

    // Sessions by device type, and the same split under `platform:*`.
    //
    // Two dimension prefixes on purpose. `device:*` is whatever string the
    // client sent and keeps working for values outside the three platforms
    // (older builds, a future `tablet`). `platform:*` is the closed set of
    // ios/android/web that the dashboard's platform split reads, written for
    // all three every day including zeros — the same contract as the DAU
    // platform rows, so a missing row and a genuine zero stay distinguishable.
    // Both are dimensioned, so neither is ever added into the `sessions` total.
    const sessionsByDevice = await this.prisma.analyticsSession.groupBy({
      by: ['deviceType'],
      _count: true,
      where: { startedAt: { gte: dayStart, lt: dayEnd } },
    });

    const sessionsByPlatform = new Map<AnalyticsPlatform, number>(
      ANALYTICS_PLATFORMS.map((platform) => [platform, 0]),
    );
    for (const row of sessionsByDevice) {
      if (row.deviceType) {
        await this.upsertAggregate(date, 'sessions', row._count, 0, `device:${row.deviceType}`);
      }
      const platform = row.deviceType as AnalyticsPlatform | null;
      if (platform && sessionsByPlatform.has(platform)) {
        sessionsByPlatform.set(platform, sessionsByPlatform.get(platform)! + row._count);
      }
    }
    for (const platform of ANALYTICS_PLATFORMS) {
      await this.upsertAggregate(
        date,
        'sessions',
        sessionsByPlatform.get(platform)!,
        0,
        `platform:${platform}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Surface Metrics — where users actually go
  // -----------------------------------------------------------------------

  /**
   * `surface_views` — one row per product surface, plus an undimensioned total.
   *
   * Source is `page_viewed`, which both clients now fire on every navigation
   * with `properties.surface` taken from the shared route map (see
   * apps/web/src/lib/analytics-surfaces.ts and its mobile mirror). Grouping on
   * the stored surface rather than re-deriving it from `path` here keeps one
   * definition of "which surface is this" instead of two that can disagree.
   *
   * `unique_users` is distinct `user_id` per surface. A page view with no user
   * id (pre-auth) still counts as a view, so the view count is not gated on
   * having a user — a surface with traffic and no signed-in users is a real
   * thing to see, not a row to drop.
   *
   * A view whose properties carry no `surface` falls into `other` rather than
   * being discarded, for the same reason `surfaceForPath` has an `other`
   * fallback: an unmapped route must read as unmapped, not as unvisited. The
   * undimensioned total is written separately from the raw event count, so it
   * agrees with the sum of the surface rows by construction.
   */
  private async computeSurfaceMetrics(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    // Prisma's groupBy cannot group on a JSON path, so this is raw SQL. It is a
    // tagged template, so `dayStart`/`dayEnd` are bound parameters — never
    // interpolated — and no user-supplied string enters the query at all.
    const rows = await this.prisma.$queryRaw<
      { surface: string; views: bigint; unique_users: bigint }[]
    >`
      SELECT
        COALESCE(NULLIF(properties->>'surface', ''), 'other') AS surface,
        COUNT(*)::bigint AS views,
        COUNT(DISTINCT user_id)::bigint AS unique_users
      FROM analytics_events
      WHERE event_name = 'page_viewed'
        AND created_at >= ${dayStart}
        AND created_at < ${dayEnd}
      GROUP BY 1
    `;

    let totalViews = 0;
    for (const row of rows) {
      const views = Number(row.views);
      totalViews += views;
      await this.upsertAggregate(
        date,
        'surface_views',
        views,
        Number(row.unique_users),
        `surface:${row.surface}`,
      );
    }

    // Unique users across all surfaces is NOT the sum of the per-surface
    // counts — one user visits several surfaces a day. The total row therefore
    // carries its own distinct count.
    const distinctViewers = await this.prisma.analyticsEvent.groupBy({
      by: ['userId'],
      where: {
        eventName: 'page_viewed',
        createdAt: { gte: dayStart, lt: dayEnd },
        userId: { not: null },
      },
    });

    await this.upsertAggregate(date, 'surface_views', totalViews, distinctViewers.length);
  }

  // -----------------------------------------------------------------------
  // Search Metrics
  // -----------------------------------------------------------------------

  private async computeSearchMetrics(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    // Total searches
    const searchCount = await this.prisma.analyticsEvent.count({
      where: {
        eventName: 'search_executed',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    await this.upsertAggregate(date, 'searches', searchCount, 0);

    // Zero-result rate
    if (searchCount > 0) {
      const zeroResults = await this.prisma.analyticsEvent.count({
        where: {
          eventName: 'search_executed',
          createdAt: { gte: dayStart, lt: dayEnd },
          properties: { path: ['has_zero_results'], equals: true },
        },
      });
      const zeroRate = Math.round((zeroResults / searchCount) * 10000); // basis points
      await this.upsertAggregate(date, 'search_zero_result_rate', zeroRate, 0);
    }

    // Click-through rate
    const clickCount = await this.prisma.analyticsEvent.count({
      where: {
        eventName: 'search_result_clicked',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    if (searchCount > 0) {
      const ctr = Math.round((clickCount / searchCount) * 10000);
      await this.upsertAggregate(date, 'search_click_through_rate', ctr, 0);
    }
  }

  // -----------------------------------------------------------------------
  // AI Metrics
  // -----------------------------------------------------------------------

  private async computeAiMetrics(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    // Total AI answers
    const aiCount = await this.prisma.analyticsEvent.count({
      where: {
        eventName: 'ai_answer_requested',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    await this.upsertAggregate(date, 'ai_answers', aiCount, 0);

    // Abstention rate
    if (aiCount > 0) {
      const abstentions = await this.prisma.analyticsEvent.count({
        where: {
          eventName: 'ai_answer_received',
          createdAt: { gte: dayStart, lt: dayEnd },
          properties: { path: ['abstained'], equals: true },
        },
      });
      const abstentionRate = Math.round((abstentions / aiCount) * 10000);
      await this.upsertAggregate(date, 'ai_answer_abstention_rate', abstentionRate, 0);
    }

    // Hallucination reports
    const hallucinations = await this.prisma.analyticsEvent.count({
      where: {
        eventName: 'ai_answer_feedback',
        createdAt: { gte: dayStart, lt: dayEnd },
        properties: { path: ['rating'], equals: 'hallucination_report' },
      },
    });
    await this.upsertAggregate(date, 'ai_answer_hallucination_reports', hallucinations, 0);

    // Helpful rate
    const totalFeedback = await this.prisma.analyticsEvent.count({
      where: {
        eventName: 'ai_answer_feedback',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    if (totalFeedback > 0) {
      const helpfulCount = await this.prisma.analyticsEvent.count({
        where: {
          eventName: 'ai_answer_feedback',
          createdAt: { gte: dayStart, lt: dayEnd },
          properties: { path: ['rating'], equals: 'helpful' },
        },
      });
      const helpfulRate = Math.round((helpfulCount / totalFeedback) * 10000);
      await this.upsertAggregate(date, 'ai_answer_helpful_rate', helpfulRate, 0);
    }
  }

  // -----------------------------------------------------------------------
  // Digest Metrics
  // -----------------------------------------------------------------------

  private async computeDigestMetrics(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const digestsGenerated = await this.prisma.analyticsEvent.count({
      where: {
        eventName: 'digest_generated',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    await this.upsertAggregate(date, 'digests_generated', digestsGenerated, 0);

    const digestsSaved = await this.prisma.analyticsEvent.count({
      where: {
        eventName: 'digest_saved',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    await this.upsertAggregate(date, 'digests_saved', digestsSaved, 0);

    // Review queue depth (current, not daily — but snapshot at aggregation time)
    // CARVE-OUT: global metric (digest_review_queue_depth) counts all orgs by design
    const reviewQueueDepth = await this.prisma.digest.count({
      where: { reviewStatus: 'needs_human_review' },
    });
    await this.upsertAggregate(date, 'digest_review_queue_depth', reviewQueueDepth, 0);
  }

  // -----------------------------------------------------------------------
  // Scan Metrics
  // -----------------------------------------------------------------------

  private async computeScanMetrics(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const scansStarted = await this.prisma.analyticsEvent.count({
      where: { eventName: 'scan_started', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'scans_started', scansStarted, 0);

    const scansCompleted = await this.prisma.analyticsEvent.count({
      where: { eventName: 'scan_saved', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'scans_completed', scansCompleted, 0);

    if (scansStarted > 0) {
      const successRate = Math.round((scansCompleted / scansStarted) * 10000);
      await this.upsertAggregate(date, 'scan_success_rate', successRate, 0);
    }

    // Upgrade prompts from scans
    const upgradePrompts = await this.prisma.analyticsEvent.count({
      where: {
        eventName: 'scan_digest_generated',
        createdAt: { gte: dayStart, lt: dayEnd },
        properties: { path: ['prompted_upgrade'], equals: true },
      },
    });
    await this.upsertAggregate(date, 'scan_upgrade_prompts', upgradePrompts, 0);
  }

  // -----------------------------------------------------------------------
  // Study Metrics
  // -----------------------------------------------------------------------

  private async computeStudyMetrics(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const studySessions = await this.prisma.analyticsEvent.count({
      where: { eventName: 'study_session_completed', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'study_sessions', studySessions, 0);

    const flashcardSessions = await this.prisma.analyticsEvent.count({
      where: { eventName: 'flashcard_session_started', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'flashcard_sessions', flashcardSessions, 0);

    const codalViews = await this.prisma.analyticsEvent.count({
      where: { eventName: 'codal_opened', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'codal_views', codalViews, 0);

    // Flashcard accuracy
    const totalAnswers = await this.prisma.analyticsEvent.count({
      where: { eventName: 'flashcard_answered', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    if (totalAnswers > 0) {
      const correctAnswers = await this.prisma.analyticsEvent.count({
        where: {
          eventName: 'flashcard_answered',
          createdAt: { gte: dayStart, lt: dayEnd },
          properties: { path: ['correct'], equals: true },
        },
      });
      const accuracy = Math.round((correctAnswers / totalAnswers) * 10000);
      await this.upsertAggregate(date, 'flashcard_accuracy', accuracy, 0);
    }
  }

  // -----------------------------------------------------------------------
  // Workspace Metrics
  // -----------------------------------------------------------------------

  private async computeWorkspaceMetrics(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const mattersCreated = await this.prisma.analyticsEvent.count({
      where: { eventName: 'matter_created', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'matters_created', mattersCreated, 0);

    const docsAttached = await this.prisma.analyticsEvent.count({
      where: { eventName: 'matter_document_attached', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'documents_attached', docsAttached, 0);

    const notesCreated = await this.prisma.analyticsEvent.count({
      where: { eventName: 'note_created', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'notes_created', notesCreated, 0);

    const collabActions = await this.prisma.analyticsEvent.count({
      where: { eventName: 'collaboration_action', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'collaboration_actions', collabActions, 0);
  }

  // -----------------------------------------------------------------------
  // Revenue Metrics
  // -----------------------------------------------------------------------

  private async computeRevenueMetrics(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const newSubs = await this.prisma.analyticsEvent.count({
      where: { eventName: 'subscription_started', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'new_subscriptions', newSubs, 0);

    const upgrades = await this.prisma.analyticsEvent.count({
      where: { eventName: 'subscription_upgraded', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'upgrades', upgrades, 0);

    const cancellations = await this.prisma.analyticsEvent.count({
      where: { eventName: 'subscription_cancelled', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'cancellations', cancellations, 0);

    const churns = await this.prisma.analyticsEvent.count({
      where: { eventName: 'subscription_churned', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'churns', churns, 0);

    // Paywall conversion rate
    const paywallHits = await this.prisma.analyticsEvent.count({
      where: { eventName: 'paywall_hit', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    const paywallConverted = await this.prisma.analyticsEvent.count({
      where: { eventName: 'paywall_converted', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    if (paywallHits > 0) {
      const conversionRate = Math.round((paywallConverted / paywallHits) * 10000);
      await this.upsertAggregate(date, 'paywall_conversion_rate', conversionRate, 0);
    }
  }

  // -----------------------------------------------------------------------
  // Ingestion Metrics
  // -----------------------------------------------------------------------

  private async computeIngestionMetrics(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const ingestionEvents = await this.prisma.analyticsEvent.findMany({
      where: {
        eventName: 'ingestion_job_completed',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      select: { properties: true },
    });

    let totalIngested = 0;
    let totalErrors = 0;
    for (const event of ingestionEvents) {
      const props = event.properties as Record<string, unknown>;
      totalIngested += (props['records_created'] as number) || 0;
      totalErrors += (props['error_count'] as number) || 0;
    }

    await this.upsertAggregate(date, 'documents_ingested', totalIngested, 0);
    await this.upsertAggregate(date, 'ingestion_errors', totalErrors, 0);

    const editorialReviews = await this.prisma.analyticsEvent.count({
      where: { eventName: 'editorial_review_completed', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    await this.upsertAggregate(date, 'editorial_reviews', editorialReviews, 0);
  }

  // -----------------------------------------------------------------------
  // Funnel Computation
  // -----------------------------------------------------------------------

  private async computeFunnels(date: Date): Promise<void> {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    // Scan-to-Digest funnel (simplest to compute from events)
    await this.computeScanToDigestFunnel(date, dayStart, dayEnd);

    // Search-to-Answer funnel
    await this.computeSearchToAnswerFunnel(date, dayStart, dayEnd);
  }

  /**
   * Replace one funnel's rows for one date.
   *
   * `analytics_funnel_steps` has no unique key, so the original `create` per
   * step made a second run for the same date append a duplicate set — the
   * funnel chart would silently double. That was survivable while nothing
   * re-ran a date; a catch-up backfill re-runs dates by design, so the writes
   * have to be idempotent. Delete-then-insert scoped to (funnel, date) gives
   * that without a migration, and runs inside a transaction so a crash between
   * the two cannot leave the funnel empty.
   */
  private async replaceFunnelSteps(
    funnelName: string,
    date: Date,
    steps: { stepName: string; stepOrder: number; count: number }[],
  ): Promise<void> {
    const dateOnly = new Date(toUtcDateString(date));

    await this.prisma.$transaction([
      this.prisma.analyticsFunnelStep.deleteMany({ where: { funnelName, date: dateOnly } }),
      this.prisma.analyticsFunnelStep.createMany({
        data: steps.map((step) => ({
          funnelName,
          stepName: step.stepName,
          stepOrder: step.stepOrder,
          date: dateOnly,
          enteredCount: step.count,
          completedCount: step.count,
          droppedCount: 0,
        })),
      }),
    ]);
  }

  private async computeScanToDigestFunnel(date: Date, dayStart: Date, dayEnd: Date): Promise<void> {
    const steps = [
      { name: 'scan_started', event: 'scan_started', order: 1 },
      { name: 'scan_captured', event: 'scan_captured', order: 2 },
      { name: 'scan_ocr_completed', event: 'scan_ocr_completed', order: 3 },
      { name: 'scan_digest_generated', event: 'scan_digest_generated', order: 4 },
      { name: 'scan_saved', event: 'scan_saved', order: 5 },
    ];

    const computed: { stepName: string; stepOrder: number; count: number }[] = [];
    for (const step of steps) {
      const count = await this.prisma.analyticsEvent.count({
        where: { eventName: step.event, createdAt: { gte: dayStart, lt: dayEnd } },
      });
      computed.push({ stepName: step.name, stepOrder: step.order, count });
    }

    await this.replaceFunnelSteps('scan_to_digest', date, computed);
  }

  private async computeSearchToAnswerFunnel(date: Date, dayStart: Date, dayEnd: Date): Promise<void> {
    const steps = [
      { name: 'search_executed', event: 'search_executed', order: 1 },
      { name: 'search_result_clicked', event: 'search_result_clicked', order: 2 },
      { name: 'document_opened', event: 'document_opened', order: 3 },
      { name: 'ai_answer_requested', event: 'ai_answer_requested', order: 4 },
      { name: 'ai_answer_helpful', event: 'ai_answer_feedback', order: 5 },
    ];

    const computed: { stepName: string; stepOrder: number; count: number }[] = [];
    for (const step of steps) {
      const whereClause: Record<string, unknown> = {
        eventName: step.event,
        createdAt: { gte: dayStart, lt: dayEnd },
      };

      // Special filter for the last step — only count 'helpful' feedback
      if (step.name === 'ai_answer_helpful') {
        whereClause['properties'] = { path: ['rating'], equals: 'helpful' };
      }

      const count = await this.prisma.analyticsEvent.count({
        where: whereClause,
      });
      computed.push({ stepName: step.name, stepOrder: step.order, count });
    }

    await this.replaceFunnelSteps('search_to_answer', date, computed);
  }
}

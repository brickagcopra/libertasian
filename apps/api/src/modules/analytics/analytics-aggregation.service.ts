import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

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
 * Daily aggregation cron job.
 * Runs at 02:00 UTC — computes daily metrics and writes to
 * analytics_daily_aggregates. Also pre-creates monthly partitions.
 *
 * Per LIBERTASIAN-ANALYTICS.md:
 * - Never queries raw events in dashboard endpoints
 * - Aggregates are UPSERTED (idempotent — safe to re-run)
 * - Should complete in <5 minutes for up to 1M daily events
 */
@Injectable()
export class AnalyticsAggregationService {
  private readonly logger = new Logger(AnalyticsAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------------
  // Cron entry point — runs at 02:00 UTC daily
  // -----------------------------------------------------------------------

  @Cron('0 2 * * *', { name: 'aggregate_daily_metrics' })
  async aggregateDailyMetrics(): Promise<void> {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);

    const dateStr = yesterday.toISOString().split('T')[0];
    this.logger.log(`Starting daily aggregation for ${dateStr}`);
    const startTime = Date.now();

    try {
      await this.computeEngagementMetrics(yesterday);
      await this.computeSearchMetrics(yesterday);
      await this.computeAiMetrics(yesterday);
      await this.computeDigestMetrics(yesterday);
      await this.computeScanMetrics(yesterday);
      await this.computeStudyMetrics(yesterday);
      await this.computeWorkspaceMetrics(yesterday);
      await this.computeRevenueMetrics(yesterday);
      await this.computeIngestionMetrics(yesterday);
      await this.computeFunnels(yesterday);
      await this.ensurePartitions();

      const durationMs = Date.now() - startTime;
      this.logger.log(`Daily aggregation for ${dateStr} completed in ${durationMs}ms`);
    } catch (err) {
      this.logger.error(`Daily aggregation failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Ensure future partitions exist (runs monthly)
  // -----------------------------------------------------------------------

  @Cron('0 0 25 * *', { name: 'ensure_analytics_partitions' })
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

    // Sessions by device type
    const sessionsByDevice = await this.prisma.analyticsSession.groupBy({
      by: ['deviceType'],
      _count: true,
      where: { startedAt: { gte: dayStart, lt: dayEnd } },
    });
    for (const row of sessionsByDevice) {
      if (row.deviceType) {
        await this.upsertAggregate(date, 'sessions', row._count, 0, `device:${row.deviceType}`);
      }
    }
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

  private async computeScanToDigestFunnel(date: Date, dayStart: Date, dayEnd: Date): Promise<void> {
    const funnelName = 'scan_to_digest';
    const steps = [
      { name: 'scan_started', event: 'scan_started', order: 1 },
      { name: 'scan_captured', event: 'scan_captured', order: 2 },
      { name: 'scan_ocr_completed', event: 'scan_ocr_completed', order: 3 },
      { name: 'scan_digest_generated', event: 'scan_digest_generated', order: 4 },
      { name: 'scan_saved', event: 'scan_saved', order: 5 },
    ];

    for (const step of steps) {
      const count = await this.prisma.analyticsEvent.count({
        where: { eventName: step.event, createdAt: { gte: dayStart, lt: dayEnd } },
      });

      await this.prisma.analyticsFunnelStep.create({
        data: {
          funnelName,
          stepName: step.name,
          stepOrder: step.order,
          date: new Date(date.toISOString().split('T')[0]!),
          enteredCount: count,
          completedCount: count,
          droppedCount: 0,
        },
      });
    }
  }

  private async computeSearchToAnswerFunnel(date: Date, dayStart: Date, dayEnd: Date): Promise<void> {
    const funnelName = 'search_to_answer';
    const steps = [
      { name: 'search_executed', event: 'search_executed', order: 1 },
      { name: 'search_result_clicked', event: 'search_result_clicked', order: 2 },
      { name: 'document_opened', event: 'document_opened', order: 3 },
      { name: 'ai_answer_requested', event: 'ai_answer_requested', order: 4 },
      { name: 'ai_answer_helpful', event: 'ai_answer_feedback', order: 5 },
    ];

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

      await this.prisma.analyticsFunnelStep.create({
        data: {
          funnelName,
          stepName: step.name,
          stepOrder: step.order,
          date: new Date(date.toISOString().split('T')[0]!),
          enteredCount: count,
          completedCount: count,
          droppedCount: 0,
        },
      });
    }
  }
}

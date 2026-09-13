import { Injectable, Logger } from '@nestjs/common';
import { Observable, interval, map, switchMap, from } from 'rxjs';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { DashboardQueryDto } from './dto';

const CACHE_PREFIX = 'cache:analytics:dashboard:';
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * A daily-aggregate row as the dashboard serves it: identical to the Prisma
 * model except `metricValue`, which is narrowed from `bigint` to `number` so
 * the row survives `JSON.stringify`. Mirrors `AnalyticsDailyAggregateRow`
 * in `@libertasian/types`, which the web client already types as `number`.
 */
export interface DailyAggregateRow {
  id: string;
  date: Date;
  metricName: string;
  dimension: string | null;
  metricValue: number;
  uniqueUsers: number;
  organizationId: string | null;
  createdAt: Date;
}

@Injectable()
export class AnalyticsDashboardService {
  private readonly logger = new Logger(AnalyticsDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // -----------------------------------------------------------------------
  // Date range helpers
  // -----------------------------------------------------------------------

  private getDateRange(query: DashboardQueryDto): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  private buildCacheKey(endpoint: string, query: DashboardQueryDto): string {
    const parts = [endpoint, query.from, query.to, query.granularity, query.dimension, query.organizationId];
    return `${CACHE_PREFIX}${parts.filter(Boolean).join(':')}`;
  }

  /**
   * Read-through cache with an explicit bypass.
   *
   * `refresh` skips the READ and repopulates — it does not disable the cache.
   * Without it there was no way to see the result of a backfill for up to five
   * minutes, which on a dashboard whose whole problem was "is this a real zero
   * or a stale one" is the worst possible failure mode: an operator re-runs the
   * aggregation, reloads, still sees zeros, and concludes the backfill failed.
   * `refresh` is deliberately absent from `buildCacheKey`, so a forced refresh
   * warms the same entry every other reader is already using rather than
   * creating a parallel one.
   */
  private async getCachedOrFetch<T>(
    cacheKey: string,
    fetcher: () => Promise<T>,
    refresh = false,
  ): Promise<T> {
    if (!refresh) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    }

    const data = await fetcher();
    await this.redis.set(cacheKey, JSON.stringify(data), CACHE_TTL_SECONDS);
    return data;
  }

  /**
   * The most recent date that has any `analytics_daily_aggregates` row, as
   * `YYYY-MM-DD`, or null when the table is empty.
   *
   * This is the one number that separates "nobody used the product yesterday"
   * from "the aggregation job never ran", and the absence of it is what let a
   * silently skipped cron (2026-09-12, a deploy restart straddling the fire
   * minute) read as a legitimate grid of zeros for a day.
   */
  async getLastAggregatedAt(): Promise<string | null> {
    const latest = await this.prisma.analyticsDailyAggregate.aggregate({
      _max: { date: true },
    });
    const date = latest._max.date;
    return date ? date.toISOString().split('T')[0]! : null;
  }

  // -----------------------------------------------------------------------
  // Query aggregates helper
  // -----------------------------------------------------------------------

  /**
   * Read daily aggregates and return them as plain, JSON-safe objects.
   *
   * `AnalyticsDailyAggregate.metricValue` is a Prisma `BigInt`, and
   * `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt`
   * on it. Every dashboard endpoint and the Redis cache write in
   * `getCachedOrFetch` stringify whatever this helper returns, so the
   * conversion belongs here — once, at the single point where BigInt enters
   * the service — rather than at each of the ten call sites.
   *
   * Deliberately NOT solved by patching `BigInt.prototype.toJSON`: that
   * mutates a prototype shared with every other module in the process,
   * coerces silently, and would hide the next field that hits this.
   *
   * Metric values are counts and rates that fit comfortably in a double;
   * `Number()` is lossless below 2^53.
   */
  private async queryAggregates(
    metricNames: string[],
    dateRange: { from: Date; to: Date },
    organizationId?: string,
  ): Promise<DailyAggregateRow[]> {
    const rows = await this.prisma.analyticsDailyAggregate.findMany({
      where: {
        metricName: { in: metricNames },
        date: { gte: dateRange.from, lte: dateRange.to },
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: { date: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      date: row.date,
      metricName: row.metricName,
      dimension: row.dimension,
      metricValue: Number(row.metricValue),
      uniqueUsers: row.uniqueUsers,
      organizationId: row.organizationId,
      createdAt: row.createdAt,
    }));
  }

  // -----------------------------------------------------------------------
  // Dashboard endpoints
  // -----------------------------------------------------------------------

  async getOverview(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('overview', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          ['dau', 'wau', 'mau', 'ai_answers', 'searches', 'new_subscriptions'],
          range,
          query.organizationId,
        );
        // Deliberately NOT scoped to the selected range or organization: it
        // answers "when did the pipeline last run", which is a property of the
        // pipeline, not of the window being looked at.
        const lastAggregatedAt = await this.getLastAggregatedAt();
        return { metrics, dateRange: range, lastAggregatedAt };
      },
      query.refresh,
    );
  }

  /**
   * Where users go: `surface_views` per surface, plus the platform split for
   * DAU and sessions.
   *
   * Returns the dimensioned rows as-is — the client picks them apart with
   * `selectMetricRowsByDimension`. `selectMetricRows` is left alone on purpose:
   * it returns undimensioned rows only so the KPI cards cannot double-count,
   * and relaxing it to serve this panel would reintroduce that bug everywhere
   * else.
   */
  async getSurfaceMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('surfaces', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          ['surface_views', 'dau', 'sessions'],
          range,
          query.organizationId,
        );
        const lastAggregatedAt = await this.getLastAggregatedAt();
        return { metrics, dateRange: range, lastAggregatedAt };
      },
      query.refresh,
    );
  }

  async getEngagement(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('engagement', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          ['dau', 'wau', 'mau', 'sessions', 'avg_session_duration_seconds', 'avg_events_per_session'],
          range,
          query.organizationId,
        );
        return { metrics, dateRange: range };
      },
      query.refresh,
    );
  }

  async getSearchMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('search', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          [
            'searches', 'search_zero_result_rate', 'search_click_through_rate',
            'search_mean_position_clicked', 'ai_answers', 'ai_answer_avg_response_time_ms',
            'ai_answer_abstention_rate', 'ai_answer_helpful_rate', 'ai_answer_hallucination_reports',
          ],
          range,
          query.organizationId,
        );
        return { metrics, dateRange: range };
      },
      query.refresh,
    );
  }

  async getAiMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('ai', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          [
            'ai_answers', 'ai_answer_avg_response_time_ms', 'ai_answer_abstention_rate',
            'ai_answer_helpful_rate', 'ai_answer_hallucination_reports',
          ],
          range,
          query.organizationId,
        );
        return { metrics, dateRange: range };
      },
      query.refresh,
    );
  }

  async getDigestMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('digests', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          ['digests_generated', 'digests_saved', 'digest_avg_confidence', 'digest_review_queue_depth'],
          range,
          query.organizationId,
        );
        return { metrics, dateRange: range };
      },
      query.refresh,
    );
  }

  async getScanMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('scans', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          [
            'scans_started', 'scans_completed', 'scan_success_rate', 'scan_avg_quality',
            'scan_upgrade_prompts', 'scan_upgrade_conversions',
          ],
          range,
          query.organizationId,
        );
        return { metrics, dateRange: range };
      },
      query.refresh,
    );
  }

  async getStudyMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('study', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          [
            'study_sessions', 'flashcard_sessions', 'flashcard_accuracy',
            'codal_views', 'offline_usage',
          ],
          range,
          query.organizationId,
        );
        return { metrics, dateRange: range };
      },
      query.refresh,
    );
  }

  async getWorkspaceMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('workspace', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          ['matters_created', 'documents_attached', 'notes_created', 'collaboration_actions'],
          range,
          query.organizationId,
        );
        return { metrics, dateRange: range };
      },
      query.refresh,
    );
  }

  async getRevenueMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('revenue', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          [
            'new_subscriptions', 'upgrades', 'cancellations', 'churns',
            'paywall_conversion_rate',
          ],
          range,
          query.organizationId,
        );
        return { metrics, dateRange: range };
      },
      query.refresh,
    );
  }

  async getFunnel(funnelName: string, query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey(`funnel:${funnelName}`, query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const steps = await this.prisma.analyticsFunnelStep.findMany({
          where: {
            funnelName,
            date: { gte: range.from, lte: range.to },
          },
          orderBy: [{ date: 'asc' }, { stepOrder: 'asc' }],
        });
        return { funnelName, steps, dateRange: range };
      },
      query.refresh,
    );
  }

  async getRetention(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('retention', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const cohorts = await this.prisma.analyticsRetentionCohort.findMany({
          where: {
            cohortWeek: { gte: range.from, lte: range.to },
          },
          orderBy: [{ cohortWeek: 'asc' }, { retentionWeek: 'asc' }],
        });
        return { cohorts, dateRange: range };
      },
      query.refresh,
    );
  }

  async getIngestionMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('ingestion', query);
    return this.getCachedOrFetch(
      cacheKey,
      async () => {
        const range = this.getDateRange(query);
        const metrics = await this.queryAggregates(
          ['documents_ingested', 'ingestion_errors', 'editorial_reviews', 'avg_review_time_ms'],
          range,
          query.organizationId,
        );
        return { metrics, dateRange: range };
      },
      query.refresh,
    );
  }

  // -----------------------------------------------------------------------
  // Real-time SSE stream
  // -----------------------------------------------------------------------

  getRealtimeStream(): Observable<MessageEvent> {
    return interval(10_000).pipe(
      switchMap(() =>
        from(this.getRealtimeSnapshot()),
      ),
      map((snapshot) => ({
        data: JSON.stringify(snapshot),
      } as MessageEvent)),
    );
  }

  private async getRealtimeSnapshot() {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Count active sessions in Redis
    const client = this.redis.getClient();
    const sessionKeys = await client.keys('nest:analytics:session:*');
    const activeSessionCount = sessionKeys.length;

    // Recent events count from DB (last 5 minutes)
    const recentEventCount = await this.prisma.analyticsEvent.count({
      where: { createdAt: { gte: fiveMinAgo } },
    });

    // Recent events by category
    const recentEvents = await this.prisma.analyticsEvent.findMany({
      where: { createdAt: { gte: fiveMinAgo } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        eventName: true,
        eventCategory: true,
        deviceType: true,
        createdAt: true,
        // Anonymize user ID — show prefix only
        userId: true,
      },
    });

    // Anonymize user IDs
    const anonymizedEvents = recentEvents.map((e) => ({
      ...e,
      userId: e.userId ? `usr_${e.userId.slice(0, 4)}...` : null,
    }));

    return {
      activeSessionCount,
      recentEventCount,
      eventsPerMinute: Math.round(recentEventCount / 5),
      recentEvents: anonymizedEvents,
      timestamp: new Date().toISOString(),
    };
  }
}

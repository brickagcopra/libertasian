import { Injectable, Logger } from '@nestjs/common';
import { Observable, interval, map, switchMap, from } from 'rxjs';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { DashboardQueryDto } from './dto';

const CACHE_PREFIX = 'cache:analytics:dashboard:';
const CACHE_TTL_SECONDS = 300; // 5 minutes

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

  private async getCachedOrFetch<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as T;
    }

    const data = await fetcher();
    await this.redis.set(cacheKey, JSON.stringify(data), CACHE_TTL_SECONDS);
    return data;
  }

  // -----------------------------------------------------------------------
  // Query aggregates helper
  // -----------------------------------------------------------------------

  private async queryAggregates(
    metricNames: string[],
    dateRange: { from: Date; to: Date },
    organizationId?: string,
  ) {
    return this.prisma.analyticsDailyAggregate.findMany({
      where: {
        metricName: { in: metricNames },
        date: { gte: dateRange.from, lte: dateRange.to },
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: { date: 'asc' },
    });
  }

  // -----------------------------------------------------------------------
  // Dashboard endpoints
  // -----------------------------------------------------------------------

  async getOverview(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('overview', query);
    return this.getCachedOrFetch(cacheKey, async () => {
      const range = this.getDateRange(query);
      const metrics = await this.queryAggregates(
        ['dau', 'wau', 'mau', 'ai_answers', 'searches', 'new_subscriptions'],
        range,
        query.organizationId,
      );
      return { metrics, dateRange: range };
    });
  }

  async getEngagement(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('engagement', query);
    return this.getCachedOrFetch(cacheKey, async () => {
      const range = this.getDateRange(query);
      const metrics = await this.queryAggregates(
        ['dau', 'wau', 'mau', 'sessions', 'avg_session_duration_seconds', 'avg_events_per_session'],
        range,
        query.organizationId,
      );
      return { metrics, dateRange: range };
    });
  }

  async getSearchMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('search', query);
    return this.getCachedOrFetch(cacheKey, async () => {
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
    });
  }

  async getAiMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('ai', query);
    return this.getCachedOrFetch(cacheKey, async () => {
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
    });
  }

  async getDigestMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('digests', query);
    return this.getCachedOrFetch(cacheKey, async () => {
      const range = this.getDateRange(query);
      const metrics = await this.queryAggregates(
        ['digests_generated', 'digests_saved', 'digest_avg_confidence', 'digest_review_queue_depth'],
        range,
        query.organizationId,
      );
      return { metrics, dateRange: range };
    });
  }

  async getScanMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('scans', query);
    return this.getCachedOrFetch(cacheKey, async () => {
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
    });
  }

  async getStudyMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('study', query);
    return this.getCachedOrFetch(cacheKey, async () => {
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
    });
  }

  async getWorkspaceMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('workspace', query);
    return this.getCachedOrFetch(cacheKey, async () => {
      const range = this.getDateRange(query);
      const metrics = await this.queryAggregates(
        ['matters_created', 'documents_attached', 'notes_created', 'collaboration_actions'],
        range,
        query.organizationId,
      );
      return { metrics, dateRange: range };
    });
  }

  async getRevenueMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('revenue', query);
    return this.getCachedOrFetch(cacheKey, async () => {
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
    });
  }

  async getFunnel(funnelName: string, query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey(`funnel:${funnelName}`, query);
    return this.getCachedOrFetch(cacheKey, async () => {
      const range = this.getDateRange(query);
      const steps = await this.prisma.analyticsFunnelStep.findMany({
        where: {
          funnelName,
          date: { gte: range.from, lte: range.to },
        },
        orderBy: [{ date: 'asc' }, { stepOrder: 'asc' }],
      });
      return { funnelName, steps, dateRange: range };
    });
  }

  async getRetention(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('retention', query);
    return this.getCachedOrFetch(cacheKey, async () => {
      const range = this.getDateRange(query);
      const cohorts = await this.prisma.analyticsRetentionCohort.findMany({
        where: {
          cohortWeek: { gte: range.from, lte: range.to },
        },
        orderBy: [{ cohortWeek: 'asc' }, { retentionWeek: 'asc' }],
      });
      return { cohorts, dateRange: range };
    });
  }

  async getIngestionMetrics(query: DashboardQueryDto) {
    const cacheKey = this.buildCacheKey('ingestion', query);
    return this.getCachedOrFetch(cacheKey, async () => {
      const range = this.getDateRange(query);
      const metrics = await this.queryAggregates(
        ['documents_ingested', 'ingestion_errors', 'editorial_reviews', 'avg_review_time_ms'],
        range,
        query.organizationId,
      );
      return { metrics, dateRange: range };
    });
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

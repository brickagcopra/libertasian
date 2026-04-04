import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Weekly retention cohort computation.
 * Runs every Sunday at 03:00 UTC.
 *
 * Groups users by signup week (cohort), computes return rates
 * for weeks 0 through 12. A "return" = had >= 1 analytics event that week.
 *
 * Results stored in analytics_retention_cohorts table.
 */
@Injectable()
export class AnalyticsRetentionService {
  private readonly logger = new Logger(AnalyticsRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 3 * * 0', { name: 'compute_retention_cohorts' })
  async computeRetentionCohorts(): Promise<void> {
    this.logger.log('Starting weekly retention cohort computation');
    const startTime = Date.now();

    try {
      // Compute for all plan segments + overall
      await this.computeForSegment(null); // all users
      await this.computeForSegment('free');
      await this.computeForSegment('edu');
      await this.computeForSegment('pro');
      await this.computeForSegment('team');

      const durationMs = Date.now() - startTime;
      this.logger.log(`Retention cohort computation completed in ${durationMs}ms`);
    } catch (err) {
      this.logger.error(`Retention computation failed: ${(err as Error).message}`);
      throw err;
    }
  }

  private async computeForSegment(planSegment: string | null): Promise<void> {
    // Use raw SQL for efficient cohort computation
    // This query groups users by signup week, then for each cohort
    // checks which users had at least 1 event in subsequent weeks.
    await this.prisma.$executeRaw`
      INSERT INTO analytics_retention_cohorts
        (id, cohort_week, retention_week, user_count, returning_count, retention_rate, plan_segment, created_at)
      SELECT
        gen_random_uuid(),
        cohort_week,
        retention_week,
        cohort_size,
        returning_users,
        CASE WHEN cohort_size > 0
          THEN returning_users::real / cohort_size::real
          ELSE 0
        END,
        ${planSegment},
        NOW()
      FROM (
        SELECT
          date_trunc('week', u."created_at")::date AS cohort_week,
          w.retention_week,
          COUNT(DISTINCT u.id) AS cohort_size,
          COUNT(DISTINCT CASE
            WHEN e.id IS NOT NULL THEN u.id
          END) AS returning_users
        FROM "users" u
        CROSS JOIN generate_series(0, 12) AS w(retention_week)
        LEFT JOIN analytics_events e
          ON e.user_id = u.id::text
          AND e.created_at >= date_trunc('week', u."created_at") + (w.retention_week * interval '7 days')
          AND e.created_at < date_trunc('week', u."created_at") + ((w.retention_week + 1) * interval '7 days')
        WHERE u."created_at" >= NOW() - interval '13 weeks'
          AND (${planSegment} IS NULL OR EXISTS (
            SELECT 1 FROM organization_members om
            JOIN subscriptions s ON s.organization_id = om.organization_id
            WHERE om.user_id = u.id
              AND s.status = 'active'
              AND s.plan_code = ${planSegment ?? ''}
          ))
        GROUP BY cohort_week, w.retention_week
        HAVING COUNT(DISTINCT u.id) > 0
      ) cohort_data
      ON CONFLICT (cohort_week, retention_week, plan_segment)
      DO UPDATE SET
        user_count = EXCLUDED.user_count,
        returning_count = EXCLUDED.returning_count,
        retention_rate = EXCLUDED.retention_rate,
        created_at = NOW()
    `;
  }
}

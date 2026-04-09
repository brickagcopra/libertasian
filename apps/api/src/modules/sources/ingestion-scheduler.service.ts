import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AiSettingsService } from '../ai-settings/ai-settings.service';

interface ScheduleEntry {
  sourceKey: string;
  cron: string;
  enabled: boolean;
}

interface IngestionScheduleValue {
  enabled: boolean;
  schedules: ScheduleEntry[];
}

/**
 * Checks admin-configured ingestion schedules every minute and creates
 * pending ingestion jobs when a cron match occurs.
 *
 * The existing Celery Beat poller picks up pending jobs within 60 seconds.
 */
@Injectable()
export class IngestionSchedulerService {
  private readonly logger = new Logger(IngestionSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly aiSettings: AiSettingsService,
  ) {}

  /**
   * Runs every minute to check if any ingestion source is scheduled to run now.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkSchedules(): Promise<void> {
    try {
      const setting = await this.aiSettings.getSetting('ingestion_schedule');
      if (!setting.value) return;

      const config = setting.value as IngestionScheduleValue;
      if (!config.enabled) return;

      // Check LLM budget — ingestion triggers digest generation which uses the API
      const budgetExceeded = await this.isBudgetExceeded();
      if (budgetExceeded) {
        this.logger.warn('Skipping scheduled ingestion: LLM budget exceeded');
        return;
      }

      const now = new Date();
      for (const schedule of config.schedules) {
        if (!schedule.enabled) continue;

        if (this.cronMatchesNow(schedule.cron, now)) {
          await this.createJobIfNotExists(schedule.sourceKey);
        }
      }
    } catch (err) {
      this.logger.error('Error in ingestion scheduler', err);
    }
  }

  /**
   * Check if the current minute matches a cron expression.
   * Supports standard 5-field cron: minute hour day-of-month month day-of-week.
   */
  private cronMatchesNow(cron: string, now: Date): boolean {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const minute = now.getMinutes();
    const hour = now.getHours();
    const dayOfMonth = now.getDate();
    const month = now.getMonth() + 1;
    const dayOfWeek = now.getDay(); // 0 = Sunday

    const [m, h, dom, mon, dow] = parts as [string, string, string, string, string];
    return (
      this.fieldMatches(m, minute, 0, 59) &&
      this.fieldMatches(h, hour, 0, 23) &&
      this.fieldMatches(dom, dayOfMonth, 1, 31) &&
      this.fieldMatches(mon, month, 1, 12) &&
      this.fieldMatches(dow, dayOfWeek, 0, 6)
    );
  }

  /** Check if a single cron field matches a value. */
  private fieldMatches(field: string, value: number, min: number, max: number): boolean {
    if (field === '*') return true;

    // Handle */n (step)
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10);
      return step > 0 && value % step === 0;
    }

    // Handle comma-separated values
    const values = field.split(',');
    for (const v of values) {
      // Handle range (e.g., 1-5)
      if (v.includes('-')) {
        const rangeParts = v.split('-').map(Number);
        const start = rangeParts[0] ?? 0;
        const end = rangeParts[1] ?? 0;
        if (value >= start && value <= end) return true;
      } else {
        if (parseInt(v, 10) === value) return true;
      }
    }

    return false;
  }

  /** Create a pending ingestion job for a source if one doesn't already exist. */
  private async createJobIfNotExists(sourceKey: string): Promise<void> {
    // Find the source by domain/name pattern
    const source = await this.prisma.source.findFirst({
      where: {
        OR: [
          { domain: { contains: sourceKey.replace(/_/g, '.') } },
          { name: { contains: sourceKey.replace(/_/g, ' '), mode: 'insensitive' } },
        ],
        enabled: true,
      },
    });

    if (!source) {
      this.logger.warn(`Scheduled source not found: ${sourceKey}`);
      return;
    }

    // Check for existing pending or running jobs (prevent duplicates)
    const existingJob = await this.prisma.ingestionJob.findFirst({
      where: {
        sourceId: source.id,
        status: { in: ['pending', 'running'] },
      },
    });

    if (existingJob) {
      this.logger.debug(
        `Skipping scheduled ingestion for ${sourceKey}: existing ${existingJob.status} job ${existingJob.id}`,
      );
      return;
    }

    await this.prisma.ingestionJob.create({
      data: {
        sourceId: source.id,
        jobType: 'fetch',
        status: 'pending',
        triggerType: 'scheduled',
        startedAt: new Date(),
      },
    });

    this.logger.log(`Created scheduled ingestion job for source: ${source.name}`);
  }

  /** Check if the LLM budget is exceeded by reading Redis. */
  private async isBudgetExceeded(): Promise<boolean> {
    try {
      const budgetRaw = await this.redis.get('llm:config:monthly_budget_usd');
      if (!budgetRaw) return false;

      const budget = parseFloat(budgetRaw);
      if (budget <= 0) return false;

      const now = new Date();
      const monthKey = `llm:usage:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const client = this.redis.getClient();
      const costRaw = await client.hget(monthKey, 'estimated_cost_usd');
      const cost = costRaw ? parseFloat(costRaw) : 0;

      return cost >= budget;
    } catch {
      return false;
    }
  }
}

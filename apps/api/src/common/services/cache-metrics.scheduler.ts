import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { RedisService } from './redis.service';

@Injectable()
export class CacheMetricsScheduler {
  private readonly logger = new Logger(CacheMetricsScheduler.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Log Redis cache hit/miss metrics every 5 minutes and reset counters.
   * Runs only when there have been cache operations in the interval.
   */
  @Cron('*/5 * * * *')
  handleLogCacheMetrics() {
    try {
      this.redis.logAndResetMetrics();
    } catch (error) {
      this.logger.error('Failed to log cache metrics', error);
    }
  }
}

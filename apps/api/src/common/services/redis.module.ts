import { Global, Module } from '@nestjs/common';

import { CacheMetricsScheduler } from './cache-metrics.scheduler';
import { CeleryDispatcherService } from './celery-dispatcher.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, CacheMetricsScheduler, CeleryDispatcherService],
  exports: [RedisService, CeleryDispatcherService],
})
export class RedisModule {}

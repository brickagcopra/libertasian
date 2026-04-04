import { Global, Module } from '@nestjs/common';

import { CacheMetricsScheduler } from './cache-metrics.scheduler';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, CacheMetricsScheduler],
  exports: [RedisService],
})
export class RedisModule {}

import { Test, TestingModule } from '@nestjs/testing';

import { CacheMetricsScheduler } from './cache-metrics.scheduler';
import { RedisService } from './redis.service';

describe('CacheMetricsScheduler', () => {
  let scheduler: CacheMetricsScheduler;
  let redis: Record<string, jest.Mock>;

  beforeEach(async () => {
    redis = {
      logAndResetMetrics: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheMetricsScheduler,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    scheduler = module.get<CacheMetricsScheduler>(CacheMetricsScheduler);
  });

  afterEach(() => jest.clearAllMocks());

  it('should call logAndResetMetrics on the redis service', () => {
    scheduler.handleLogCacheMetrics();
    expect(redis.logAndResetMetrics).toHaveBeenCalledTimes(1);
  });

  it('should handle errors gracefully without throwing', () => {
    redis.logAndResetMetrics.mockImplementation(() => {
      throw new Error('Redis error');
    });
    // Should not throw
    expect(() => scheduler.handleLogCacheMetrics()).not.toThrow();
    expect(redis.logAndResetMetrics).toHaveBeenCalledTimes(1);
  });

  it('should be callable multiple times', () => {
    scheduler.handleLogCacheMetrics();
    scheduler.handleLogCacheMetrics();
    scheduler.handleLogCacheMetrics();
    expect(redis.logAndResetMetrics).toHaveBeenCalledTimes(3);
  });
});

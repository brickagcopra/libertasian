import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
  totalOps: number;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis(this.config.get<string>('REDIS_URL', 'redis://localhost:6379/0'), {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        return Math.min(times * 200, 5000);
      },
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log('Redis connected');
    } catch (error) {
      this.logger.error('Redis connection failed', (error as Error).message);
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.log('Redis disconnected');
  }

  /** Get the underlying ioredis client (for ThrottlerStorageRedisService etc.) */
  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    const value = await this.client.get(key);
    if (value !== null) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
    return value;
  }

  /**
   * Get with explicit cache tracking metadata.
   * Returns { value, hit } so callers can act on hit/miss status.
   */
  async getWithStats(key: string): Promise<{ value: string | null; hit: boolean }> {
    const value = await this.client.get(key);
    const hit = value !== null;
    if (hit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
    return { value, hit };
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    return this.client.expire(key, ttlSeconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  /** Returns current cache hit/miss metrics and resets counters. */
  getMetrics(): CacheMetrics {
    const totalOps = this.cacheHits + this.cacheMisses;
    const metrics: CacheMetrics = {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: totalOps > 0 ? this.cacheHits / totalOps : 0,
      totalOps,
    };
    return metrics;
  }

  /** Resets cache hit/miss counters. */
  resetMetrics(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /** Logs current cache metrics at info level and resets counters. */
  logAndResetMetrics(): void {
    const metrics = this.getMetrics();
    if (metrics.totalOps > 0) {
      this.logger.log(
        `Cache stats: ${metrics.hits} hits, ${metrics.misses} misses, ` +
        `${(metrics.hitRate * 100).toFixed(1)}% hit rate (${metrics.totalOps} ops)`,
      );
    }
    this.resetMetrics();
  }
}

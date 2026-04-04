import { ConfigService } from '@nestjs/config';

import { RedisService } from './redis.service';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue('OK'),
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(300),
    exists: jest.fn().mockResolvedValue(1),
  }));
});

describe('RedisService', () => {
  let service: RedisService;
  let mockConfig: ConfigService;

  beforeEach(() => {
    mockConfig = {
      get: jest.fn().mockReturnValue('redis://localhost:6379/0'),
    } as unknown as ConfigService;
    service = new RedisService(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('cache metrics', () => {
    it('should track cache hits on get()', async () => {
      const client = service.getClient();
      (client.get as jest.Mock).mockResolvedValue('cached-value');

      await service.get('test-key');

      const metrics = service.getMetrics();
      expect(metrics.hits).toBe(1);
      expect(metrics.misses).toBe(0);
    });

    it('should track cache misses on get()', async () => {
      const client = service.getClient();
      (client.get as jest.Mock).mockResolvedValue(null);

      await service.get('missing-key');

      const metrics = service.getMetrics();
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(1);
    });

    it('should track hits and misses across multiple get() calls', async () => {
      const client = service.getClient();
      (client.get as jest.Mock)
        .mockResolvedValueOnce('value1')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('value2')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('value3');

      await service.get('key1'); // hit
      await service.get('key2'); // miss
      await service.get('key3'); // hit
      await service.get('key4'); // miss
      await service.get('key5'); // hit

      const metrics = service.getMetrics();
      expect(metrics.hits).toBe(3);
      expect(metrics.misses).toBe(2);
      expect(metrics.totalOps).toBe(5);
      expect(metrics.hitRate).toBeCloseTo(0.6);
    });

    it('should return 0 hit rate when no ops', () => {
      const metrics = service.getMetrics();
      expect(metrics.hitRate).toBe(0);
      expect(metrics.totalOps).toBe(0);
    });

    it('should reset metrics', async () => {
      const client = service.getClient();
      (client.get as jest.Mock).mockResolvedValue('value');

      await service.get('key');
      expect(service.getMetrics().hits).toBe(1);

      service.resetMetrics();
      const metrics = service.getMetrics();
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(0);
      expect(metrics.totalOps).toBe(0);
    });
  });

  describe('getWithStats', () => {
    it('should return hit=true when value exists', async () => {
      const client = service.getClient();
      (client.get as jest.Mock).mockResolvedValue('cached');

      const result = await service.getWithStats('key');

      expect(result).toEqual({ value: 'cached', hit: true });
      expect(service.getMetrics().hits).toBe(1);
    });

    it('should return hit=false when value is null', async () => {
      const client = service.getClient();
      (client.get as jest.Mock).mockResolvedValue(null);

      const result = await service.getWithStats('missing');

      expect(result).toEqual({ value: null, hit: false });
      expect(service.getMetrics().misses).toBe(1);
    });
  });

  describe('logAndResetMetrics', () => {
    it('should log metrics and reset counters', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
      const client = service.getClient();
      (client.get as jest.Mock).mockResolvedValue('value');

      await service.get('key1');
      await service.get('key2');

      service.logAndResetMetrics();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('2 hits'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('100.0% hit rate'),
      );

      // Verify reset
      const metrics = service.getMetrics();
      expect(metrics.totalOps).toBe(0);
    });

    it('should not log when no operations occurred', () => {
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

      service.logAndResetMetrics();

      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('basic operations', () => {
    it('should set with TTL', async () => {
      const client = service.getClient();
      await service.set('key', 'value', 300);
      expect(client.set).toHaveBeenCalledWith('key', 'value', 'EX', 300);
    });

    it('should set without TTL', async () => {
      const client = service.getClient();
      await service.set('key', 'value');
      expect(client.set).toHaveBeenCalledWith('key', 'value');
    });

    it('should delete key', async () => {
      const client = service.getClient();
      const result = await service.del('key');
      expect(client.del).toHaveBeenCalledWith('key');
      expect(result).toBe(1);
    });

    it('should increment key', async () => {
      const client = service.getClient();
      const result = await service.incr('counter');
      expect(client.incr).toHaveBeenCalledWith('counter');
      expect(result).toBe(1);
    });

    it('should check key existence', async () => {
      const client = service.getClient();
      const result = await service.exists('key');
      expect(client.exists).toHaveBeenCalledWith('key');
      expect(result).toBe(1);
    });

    it('should get TTL', async () => {
      const client = service.getClient();
      const result = await service.ttl('key');
      expect(client.ttl).toHaveBeenCalledWith('key');
      expect(result).toBe(300);
    });

    it('should set expiry', async () => {
      const client = service.getClient();
      const result = await service.expire('key', 600);
      expect(client.expire).toHaveBeenCalledWith('key', 600);
      expect(result).toBe(1);
    });
  });
});

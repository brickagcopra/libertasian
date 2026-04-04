import { Logger } from '@nestjs/common';

import {
  handlePrismaQueryEvent,
  logRequestQuerySummary,
  queryProfilerStorage,
} from './query-profiler';
import type { RequestQueryStats } from './query-profiler';

describe('QueryProfiler', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  const createEvent = (duration: number, query = 'SELECT * FROM users') => ({
    query,
    params: '[]',
    duration,
    target: 'postgresql',
  });

  const createStats = (route = 'GET /api/v1/documents'): RequestQueryStats => ({
    queryCount: 0,
    totalDuration: 0,
    slowQueries: 0,
    route,
  });

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handlePrismaQueryEvent', () => {
    it('should not log for fast queries (<100ms)', () => {
      handlePrismaQueryEvent(createEvent(50));
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should warn for slow queries (>=100ms, <500ms)', () => {
      handlePrismaQueryEvent(createEvent(150));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('SLOW QUERY (150ms)'),
      );
    });

    it('should error for critically slow queries (>=500ms)', () => {
      handlePrismaQueryEvent(createEvent(600));
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL SLOW QUERY (600ms)'),
      );
    });

    it('should truncate long query strings', () => {
      const longQuery = 'SELECT ' + 'a'.repeat(300) + ' FROM table';
      handlePrismaQueryEvent(createEvent(200, longQuery));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('...'),
      );
    });

    it('should track query count in AsyncLocalStorage', (done) => {
      const stats = createStats();
      queryProfilerStorage.run(stats, () => {
        handlePrismaQueryEvent(createEvent(10));
        handlePrismaQueryEvent(createEvent(20));
        handlePrismaQueryEvent(createEvent(30));
        expect(stats.queryCount).toBe(3);
        expect(stats.totalDuration).toBe(60);
        done();
      });
    });

    it('should track slow query count', (done) => {
      const stats = createStats();
      queryProfilerStorage.run(stats, () => {
        handlePrismaQueryEvent(createEvent(10));  // fast
        handlePrismaQueryEvent(createEvent(150)); // slow
        handlePrismaQueryEvent(createEvent(600)); // critical slow
        expect(stats.slowQueries).toBe(2);
        done();
      });
    });

    it('should warn on N+1 detection (>=10 queries)', (done) => {
      const stats = createStats('GET /api/v1/digests');
      queryProfilerStorage.run(stats, () => {
        for (let i = 0; i < 10; i++) {
          handlePrismaQueryEvent(createEvent(5));
        }
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Potential N+1 detected: 10 queries for GET /api/v1/digests'),
        );
        done();
      });
    });

    it('should work without AsyncLocalStorage context', () => {
      // Should not throw when no store is available
      expect(() => handlePrismaQueryEvent(createEvent(10))).not.toThrow();
    });
  });

  describe('logRequestQuerySummary', () => {
    it('should not log when no stats are available', () => {
      logRequestQuerySummary();
      expect(debugSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should not log when no queries were executed', (done) => {
      const stats = createStats();
      queryProfilerStorage.run(stats, () => {
        logRequestQuerySummary();
        expect(debugSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        done();
      });
    });

    it('should log at debug level for normal requests', (done) => {
      const stats = createStats();
      stats.queryCount = 3;
      stats.totalDuration = 45;
      stats.slowQueries = 0;
      queryProfilerStorage.run(stats, () => {
        logRequestQuerySummary();
        expect(debugSpy).toHaveBeenCalledWith(
          expect.stringContaining('3 queries'),
        );
        done();
      });
    });

    it('should log at warn level for requests with slow queries', (done) => {
      const stats = createStats();
      stats.queryCount = 5;
      stats.totalDuration = 300;
      stats.slowQueries = 2;
      queryProfilerStorage.run(stats, () => {
        logRequestQuerySummary();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('5 queries'),
        );
        done();
      });
    });

    it('should log N+1 risk for high query count requests', (done) => {
      const stats = createStats();
      stats.queryCount = 12;
      stats.totalDuration = 180;
      stats.slowQueries = 0;
      queryProfilerStorage.run(stats, () => {
        logRequestQuerySummary();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('N+1 RISK'),
        );
        done();
      });
    });
  });
});

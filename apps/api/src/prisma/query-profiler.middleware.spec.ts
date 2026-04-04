import type { Request, Response } from 'express';

import { QueryProfilerMiddleware } from './query-profiler.middleware';
import { queryProfilerStorage } from './query-profiler';

describe('QueryProfilerMiddleware', () => {
  let middleware: QueryProfilerMiddleware;
  const originalEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    middleware = new QueryProfilerMiddleware();
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
  });

  it('should skip profiling in non-development mode', () => {
    process.env['NODE_ENV'] = 'production';
    const req = { method: 'GET', url: '/api/v1/test' } as Request;
    const res = { on: jest.fn() } as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.on).not.toHaveBeenCalled();
  });

  it('should set up AsyncLocalStorage context in development mode', (done) => {
    process.env['NODE_ENV'] = 'development';
    const req = { method: 'GET', url: '/api/v1/documents' } as Request;
    const finishCallback: (() => void)[] = [];
    const res = {
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishCallback.push(cb);
      }),
    } as unknown as Response;
    const next = jest.fn(() => {
      // Inside next(), the AsyncLocalStorage should have a store
      const stats = queryProfilerStorage.getStore();
      expect(stats).toBeDefined();
      expect(stats?.route).toBe('GET /api/v1/documents');
      expect(stats?.queryCount).toBe(0);
      done();
    });

    middleware.use(req, res, next);
  });

  it('should register a finish handler on the response', (done) => {
    process.env['NODE_ENV'] = 'development';
    const req = { method: 'POST', url: '/api/v1/search' } as Request;
    const res = {
      on: jest.fn(),
    } as unknown as Response;
    const next = jest.fn(() => {
      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
      done();
    });

    middleware.use(req, res, next);
  });

  it('should initialize stats with zero values', (done) => {
    process.env['NODE_ENV'] = 'development';
    const req = { method: 'GET', url: '/api/v1/test' } as Request;
    const res = { on: jest.fn() } as unknown as Response;
    const next = jest.fn(() => {
      const stats = queryProfilerStorage.getStore();
      expect(stats).toEqual({
        queryCount: 0,
        totalDuration: 0,
        slowQueries: 0,
        route: 'GET /api/v1/test',
      });
      done();
    });

    middleware.use(req, res, next);
  });
});

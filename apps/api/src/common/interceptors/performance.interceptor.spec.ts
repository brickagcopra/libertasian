import { ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';

import { PerformanceInterceptor } from './performance.interceptor';

describe('PerformanceInterceptor', () => {
  let interceptor: PerformanceInterceptor;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  const createMockContext = (method = 'GET', url = '/api/v1/documents') => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, url }),
        getResponse: () => ({ statusCode: 200 }),
      }),
      getClass: () => ({ name: 'DocumentsController' }),
      getHandler: () => ({ name: 'findAll' }),
    } as unknown as ExecutionContext;
  };

  const createMockNext = (value: unknown = { data: [] }, delay = 0): CallHandler => ({
    handle: () =>
      delay > 0
        ? new (require('rxjs').Observable)((subscriber: { next: (v: unknown) => void; complete: () => void }) => {
            setTimeout(() => {
              subscriber.next(value);
              subscriber.complete();
            }, delay);
          })
        : of(value),
  });

  const createErrorNext = (): CallHandler => ({
    handle: () => throwError(() => new Error('test error')),
  });

  beforeEach(() => {
    interceptor = new PerformanceInterceptor();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log request with method, url, status, duration, and handler info', (done) => {
    const context = createMockContext('GET', '/api/v1/documents');
    const next = createMockNext();

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('GET /api/v1/documents 200'),
        );
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('[DocumentsController.findAll]'),
        );
        done();
      },
    });
  });

  it('should include response time in ms', (done) => {
    const context = createMockContext();
    const next = createMockNext();

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringMatching(/\d+ms/),
        );
        done();
      },
    });
  });

  it('should log at normal level for fast requests', (done) => {
    const context = createMockContext();
    const next = createMockNext();

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(logSpy).toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('should warn for slow requests (>=500ms)', (done) => {
    const context = createMockContext();
    const next = createMockNext({ data: [] }, 550);

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('SLOW:'),
        );
        done();
      },
    });
  }, 10000);

  it('should error for critically slow requests (>=2000ms)', (done) => {
    const context = createMockContext();
    const next = createMockNext({ data: [] }, 2100);

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('CRITICAL SLOW:'),
        );
        done();
      },
    });
  }, 10000);

  it('should log on error responses', (done) => {
    const context = createMockContext('POST', '/api/v1/auth/login');
    const next = createErrorNext();

    interceptor.intercept(context, next).subscribe({
      error: () => {
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('POST /api/v1/auth/login'),
        );
        done();
      },
    });
  });

  it('should handle different HTTP methods', (done) => {
    const context = createMockContext('POST', '/api/v1/digests');
    const next = createMockNext();

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('POST /api/v1/digests'),
        );
        done();
      },
    });
  });
});

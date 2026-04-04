import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

import { queryProfilerStorage, logRequestQuerySummary } from './query-profiler';
import type { RequestQueryStats } from './query-profiler';

/**
 * Middleware that wraps each HTTP request in an AsyncLocalStorage context
 * to enable per-request query counting and N+1 detection.
 *
 * Only active in development mode.
 */
@Injectable()
export class QueryProfilerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (process.env['NODE_ENV'] !== 'development') {
      next();
      return;
    }

    const stats: RequestQueryStats = {
      queryCount: 0,
      totalDuration: 0,
      slowQueries: 0,
      route: `${req.method} ${req.url}`,
    };

    queryProfilerStorage.run(stats, () => {
      res.on('finish', () => {
        logRequestQuerySummary();
      });
      next();
    });
  }
}

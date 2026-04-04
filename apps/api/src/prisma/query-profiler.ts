import { Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

/** Thresholds in milliseconds */
const SLOW_QUERY_WARN_MS = 100;
const SLOW_QUERY_ERROR_MS = 500;
const N_PLUS_ONE_THRESHOLD = 10;

export interface RequestQueryStats {
  queryCount: number;
  totalDuration: number;
  slowQueries: number;
  route: string;
}

/**
 * AsyncLocalStorage to track per-request query statistics.
 * Wrap each HTTP request in `queryProfiler.run(stats, callback)` to enable
 * per-request N+1 detection and query count tracking.
 */
export const queryProfilerStorage = new AsyncLocalStorage<RequestQueryStats>();

const logger = new Logger('QueryProfiler');

/**
 * Creates a Prisma event handler for the 'query' log event.
 * Logs slow queries and tracks per-request query counts via AsyncLocalStorage.
 */
export function handlePrismaQueryEvent(event: { query: string; params: string; duration: number; target: string }): void {
  const { query, duration } = event;

  // Slow query detection
  if (duration >= SLOW_QUERY_ERROR_MS) {
    logger.error(`CRITICAL SLOW QUERY (${duration}ms): ${truncateQuery(query)}`);
  } else if (duration >= SLOW_QUERY_WARN_MS) {
    logger.warn(`SLOW QUERY (${duration}ms): ${truncateQuery(query)}`);
  }

  // Per-request stats tracking
  const stats = queryProfilerStorage.getStore();
  if (stats) {
    stats.queryCount++;
    stats.totalDuration += duration;
    if (duration >= SLOW_QUERY_WARN_MS) {
      stats.slowQueries++;
    }

    // N+1 detection: warn after threshold exceeded (only once per request)
    if (stats.queryCount === N_PLUS_ONE_THRESHOLD) {
      logger.warn(
        `Potential N+1 detected: ${stats.queryCount} queries for ${stats.route} (${stats.totalDuration}ms total)`,
      );
    }
  }
}

/**
 * Logs final per-request query summary. Call at end of request lifecycle.
 */
export function logRequestQuerySummary(): void {
  const stats = queryProfilerStorage.getStore();
  if (!stats || stats.queryCount === 0) return;

  const message = `${stats.route}: ${stats.queryCount} queries, ${stats.totalDuration}ms total, ${stats.slowQueries} slow`;

  if (stats.queryCount >= N_PLUS_ONE_THRESHOLD) {
    logger.warn(`N+1 RISK: ${message}`);
  } else if (stats.slowQueries > 0) {
    logger.warn(message);
  } else {
    logger.debug(message);
  }
}

function truncateQuery(query: string, maxLen = 200): string {
  return query.length > maxLen ? query.slice(0, maxLen) + '...' : query;
}

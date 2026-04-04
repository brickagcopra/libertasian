import { SetMetadata } from '@nestjs/common';

export const TRACK_EVENT_KEY = 'analytics:track_event';

/**
 * Property extractor function type.
 * Receives the request and response objects, returns event properties.
 */
export type PropertyExtractor = (
  req: { body?: Record<string, unknown>; query?: Record<string, unknown>; params?: Record<string, unknown>; user?: Record<string, unknown> },
  res: { data?: unknown },
) => Record<string, unknown>;

export interface TrackEventOptions {
  eventName: string;
  extractProperties?: PropertyExtractor;
}

/**
 * Decorator that auto-tracks an analytics event when a controller method is called.
 *
 * Usage:
 * ```typescript
 * @TrackEvent('search_executed', (req, res) => ({
 *   query_length: req.body.query?.length,
 *   result_count: res.data?.results?.length,
 * }))
 * @Post('search')
 * async search(@Body() dto: SearchDto) { ... }
 * ```
 *
 * The event is tracked AFTER the method completes (via AnalyticsInterceptor),
 * so response data is available for property extraction.
 */
export function TrackEvent(
  eventName: string,
  extractProperties?: PropertyExtractor,
): MethodDecorator {
  return SetMetadata(TRACK_EVENT_KEY, { eventName, extractProperties } satisfies TrackEventOptions);
}

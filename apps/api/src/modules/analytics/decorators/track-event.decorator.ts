import { SetMetadata } from '@nestjs/common';

export const TRACK_EVENT_KEY = 'analytics:track_event';

/**
 * Property extractor function type.
 * Receives the request and response objects, returns event properties.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PropertyExtractor = (
  req: { body?: any; query?: any; params?: any; user?: any },
  res: { data?: any },
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

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';

import { AnalyticsService } from '../analytics.service';
import { TRACK_EVENT_KEY, type TrackEventOptions } from '../decorators/track-event.decorator';

/**
 * NestJS interceptor that handles two responsibilities:
 *
 * 1. Auto-tracks `page_viewed` for all GET requests (with response timing)
 * 2. Processes @TrackEvent() decorator on controller methods
 *
 * Tracking is fire-and-forget — errors are logged but never propagate
 * to the client response.
 */
@Injectable()
export class AnalyticsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AnalyticsInterceptor.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          this.handleTracking(context, request, responseData, startTime).catch((err) => {
            this.logger.debug(`Analytics tracking error: ${(err as Error).message}`);
          });
        },
      }),
    );
  }

  private async handleTracking(
    context: ExecutionContext,
    request: Request,
    responseData: unknown,
    startTime: number,
  ): Promise<void> {
    const durationMs = Date.now() - startTime;
    const user = request.user as { sub?: string; organizationId?: string } | undefined;

    // 1. Check for @TrackEvent() decorator
    const trackEventOptions = this.reflector.get<TrackEventOptions | undefined>(
      TRACK_EVENT_KEY,
      context.getHandler(),
    );

    if (trackEventOptions) {
      const properties = trackEventOptions.extractProperties
        ? trackEventOptions.extractProperties(
            {
              body: request.body as Record<string, unknown>,
              query: request.query as Record<string, unknown>,
              params: request.params as Record<string, unknown>,
              user: user as Record<string, unknown>,
            },
            { data: responseData },
          )
        : {};

      await this.analyticsService.track({
        eventName: trackEventOptions.eventName,
        userId: user?.sub,
        organizationId: user?.organizationId,
        sessionId: (request.headers['x-session-id'] as string) ?? undefined,
        deviceType: this.detectDeviceType(request),
        properties,
        durationMs,
        ipAddress: request.ip ?? request.socket?.remoteAddress,
        userAgent: request.headers['user-agent'],
      });
      return;
    }

    // 2. Auto-track page_viewed for GET requests (non-API asset routes excluded)
    if (request.method === 'GET' && !this.isExcludedPath(request.path)) {
      await this.analyticsService.track({
        eventName: 'page_viewed',
        userId: user?.sub,
        organizationId: user?.organizationId,
        sessionId: (request.headers['x-session-id'] as string) ?? undefined,
        deviceType: this.detectDeviceType(request),
        properties: {
          path: request.path,
          referrer_path: request.headers['referer'] ?? null,
          load_time_ms: durationMs,
        },
        durationMs,
        ipAddress: request.ip ?? request.socket?.remoteAddress,
        userAgent: request.headers['user-agent'],
      });
    }
  }

  private detectDeviceType(request: Request): string {
    // Check explicit header first (set by mobile clients)
    const deviceHeader = request.headers['x-device-type'] as string;
    if (deviceHeader && ['web', 'ios', 'android'].includes(deviceHeader)) {
      return deviceHeader;
    }

    // Fall back to user-agent sniffing
    const ua = request.headers['user-agent'] ?? '';
    if (ua.includes('Expo') || ua.includes('React Native')) {
      return ua.includes('Android') ? 'android' : 'ios';
    }
    return 'web';
  }

  private isExcludedPath(path: string): boolean {
    const excluded = [
      '/health',
      '/api/docs',
      '/favicon.ico',
      '/analytics/', // Don't track analytics endpoints themselves
    ];
    return excluded.some((prefix) => path.startsWith(prefix));
  }
}

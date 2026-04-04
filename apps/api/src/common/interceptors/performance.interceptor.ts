import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** Thresholds in milliseconds */
const SLOW_WARN_MS = 500;
const SLOW_ERROR_MS = 2000;

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Performance');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, url } = request;
    const controller = context.getClass().name;
    const handler = context.getHandler().name;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;
          this.logRequest(method, url, statusCode, duration, controller, handler);
        },
        error: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode >= 400 ? response.statusCode : 500;
          this.logRequest(method, url, statusCode, duration, controller, handler);
        },
      }),
    );
  }

  private logRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    controller: string,
    handler: string,
  ): void {
    const message = `${method} ${url} ${statusCode} ${duration}ms [${controller}.${handler}]`;

    if (duration >= SLOW_ERROR_MS) {
      this.logger.error(`CRITICAL SLOW: ${message}`);
    } else if (duration >= SLOW_WARN_MS) {
      this.logger.warn(`SLOW: ${message}`);
    } else {
      this.logger.log(message);
    }
  }
}

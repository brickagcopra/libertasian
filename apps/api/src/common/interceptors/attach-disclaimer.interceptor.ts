import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { from, mergeMap } from 'rxjs';

import { DERIVATIVE_RESPONSE_KEY } from '../decorators/derivative-response.decorator';
import {
  ContentDisclaimersService,
  type DisclaimerEnvelope,
} from '../../modules/content-disclaimers/content-disclaimers.service';

/**
 * Globally-registered interceptor implementing the §8.6 launch gate:
 * every derivative response leaves the API with a non-null `disclaimer`
 * envelope attached.
 *
 * Derivative detection happens via two signals, in this order:
 *
 * 1. **Metadata (primary)** — the handler is decorated with
 *    `@DerivativeResponse('ai_digest')`. This is the preferred path and
 *    matches existing repo conventions for metadata-driven interceptors
 *    (`@Roles`, `@RequiredPermissions`, `@RequiredSubscription`).
 *
 * 2. **Shape (fallback)** — the response payload has a top-level
 *    `derivativeType` string field. This lets legacy controllers opt in
 *    without a code change: if their JSON shape already matches, the
 *    interceptor resolves the disclaimer from `derivativeType`.
 *
 * Handlers that match neither signal are passed through unchanged —
 * this interceptor must never alter non-derivative responses.
 *
 * **Fail-closed behaviour.** If either signal identifies a derivative
 * but the service cannot resolve a disclaimer row, the interceptor
 * throws 500 and logs a critical alert. Shipping a derivative without a
 * disclaimer is a P0 per §8.6.
 *
 * **Shape handling**:
 * - Plain object: `{ ...response, disclaimer }`
 * - Array: `{ items: response, disclaimer }` — envelope-level attachment,
 *   not per-item, because the disclaimer describes the entire batch.
 * - Nullish: passed through unchanged (404 / no content scenarios).
 */
@Injectable()
export class AttachDisclaimerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AttachDisclaimerInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly disclaimers: ContentDisclaimersService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    // We only care about HTTP handlers. Microservice / RPC responses are
    // ignored — they don't carry user-facing payloads.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const decoratorClass = this.reflector.getAllAndOverride<
      string | undefined
    >(DERIVATIVE_RESPONSE_KEY, [context.getHandler(), context.getClass()]);

    return next.handle().pipe(
      mergeMap((response) =>
        from(this.attachIfNeeded(response, decoratorClass)),
      ),
    );
  }

  /**
   * Resolve the disclaimer and splice it into the response payload.
   * Declared async so we can `await` the service lookup without blocking
   * the rxjs pipeline on a synchronous path.
   */
  private async attachIfNeeded(
    response: unknown,
    decoratorClass: string | undefined,
  ): Promise<unknown> {
    // Null / undefined / primitive responses are never treated as
    // derivatives. Controllers returning `null` from a 404 handler
    // should pass through untouched.
    if (response === null || response === undefined) {
      return response;
    }

    // Primary signal: decorator metadata on the handler.
    if (decoratorClass) {
      return this.splice(response, decoratorClass);
    }

    // Fallback signal: inspect the response body for a top-level
    // `derivativeType` field. We check both plain objects and the first
    // element of an array (consistent-batch shape).
    const shapeClass = this.detectShape(response);
    if (shapeClass) {
      return this.splice(response, shapeClass);
    }

    // Not a derivative response — pass through.
    return response;
  }

  /** Look for a top-level `derivativeType` string field. */
  private detectShape(response: unknown): string | null {
    if (typeof response !== 'object' || response === null) {
      return null;
    }
    const candidate = response as Record<string, unknown>;
    if (typeof candidate['derivativeType'] === 'string') {
      return candidate['derivativeType'];
    }
    // Array-of-derivatives shape (all items share one contentClass).
    if (Array.isArray(response) && response.length > 0) {
      const first = response[0] as unknown;
      if (typeof first === 'object' && first !== null) {
        const firstObj = first as Record<string, unknown>;
        if (typeof firstObj['derivativeType'] === 'string') {
          return firstObj['derivativeType'];
        }
      }
    }
    return null;
  }

  /**
   * Resolve the disclaimer envelope and return a new response with it
   * attached. Arrays become `{ items, disclaimer }`; objects get an
   * inline `disclaimer` field.
   */
  private async splice(
    response: unknown,
    contentClass: string,
  ): Promise<unknown> {
    let envelope: DisclaimerEnvelope;
    try {
      envelope = await this.disclaimers.getEnvelope(contentClass);
    } catch (err) {
      // Fail closed per §8.6 — never ship a derivative without its
      // disclaimer. Log at `error` so the alert pipeline sees it.
      this.logger.error(
        `CRITICAL: derivative response flagged with contentClass="${contentClass}" ` +
          'but no matching content_disclaimer row is loaded. Refusing to ship.',
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Derivative response blocked: missing content disclaimer',
      );
    }

    if (Array.isArray(response)) {
      return { items: response, disclaimer: envelope };
    }

    if (typeof response === 'object' && response !== null) {
      return { ...(response as Record<string, unknown>), disclaimer: envelope };
    }

    // Primitive-valued derivative responses are not a thing we expect —
    // wrap them in an envelope so the disclaimer still travels.
    return { value: response, disclaimer: envelope };
  }
}

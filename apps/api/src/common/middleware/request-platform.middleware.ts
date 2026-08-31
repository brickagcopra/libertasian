import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

import {
  CLIENT_PLATFORM_HEADER,
  parseClientPlatform,
} from '../config/store-availability';
import { runWithRequestContext } from '../context/request-context';

/**
 * Parses the `x-platform` header ONCE per request and runs the remainder of
 * that request inside a `RequestContext`.
 *
 * This exists so that entitlement resolution can be platform-aware without
 * threading a `platform` argument through 15+ call sites of
 * `UsageQuotaService.checkAndIncrement` — several of which sit behind service
 * layers that never see a request object. A missed call site there would
 * produce a silently wrong quota limit with nothing failing, which is precisely
 * the failure this middleware is here to make impossible.
 *
 * Parsing is delegated to `parseClientPlatform` / `CLIENT_PLATFORM_HEADER` from
 * `store-availability.ts` — the same pair `SubscriptionGuard` and
 * `QuotaController` already use. There is exactly one definition of what the
 * header means, and it is not this file.
 *
 * An absent or unrecognised header resolves to `null`, which means NOT
 * ENFORCED. That is what keeps live App Store build 25 — cut before the header
 * existed — ungated no matter what `STORE_PURCHASE_AVAILABLE_IOS` is set to.
 */
@Injectable()
export class RequestPlatformMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // `headers?.` — Express always populates this, but middleware must not
    // throw on an unexpected request shape. A missing bag resolves to `null`,
    // the safe direction.
    const platform = parseClientPlatform(req.headers?.[CLIENT_PLATFORM_HEADER]);

    // `next` is invoked INSIDE `run`, so every downstream guard, interceptor,
    // controller and service — including everything they await — observes this
    // store. Calling `next()` outside would leave the context empty for the
    // entire request.
    runWithRequestContext({ platform }, () => next());
  }
}

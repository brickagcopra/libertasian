import { ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '@libertasian/types';

import type { Request } from 'express';

import { parseClientPlatform } from '../../common/config/store-availability';
import type { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import type { EntitlementService } from '../subscriptions/entitlement.service';

/**
 * The entitlement gate for the past-bar-exam surface.
 *
 * Past bar exams are PAID in the freemium tier, and both controllers that serve
 * them — `BarExamsController` (the sittings and their questions) and
 * `BarExamAnswersPublicController` (the ALAC model answer) — were guarded by
 * authentication alone. The paywall existed only in the mobile client's
 * decision not to render the tab, so any signed-in free account could read the
 * whole surface straight from the API.
 *
 * A plain function rather than a base class or a guard: there are exactly two
 * callsites, they both already inject these two services, and the ordering
 * relative to each handler's own checks differs (see the answers controller).
 * Follows `DocumentsController.resolvePreviewOnly`.
 *
 * 403, NOT 402. `getDefaultEntitlements('free')` explains that 402
 * `subscription_required` is the status App Review reads as a paywall. The free
 * client hides this surface entirely, so the refusal is unreachable by tapping
 * — but if Review ever does reach it, they must not be handed a payment demand.
 * A plain forbidden is the honest answer for a surface the client never offers.
 *
 * Gated in the handler rather than with `SubscriptionGuard`, which carries its
 * own semantics and would change both the status code and the body.
 *
 * The platform is read from `x-platform` and threaded through, so a caller that
 * cannot buy (web, and every mobile build before 26, which sends no header)
 * resolves to `previewOnly === false` and stays unenforced — the same rule as
 * `isPaywallEnforcedForRequest`.
 */
export async function assertBarExamEntitlement(opts: {
  entitlementService: EntitlementService;
  adminBypassAudit: AdminBypassAuditService;
  user: JwtPayload;
  req: Request;
  platformHeader?: string;
}): Promise<void> {
  const { entitlementService, adminBypassAudit, user, req, platformHeader } = opts;

  // Platform admins (any `admin:*` permission) read the full corpus whatever
  // their org's subscription says. Audited — throttled per userId+route — so
  // admin reads of paid content stay traceable.
  if (user.isPlatformAdmin === true) {
    adminBypassAudit.record({
      userId: user.sub,
      organizationId: user.organizationId,
      route: `${req.method} ${req.route?.path ?? req.path}`,
    });
    return;
  }

  const ent = await entitlementService.resolveEffectiveEntitlements(
    user.organizationId,
    parseClientPlatform(platformHeader),
  );
  if (ent.previewOnly === true) {
    throw new ForbiddenException({
      code: 'not_available_on_this_account',
      message: "This isn't available on this account.",
    });
  }
}

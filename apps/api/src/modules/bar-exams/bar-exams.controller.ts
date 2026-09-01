import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import type { Request } from 'express';

import {
  CLIENT_PLATFORM_HEADER,
  parseClientPlatform,
} from '../../common/config/store-availability';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { BarExamsService } from './bar-exams.service';

/**
 * Authenticated read endpoints for past Philippine Bar Examinations.
 *
 * Past bar exams are a PAID surface in the freemium tier. Until now the only
 * thing standing between a free account and the full content was the mobile
 * client choosing not to render the tab — `JwtAuthGuard` alone lets any
 * signed-in caller read every sitting. The gate below is the server-side half
 * of that, and follows `DocumentsController.resolvePreviewOnly` exactly.
 */
@ApiTags('Bar Exams')
@ApiBearerAuth()
@Controller('bar-exams')
@UseGuards(JwtAuthGuard)
export class BarExamsController {
  constructor(
    private readonly service: BarExamsService,
    private readonly entitlementService: EntitlementService,
    private readonly adminBypassAudit: AdminBypassAuditService,
  ) {}

  /**
   * Refuse the read unless the caller's org is entitled to the paid corpora.
   *
   * 403, NOT 402. `getDefaultEntitlements('free')` explains that 402
   * `subscription_required` is the status App Review reads as a paywall; the
   * free client hides this surface entirely, so this refusal is unreachable by
   * tapping — but if Review ever does reach it, they must not be handed a
   * payment demand. A plain forbidden is the honest answer for a surface the
   * client never offers.
   *
   * Gated in the handler rather than with `SubscriptionGuard`, which carries
   * its own semantics and would change both the status code and the body.
   *
   * The platform is read from `x-platform` and threaded through, so a caller
   * that cannot buy (web, and every mobile build before 26, which sends no
   * header) resolves to `previewOnly === false` and stays unenforced — the
   * same rule as `isPaywallEnforcedForRequest`.
   */
  private async assertEntitled(
    user: JwtPayload,
    req: Request,
    platformHeader?: string,
  ): Promise<void> {
    // Platform admins (any `admin:*` permission) read the full corpus whatever
    // their org's subscription says. Audited — throttled per userId+route — so
    // admin reads of paid content stay traceable.
    if (user.isPlatformAdmin === true) {
      this.adminBypassAudit.record({
        userId: user.sub,
        organizationId: user.organizationId,
        route: `${req.method} ${req.route?.path ?? req.path}`,
      });
      return;
    }

    const ent = await this.entitlementService.resolveEffectiveEntitlements(
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

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary:
      'List every available past bar exam sitting, grouped by year DESC.',
  })
  async list(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Headers(CLIENT_PLATFORM_HEADER) platformHeader?: string,
  ) {
    await this.assertEntitled(user, req, platformHeader);
    const data = await this.service.listAll();
    return { success: true, data };
  }

  @Get(':year')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({ summary: 'List subjects sat in a given bar exam year.' })
  async listByYear(
    @Param('year', ParseIntPipe) year: number,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Headers(CLIENT_PLATFORM_HEADER) platformHeader?: string,
  ) {
    await this.assertEntitled(user, req, platformHeader);
    const data = await this.service.listByYear(year);
    return { success: true, data };
  }

  @Get(':year/:subjectCode')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({
    summary:
      'Get a single sitting (header + all questions) for a year/subject. ' +
      'Use ?part=I or ?part=II to disambiguate the 2022 split papers.',
  })
  async getSitting(
    @Param('year', ParseIntPipe) year: number,
    @Param('subjectCode') subjectCode: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Query('part') part?: string,
    @Headers(CLIENT_PLATFORM_HEADER) platformHeader?: string,
  ) {
    await this.assertEntitled(user, req, platformHeader);
    const normalizedPart = normalizeOptionalPart(part);
    const data = await this.service.getSittingByYearAndSubject(
      year,
      subjectCode,
      normalizedPart,
    );
    return { success: true, data };
  }
}

/**
 * Treat unset / empty / "none" as null so the URL surface stays clean for
 * single-paper subjects (legacy 2006-2018) without forcing callers to
 * pass an explicit ``part=`` value. Anything else is passed through; the
 * service rejects unknown parts with 404 via Prisma's exact-match.
 */
function normalizeOptionalPart(part: string | undefined): string | null {
  if (part === undefined || part === '' || part === 'none') return null;
  if (!/^[A-Za-z0-9]+$/.test(part)) {
    throw new NotFoundException(`Unknown bar exam part: ${part}`);
  }
  return part.toUpperCase();
}

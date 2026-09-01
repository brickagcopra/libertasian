import {
  Controller,
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

import { CLIENT_PLATFORM_HEADER } from '../../common/config/store-availability';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { assertBarExamEntitlement } from './bar-exam-entitlement';
import { BarExamsService } from './bar-exams.service';

/**
 * Authenticated read endpoints for past Philippine Bar Examinations.
 *
 * Past bar exams are a PAID surface in the freemium tier. Until now the only
 * thing standing between a free account and the full content was the mobile
 * client choosing not to render the tab — `JwtAuthGuard` alone lets any
 * signed-in caller read every sitting. `assertBarExamEntitlement` is the
 * server-side half of that.
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
   * Shared verbatim with `BarExamAnswersPublicController`, which serves the
   * model answer for the same paid surface — see `bar-exam-entitlement.ts`
   * for the full reasoning.
   */
  private assertEntitled(
    user: JwtPayload,
    req: Request,
    platformHeader?: string,
  ): Promise<void> {
    return assertBarExamEntitlement({
      entitlementService: this.entitlementService,
      adminBypassAudit: this.adminBypassAudit,
      user,
      req,
      platformHeader,
    });
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

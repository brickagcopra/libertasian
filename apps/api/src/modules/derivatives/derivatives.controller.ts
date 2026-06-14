import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { DerivativesService } from './derivatives.service';
import {
  FindOneDerivativeQueryDto,
  ListDerivativesQueryDto,
  SubjectsSummaryByTypeParamDto,
  SubjectsSummaryByTypeQueryDto,
} from './dto';

/**
 * Feature-flag guard. Returns 404 (not 403) when the public derivatives surface
 * is disabled so existence is not leaked while the flag is off.
 */
@Injectable()
export class DerivativesPublicFeatureFlagGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    const enabled = (process.env['FEATURE_DERIVATIVES_PUBLIC'] ?? '').toLowerCase() === 'true';
    if (!enabled) {
      throw new NotFoundException();
    }
    return true;
  }
}

@ApiTags('Derivatives')
@Controller('derivatives')
@UseGuards(DerivativesPublicFeatureFlagGuard, JwtAuthGuard)
@ApiBearerAuth()
export class DerivativesController {
  constructor(
    private readonly service: DerivativesService,
    private readonly entitlementService: EntitlementService,
    private readonly adminBypassAudit: AdminBypassAuditService,
  ) {}

  /**
   * Platform admins (any `admin:*` permission) bypass the previewOnly cap.
   * The bypass is audited (throttled per userId+route) for compliance.
   */
  private async resolvePreviewOnly(
    user: JwtPayload,
    req: Request,
    documentId?: string,
  ): Promise<boolean> {
    if (user.isPlatformAdmin === true) {
      this.adminBypassAudit.record({
        userId: user.sub,
        organizationId: user.organizationId,
        route: `${req.method} ${req.route?.path ?? req.path}`,
        documentId,
      });
      return false;
    }
    const ent = await this.entitlementService.resolveEffectiveEntitlements(
      user.organizationId,
    );
    return ent.previewOnly === true;
  }

  @Get()
  @ApiOperation({ summary: 'List approved derivative artifacts for students' })
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  async list(
    @Query() query: ListDerivativesQueryDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const previewOnly = await this.resolvePreviewOnly(user, req);
    const result = await this.service.list(
      user.sub,
      user.organizationId,
      query,
      previewOnly,
    );
    return {
      success: true,
      data: result.items,
      meta: result.meta,
    };
  }

  @Get('subjects/summary')
  @ApiOperation({ summary: 'Get subject chip counts for the Library surface' })
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async subjectsSummary(
    @Query('taxonomyVersion') taxonomyVersion?: string,
  ) {
    const data = await this.service.subjectsSummary(taxonomyVersion);
    return { success: true, data };
  }

  @Get('types/:type/subjects/summary')
  @ApiOperation({
    summary: 'Per-type subject-tile counts for the Library type page',
  })
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async subjectsSummaryByType(
    @Param() params: SubjectsSummaryByTypeParamDto,
    @Query() query: SubjectsSummaryByTypeQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.service.subjectsSummaryByType(
      params.type,
      user.sub,
      user.organizationId,
      query.taxonomyVersion,
    );
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get derivative artifact detail (paywall-aware)' })
  @Throttle({ default: { ttl: 60_000, limit: 200 } })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FindOneDerivativeQueryDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const previewOnly = await this.resolvePreviewOnly(user, req, id);
    const data = await this.service.findOne(
      id,
      user.sub,
      user.organizationId,
      previewOnly,
      query.as,
    );
    return { success: true, data };
  }
}

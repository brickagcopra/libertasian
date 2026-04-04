import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { PromotionService } from './promotion.service';
import {
  CreatePromotionDto,
  UpdatePromotionDto,
  ListPromotionsQueryDto,
  ListPromotionRedemptionsQueryDto,
  SetPromotionRulesDto,
  SetPromotionBenefitsDto,
  SetPromotionPlanRulesDto,
  RevokePromotionRedemptionDto,
} from './dto';

@ApiTags('Admin — Promotions')
@Controller('admin/promotions')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['admin:billing'], mode: 'any' })
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class PromotionAdminController {
  constructor(
    private readonly promotionService: PromotionService,
    private readonly auditService: AuditService,
  ) {}

  // ---- Promotion CRUD ----

  @Get()
  @ApiOperation({ summary: 'List all promotions (admin view — includes archived/expired)' })
  async listPromotions(@Query() query: ListPromotionsQueryDto) {
    const result = await this.promotionService.list(query);
    return { success: true, data: result.data, nextCursor: result.nextCursor, hasNext: result.hasNext };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get promotion details by ID with stats' })
  async getPromotion(@Param('id', ParseUUIDPipe) id: string) {
    const promotion = await this.promotionService.findByIdWithStats(id);
    return { success: true, data: promotion };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new promotion' })
  async createPromotion(
    @Body() dto: CreatePromotionDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const promotion = await this.promotionService.create(dto, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'promotion.create',
      entityType: 'Promotion',
      entityId: promotion.id,
      metadata: {
        ip,
        slug: promotion.slug,
        promotionType: dto.promotionType,
        status: promotion.status,
        rulesCount: dto.rules?.length ?? 0,
        benefitsCount: dto.benefits?.length ?? 0,
      },
    });
    return { success: true, data: promotion };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a promotion' })
  async updatePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const promotion = await this.promotionService.update(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'promotion.update',
      entityType: 'Promotion',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: promotion };
  }

  // ---- Lifecycle Management ----

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive a promotion (soft-delete)' })
  async archivePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const promotion = await this.promotionService.archive(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'promotion.archive',
      entityType: 'Promotion',
      entityId: id,
      metadata: { ip, slug: promotion.slug },
    });
    return { success: true, data: promotion };
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate a promotion (from draft/scheduled/paused)' })
  async activatePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const promotion = await this.promotionService.setStatus(id, 'active');
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'promotion.activate',
      entityType: 'Promotion',
      entityId: id,
      metadata: { ip, slug: promotion.slug },
    });
    return { success: true, data: promotion };
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause an active promotion' })
  async pausePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const promotion = await this.promotionService.setStatus(id, 'paused');
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'promotion.pause',
      entityType: 'Promotion',
      entityId: id,
      metadata: { ip, slug: promotion.slug },
    });
    return { success: true, data: promotion };
  }

  // ---- Redemption Management ----

  @Get(':id/redemptions')
  @ApiOperation({ summary: 'Get redemption history for a promotion' })
  async getRedemptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListPromotionRedemptionsQueryDto,
  ) {
    const result = await this.promotionService.getRedemptionHistory(id, query);
    return { success: true, data: result.data, nextCursor: result.nextCursor, hasNext: result.hasNext };
  }

  @Post('redemptions/:redemptionId/revoke')
  @ApiOperation({ summary: 'Revoke a promotion redemption' })
  async revokeRedemption(
    @Param('redemptionId', ParseUUIDPipe) redemptionId: string,
    @Body() dto: RevokePromotionRedemptionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.promotionService.revokeRedemption(redemptionId, user.sub, dto.reason);
    return { success: true };
  }

  // ---- Rules & Benefits Management ----

  @Post(':id/rules')
  @ApiOperation({ summary: 'Set eligibility rules for a promotion (replaces all existing)' })
  async setRules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPromotionRulesDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const rules = await this.promotionService.setRules(id, dto.rules);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'promotion.set_rules',
      entityType: 'Promotion',
      entityId: id,
      metadata: { ip, ruleCount: dto.rules.length },
    });
    return { success: true, data: rules };
  }

  @Post(':id/benefits')
  @ApiOperation({ summary: 'Set benefits for a promotion (replaces all existing)' })
  async setBenefits(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPromotionBenefitsDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const benefits = await this.promotionService.setBenefits(id, dto.benefits);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'promotion.set_benefits',
      entityType: 'Promotion',
      entityId: id,
      metadata: { ip, benefitCount: dto.benefits.length },
    });
    return { success: true, data: benefits };
  }

  @Post(':id/plan-rules')
  @ApiOperation({ summary: 'Set plan rules for a promotion (replaces all existing)' })
  async setPlanRules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPromotionPlanRulesDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const planRules = await this.promotionService.setPlanRules(id, dto.rules);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'promotion.set_plan_rules',
      entityType: 'Promotion',
      entityId: id,
      metadata: { ip, ruleCount: dto.rules.length },
    });
    return { success: true, data: planRules };
  }
}

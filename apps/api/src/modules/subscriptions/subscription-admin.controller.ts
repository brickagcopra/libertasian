import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { SubscriptionOperationsService } from './subscription-operations.service';
import { SubscriptionAdminService } from './subscription-admin.service';
import { EntitlementService } from './entitlement.service';
import {
  GrantComplimentaryDto,
  RevokeComplimentaryDto,
  GrantEntitlementOverrideDto,
  RevokeEntitlementOverrideDto,
  ListEntitlementOverridesQueryDto,
  ListSubscriptionsQueryDto,
  ListSubscriptionHistoryQueryDto,
  ListSubscriptionMigrationsQueryDto,
  ForceCancelSubscriptionDto,
  ExtendTrialDto,
  ChangeBillingPeriodDto,
} from './dto';

@ApiTags('Admin — Subscriptions')
@Controller('admin/subscriptions')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class SubscriptionAdminController {
  constructor(
    private readonly operationsService: SubscriptionOperationsService,
    private readonly adminService: SubscriptionAdminService,
    private readonly entitlementService: EntitlementService,
    private readonly auditService: AuditService,
  ) {}

  // ---- List & Detail Endpoints ----

  @Get()
  @ApiOperation({ summary: 'List subscriptions with filters and cursor pagination' })
  @RequiredPermissions('admin:billing')
  async listSubscriptions(@Query() query: ListSubscriptionsQueryDto) {
    const result = await this.adminService.listSubscriptions({
      status: query.status,
      planCode: query.planCode,
      organizationId: query.organizationId,
      search: query.search,
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      success: true,
      data: result.data,
      nextCursor: result.nextCursor,
      hasNext: result.hasNext,
    };
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get cursor-paginated subscription state transition history' })
  @RequiredPermissions('admin:billing')
  async getSubscriptionHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListSubscriptionHistoryQueryDto,
  ) {
    const result = await this.adminService.getSubscriptionHistory(id, {
      action: query.action,
      actorType: query.actorType,
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      success: true,
      data: result.data,
      nextCursor: result.nextCursor,
      hasNext: result.hasNext,
    };
  }

  @Get(':id/migrations')
  @ApiOperation({ summary: 'Get cursor-paginated subscription migration history' })
  @RequiredPermissions('admin:billing')
  async getSubscriptionMigrations(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListSubscriptionMigrationsQueryDto,
  ) {
    const result = await this.adminService.getSubscriptionMigrations(id, {
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      success: true,
      data: result.data,
      nextCursor: result.nextCursor,
      hasNext: result.hasNext,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full subscription detail with history, migrations, and valid actions' })
  @RequiredPermissions('admin:billing')
  async getSubscriptionDetail(@Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.adminService.getSubscriptionDetail(id);
    return { success: true, data: detail };
  }

  // ---- Admin Action Endpoints ----

  @Post(':id/force-cancel')
  @ApiOperation({ summary: 'Force-cancel a subscription immediately' })
  @RequiredPermissions('admin:billing')
  async forceCancelSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ForceCancelSubscriptionDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.adminService.forceCancelSubscription(
      id,
      user.sub,
      dto.reason,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'subscription.admin_force_cancel',
      entityType: 'subscription',
      entityId: id,
      metadata: { reason: dto.reason, ip: req.ip },
    });

    return { success: true, data: result };
  }

  @Patch(':id/trial/extend')
  @ApiOperation({ summary: 'Extend trial end date by N days' })
  @RequiredPermissions('admin:billing')
  async extendTrial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendTrialDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.adminService.extendTrial(
      id,
      dto.extensionDays,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'subscription.admin_extend_trial',
      entityType: 'subscription',
      entityId: id,
      metadata: { extensionDays: dto.extensionDays, ip: req.ip },
    });

    return { success: true, data: result };
  }

  @Patch(':id/billing-period')
  @ApiOperation({ summary: 'Change billing period (monthly ↔ annual)' })
  @RequiredPermissions('admin:billing')
  async changeBillingPeriod(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeBillingPeriodDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.adminService.changeBillingPeriod(
      id,
      dto.billingPeriod,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'subscription.admin_change_billing_period',
      entityType: 'subscription',
      entityId: id,
      metadata: { billingPeriod: dto.billingPeriod, ip: req.ip },
    });

    return { success: true, data: result };
  }

  // ---- Complimentary Access Endpoints ----

  @Post('complimentary/grant')
  @ApiOperation({ summary: 'Grant complimentary access to an organization' })
  @RequiredPermissions('admin:billing')
  async grantComplimentary(
    @Body() dto: GrantComplimentaryDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.operationsService.grantComplimentary(
      dto.organizationId,
      dto.planCode,
      dto.reason,
      user.sub,
      dto.endsAt,
    );

    await this.auditService.log({
      organizationId: dto.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'subscription.admin_grant_complimentary',
      entityType: 'subscription',
      entityId: result.subscriptionId,
      metadata: { planCode: dto.planCode, reason: dto.reason, ip: req.ip },
    });

    return { success: true, data: result };
  }

  @Post(':id/complimentary/revoke')
  @ApiOperation({ summary: 'Revoke complimentary access for a subscription' })
  @RequiredPermissions('admin:billing')
  async revokeComplimentary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeComplimentaryDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.operationsService.revokeComplimentary(
      id,
      user.sub,
      dto.reason,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'subscription.admin_revoke_complimentary',
      entityType: 'subscription',
      entityId: id,
      metadata: { reason: dto.reason, ip: req.ip },
    });

    return { success: true, data: result };
  }

  @Post(':id/trial/expire')
  @ApiOperation({ summary: 'Force-expire a trial subscription' })
  @RequiredPermissions('admin:billing')
  async expireTrial(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.operationsService.expireTrial(
      id,
      user.sub,
      'admin',
      'Admin force-expired trial',
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'subscription.admin_expire_trial',
      entityType: 'subscription',
      entityId: id,
      metadata: { ip: req.ip },
    });

    return { success: true, data: result };
  }

  // ---- Entitlement Override Endpoints ----

  @Post('entitlements/override')
  @ApiOperation({ summary: 'Grant an entitlement override (bonus/admin override/promo)' })
  @RequiredPermissions('admin:billing')
  async grantOverride(
    @Body() dto: GrantEntitlementOverrideDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.entitlementService.grantBonus({
      organizationId: dto.organizationId,
      entitlementKey: dto.entitlementKey,
      overrideType: dto.overrideType,
      numericValue: dto.numericValue,
      booleanValue: dto.booleanValue,
      reason: dto.reason,
      sourceType: dto.sourceType,
      sourceId: dto.sourceId,
      startsAt: new Date(dto.startsAt),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdByUserId: user.sub,
      metadata: dto.metadata,
    });
    return { success: true, data: result };
  }

  @Delete('entitlements/override/:id')
  @ApiOperation({ summary: 'Revoke an entitlement override' })
  @RequiredPermissions('admin:billing')
  async revokeOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeEntitlementOverrideDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.entitlementService.revokeBonus(
      id,
      user.sub,
      dto.reason,
    );
    return { success: true, data: result };
  }

  @Get('entitlements/overrides')
  @ApiOperation({ summary: 'List entitlement overrides for an organization' })
  @RequiredPermissions('admin:billing')
  async listOverrides(@Query() query: ListEntitlementOverridesQueryDto) {
    const result = await this.entitlementService.getOverrideHistory(
      query.organizationId,
      { limit: query.limit, cursor: query.cursor },
    );
    return { success: true, data: result.data, nextCursor: result.nextCursor, hasNext: result.hasNext };
  }
}

import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CreatePurchaseIntentDto } from './dto';
import { StorePurchasesService } from './store-purchases.service';

@ApiTags('Store Purchases')
@Controller('store')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 20 } })
export class StorePurchasesController {
  constructor(private readonly storePurchasesService: StorePurchasesService) {}

  /**
   * Called by the client BEFORE it presents the store sheet.
   *
   * Returns the App User ID the client must `logIn()` with (D11) and the
   * products it may offer. Returns `403 not_billing_owner`,
   * `409 multi_member_org` or `409 already_subscribed_elsewhere` when the org
   * must not buy — see §5.2 and §6.1.
   */
  @Post('purchase-intent')
  @ApiOperation({ summary: 'Check whether this org may start a store purchase' })
  async createPurchaseIntent(
    @Body() _dto: CreatePurchaseIntentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.storePurchasesService.createPurchaseIntent(
      user.organizationId,
      user.sub,
    );
    return { success: true, data };
  }

  /**
   * Reconcile this org against the conduit's own view (§9), by SERVER-SIDE
   * PULL.
   *
   * D12: there is deliberately no endpoint that accepts a receipt or an
   * entitlement claim from the client — a client-asserted entitlement is a
   * client-forgeable entitlement. The only input here is the org id we already
   * hold in the JWT; the answer comes from the conduit directly.
   *
   * The client calls this after `restorePurchases()` resolves, and on app
   * foreground at most once per hour — hence the tighter throttle.
   */
  @Post('sync')
  @ApiOperation({ summary: 'Reconcile this org against the store (post-restore, foreground)' })
  @Throttle({ default: { ttl: 60000, limit: 6 } })
  async sync(@CurrentUser() user: JwtPayload) {
    const result = await this.storePurchasesService.syncFromStore(user.organizationId);
    return { success: true, data: result };
  }
}

/**
 * §9 use 3 — the manual admin resync, for the case where a webhook was lost and
 * the nightly job has not yet run.
 */
@ApiTags('Admin — Store Purchases')
@Controller('admin/store-purchases')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class StorePurchasesAdminController {
  constructor(private readonly storePurchasesService: StorePurchasesService) {}

  @Post(':orgId/resync')
  @ApiOperation({ summary: 'Force a store reconciliation pull for one organization' })
  @RequiredPermissions('admin:billing')
  async resync(@Param('orgId', ParseUUIDPipe) orgId: string) {
    const result = await this.storePurchasesService.syncFromStore(orgId);
    return { success: true, data: result };
  }
}

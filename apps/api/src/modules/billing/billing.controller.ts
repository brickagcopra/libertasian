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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TrackEvent } from '../analytics';
import { BillingService } from './billing.service';
import { CreateCheckoutDto, PreviewCheckoutDto, CancelSubscriptionDto } from './dto';

@ApiTags('Billing')
@Controller('billing')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 20 } })
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('subscription')
  @ApiOperation({ summary: 'Get active subscription for current organization' })
  async getSubscription(@CurrentUser() user: JwtPayload) {
    const subscription = await this.billingService.getSubscription(
      user.organizationId,
    );
    return { success: true, data: subscription };
  }

  @Post('checkout/preview')
  @ApiOperation({ summary: 'Preview checkout pricing breakdown (no payment created)' })
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async previewCheckout(
    @Body() dto: PreviewCheckoutDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.billingService.previewCheckout(
      user.organizationId,
      dto,
      user.sub,
    );
    return { success: true, data: result };
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Create a checkout session for plan subscription' })
  async createCheckout(
    @Body() dto: CreateCheckoutDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.billingService.createCheckout(
      user.organizationId,
      dto,
      user.sub,
    );
    return { success: true, data: result };
  }

  @Post('cancel')
  @ApiOperation({ summary: 'Cancel the current subscription' })
  @TrackEvent('subscription_cancelled', (req, res) => {
    const response = res.data as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;
    return {
      plan_code: (data?.planCode as string) ?? 'unknown',
      reason_category: 'user_initiated',
      tenure_days: 0,
    };
  })
  async cancelSubscription(
    @Body() dto: CancelSubscriptionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.billingService.cancelSubscription(
      user.organizationId,
      user.sub,
      dto.cancelAtPeriodEnd ?? true,
    );
    return { success: true, data: result };
  }

  // ---- Payment Methods ----

  @Get('payment-methods')
  @ApiOperation({ summary: 'List saved payment methods' })
  async listPaymentMethods(@CurrentUser() user: JwtPayload) {
    const methods = await this.billingService.listPaymentMethods(
      user.organizationId,
    );
    return { success: true, data: methods };
  }

  @Patch('payment-methods/:id/default')
  @ApiOperation({ summary: 'Set a payment method as default' })
  async setDefaultPaymentMethod(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.billingService.setDefaultPaymentMethod(
      user.organizationId,
      id,
      user.sub,
    );
    return { success: true, data: result };
  }

  @Delete('payment-methods/:id')
  @ApiOperation({ summary: 'Remove a payment method' })
  async deletePaymentMethod(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.billingService.deletePaymentMethod(
      user.organizationId,
      id,
      user.sub,
    );
    return { success: true, data: result };
  }

  // ---- Invoices ----

  @Get('invoices')
  @ApiOperation({ summary: 'List invoices (cursor-paginated)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listInvoices(
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.billingService.listInvoices(
      user.organizationId,
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get a single invoice' })
  async getInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const invoice = await this.billingService.getInvoice(
      user.organizationId,
      id,
    );
    return { success: true, data: invoice };
  }
}

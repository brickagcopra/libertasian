import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ListAdminUsersQueryDto } from './dto/list-admin-users.query.dto';
import { AccountSharingService } from './account-sharing/account-sharing.service';
import { UsersAdminService } from './users-admin.service';

@ApiTags('Admin — Users')
@Controller('admin/users')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class UsersAdminController {
  constructor(
    private readonly adminService: UsersAdminService,
    private readonly accountSharing: AccountSharingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List users with filters and cursor pagination' })
  @RequiredPermissions('admin:users')
  async listUsers(@Query() query: ListAdminUsersQueryDto) {
    const hasActiveSubscription =
      query.hasActiveSubscription === undefined
        ? undefined
        : query.hasActiveSubscription === 'true';

    const emailVerified =
      query.emailVerified === undefined ? undefined : query.emailVerified === 'true';

    const result = await this.adminService.listUsers({
      cursor: query.cursor,
      limit: query.limit,
      search: query.search,
      status: query.status,
      role: query.role,
      planTier: query.planTier,
      hasActiveSubscription,
      emailVerified,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
    return {
      success: true,
      data: result.data,
      nextCursor: result.nextCursor,
      hasNext: result.hasNext,
    };
  }

  /**
   * Possible account sharing: accounts seen in many distinct places or
   * travelling impossibly fast inside the window. Advisory; changes nothing.
   * Declared before ':id' so the path is not parsed as a user id.
   */
  @Get('sharing-signals')
  @ApiOperation({ summary: 'Accounts that may be shared (many places / impossible travel)' })
  @RequiredPermissions('admin:users')
  async sharingSignals(@Query('hours') hours?: string) {
    let windowHours = 24;
    if (hours !== undefined) {
      const n = Number(hours);
      if (!Number.isInteger(n) || n < 1 || n > 168) {
        throw new BadRequestException('hours must be an integer from 1 to 168');
      }
      windowHours = n;
    }
    const data = await this.accountSharing.report(windowHours);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full user detail (org memberships, subs, payments, coupons, overrides)' })
  @RequiredPermissions('admin:users')
  async getUserDetail(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.adminService.getUserDetail(id);
    return { success: true, data };
  }
}

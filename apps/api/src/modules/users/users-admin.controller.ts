import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ListAdminUsersQueryDto } from './dto/list-admin-users.query.dto';
import { UsersAdminService } from './users-admin.service';

@ApiTags('Admin — Users')
@Controller('admin/users')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class UsersAdminController {
  constructor(private readonly adminService: UsersAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List users with filters and cursor pagination' })
  @RequiredPermissions('admin:users')
  async listUsers(@Query() query: ListAdminUsersQueryDto) {
    const hasActiveSubscription =
      query.hasActiveSubscription === undefined
        ? undefined
        : query.hasActiveSubscription === 'true';

    const result = await this.adminService.listUsers({
      cursor: query.cursor,
      limit: query.limit,
      search: query.search,
      status: query.status,
      role: query.role,
      planTier: query.planTier,
      hasActiveSubscription,
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

  @Get(':id')
  @ApiOperation({ summary: 'Get full user detail (org memberships, subs, payments, coupons, overrides)' })
  @RequiredPermissions('admin:users')
  async getUserDetail(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.adminService.getUserDetail(id);
    return { success: true, data };
  }
}

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  JwtAuthGuard,
  MfaGuard,
  TenantGuard,
  PermissionsGuard,
  SubscriptionGuard,
} from '../../../common/guards';
import { RequiredPermissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsService } from '../permissions.service';
import { ListPermissionsQueryDto } from '../dto';

@ApiTags('RBAC — Permissions')
@Controller('rbac/permissions')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard, SubscriptionGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequiredPermissions('permissions:read')
  @ApiOperation({ summary: 'List all permissions (optionally filtered)' })
  async listPermissions(@Query() query: ListPermissionsQueryDto) {
    const permissions = await this.permissionsService.getAllPermissions({
      category: query.category,
      resource: query.resource,
    });
    return { success: true, data: permissions };
  }

  @Get(':code')
  @RequiredPermissions('permissions:read')
  @ApiOperation({ summary: 'Get a permission by its code (e.g. documents:read)' })
  async getPermissionByCode(@Param('code') code: string) {
    const permission = await this.permissionsService.getPermissionByCode(code);
    return { success: true, data: permission };
  }
}

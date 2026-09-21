import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard, PlatformPermissionsGuard } from '../../../common/guards';
import { RequiredPlatformPermissions } from '../../../common/decorators/platform-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PermissionsService } from '../permissions.service';
import { PlatformGrantsService } from '../platform-grants.service';
import { CreatePlatformRoleDto, UpdatePlatformRoleDto } from '../dto';

interface AuthUser {
  sub: string;
}

/**
 * Platform-scope role authoring.
 *
 * Roles are DATA: a role created here is grantable immediately, with no
 * deploy and no string literal anywhere in an authorization decision.
 * Built-in (is_system) roles are immutable — the panel clones one to
 * customise it.
 */
@ApiTags('Platform — Roles')
@Controller('platform')
@UseGuards(JwtAuthGuard, PlatformPermissionsGuard)
@RequiredPlatformPermissions('platform-roles:manage')
@Throttle({ default: { ttl: 60000, limit: 100 } })
@ApiBearerAuth()
export class PlatformRolesController {
  constructor(
    private readonly platformGrants: PlatformGrantsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('permissions')
  @ApiOperation({
    summary: 'Full permission catalogue grouped by category and resource',
    description: 'Renders the permission picker from data rather than a hardcoded list.',
  })
  async catalogue() {
    const permissions = await this.permissions.getAllPermissions();

    const byCategory = new Map<
      string,
      Map<string, typeof permissions>
    >();
    for (const p of permissions) {
      const resources = byCategory.get(p.category) ?? new Map();
      const bucket = resources.get(p.resource) ?? [];
      bucket.push(p);
      resources.set(p.resource, bucket);
      byCategory.set(p.category, resources);
    }

    return {
      success: true,
      data: {
        permissions,
        groups: [...byCategory.entries()].map(([category, resources]) => ({
          category,
          resources: [...resources.entries()].map(([resource, items]) => ({
            resource,
            permissions: items,
          })),
        })),
      },
    };
  }

  @Get('roles')
  @ApiOperation({ summary: 'List platform-grantable roles (organization_id IS NULL)' })
  async listRoles() {
    const roles = await this.platformGrants.listGrantableRoles();
    return { success: true, data: roles };
  }

  @Get('roles/:id')
  @ApiOperation({ summary: 'Get one platform role with its permissions' })
  async getRole(@Param('id', ParseUUIDPipe) id: string) {
    const role = await this.platformGrants.getPlatformRole(id);
    return { success: true, data: role };
  }

  @Post('roles')
  @ApiOperation({
    summary: 'Create a platform-scope custom role',
    description:
      'organization_id NULL, is_system false. Refuses (403) any permission the creator does not personally hold.',
  })
  async createRole(
    @Body() dto: CreatePlatformRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const role = await this.platformGrants.createPlatformRole(dto, actor.sub);
    return { success: true, data: role };
  }

  @Patch('roles/:id')
  @ApiOperation({
    summary: 'Edit a platform role',
    description: 'Refuses built-in (is_system) roles — clone one instead.',
  })
  async updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const role = await this.platformGrants.updatePlatformRole(id, dto, actor.sub);
    return { success: true, data: role };
  }

  @Delete('roles/:id')
  @ApiOperation({
    summary: 'Delete a platform role',
    description: 'Refuses built-in roles and roles anyone still holds.',
  })
  async deleteRole(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.platformGrants.deletePlatformRole(id, actor.sub);
    return { success: true };
  }
}

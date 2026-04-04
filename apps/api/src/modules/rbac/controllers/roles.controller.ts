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
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  JwtAuthGuard,
  MfaGuard,
  TenantGuard,
  PermissionsGuard,
  SubscriptionGuard,
} from '../../../common/guards';
import { RequiredPermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RolesService } from '../roles.service';
import { ListRolesQueryDto, CreateCustomRoleDto, UpdateCustomRoleDto } from '../dto';

interface AuthUser {
  sub: string;
  organizationId: string;
  memberId?: string;
}

@ApiTags('RBAC — Roles')
@Controller('rbac')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard, SubscriptionGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  // Static routes MUST come before :id to avoid route conflicts

  @Get('hierarchy')
  @RequiredPermissions('roles:read')
  @ApiOperation({ summary: 'Get role hierarchy tree' })
  async getHierarchy() {
    const tree = await this.rolesService.getHierarchyTree();
    const edges = await this.rolesService.getHierarchyEdges();
    return { success: true, data: { tree, edges } };
  }

  @Get('constraints')
  @RequiredPermissions('roles:read')
  @ApiOperation({ summary: 'List all role constraints (SoD, cardinality)' })
  async listConstraints() {
    const constraints = await this.rolesService.listConstraints();
    return { success: true, data: constraints };
  }

  @Get('roles')
  @RequiredPermissions('roles:read')
  @ApiOperation({ summary: 'List all role definitions' })
  async listRoles(
    @CurrentUser() user: AuthUser,
    @Query() query: ListRolesQueryDto,
  ) {
    const orgId = query.systemOnly ? undefined : user.organizationId;
    const roles = await this.rolesService.listRoleDefinitions(orgId);
    return { success: true, data: roles };
  }

  @Get('roles/:id')
  @RequiredPermissions('roles:read')
  @ApiOperation({ summary: 'Get a role definition by ID' })
  async getRoleById(@Param('id', ParseUUIDPipe) id: string) {
    const role = await this.rolesService.getRoleDefinitionById(id);
    return { success: true, data: role };
  }

  @Post('roles')
  @RequiredPermissions('roles:create')
  @ApiOperation({ summary: 'Create a custom role for the organization' })
  async createRole(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCustomRoleDto,
  ) {
    const role = await this.rolesService.createCustomRole(
      user.organizationId,
      dto,
      user.sub,
    );
    return { success: true, data: role };
  }

  @Patch('roles/:id')
  @RequiredPermissions('roles:update')
  @ApiOperation({ summary: 'Update a custom role' })
  async updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCustomRoleDto,
  ) {
    const role = await this.rolesService.updateCustomRole(id, dto, user.sub);
    return { success: true, data: role };
  }

  @Delete('roles/:id')
  @RequiredPermissions('roles:delete')
  @ApiOperation({ summary: 'Delete a custom role (must have no members)' })
  async deleteRole(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.rolesService.deleteCustomRole(id, user.sub);
    return { success: true };
  }
}

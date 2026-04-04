import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
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
import { PrismaService } from '../../../prisma/prisma.service';
import { PermissionsService } from '../permissions.service';
import { RolesService } from '../roles.service';
import { AssignRoleDto, ListMembersQueryDto } from '../dto';

interface AuthUser {
  sub: string;
  organizationId: string;
  memberId?: string;
}

@ApiTags('RBAC — Members')
@Controller('rbac/members')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard, SubscriptionGuard)
export class MemberRolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequiredPermissions('members:read')
  @ApiOperation({ summary: 'List organization members with their RBAC roles (paginated)' })
  async listMembers(
    @CurrentUser() user: AuthUser,
    @Query() query: ListMembersQueryDto,
  ) {
    const result = await this.rolesService.getOrgMembersWithRolesPaginated(
      user.organizationId,
      {
        cursor: query.cursor,
        limit: query.limit,
        search: query.search,
        roleSlug: query.roleSlug,
      },
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':memberId/roles')
  @RequiredPermissions('members:read')
  @ApiOperation({ summary: 'Get all roles assigned to a specific member' })
  async getMemberRoles(
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    await this.assertMemberInOrg(memberId, user.organizationId);
    const roles = await this.rolesService.getMemberRoles(memberId);
    return { success: true, data: roles };
  }

  @Post(':memberId/roles')
  @RequiredPermissions('members:update-role')
  @ApiOperation({ summary: 'Assign a role to a member' })
  async assignRole(
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: AssignRoleDto,
  ) {
    await this.assertMemberInOrg(memberId, user.organizationId);
    const assignment = await this.rolesService.assignRole(
      memberId,
      dto.roleDefinitionId,
      user.sub,
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    );
    return { success: true, data: assignment };
  }

  @Delete(':memberId/roles/:roleDefinitionId')
  @RequiredPermissions('members:update-role')
  @ApiOperation({ summary: 'Remove a role from a member' })
  async removeRole(
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Param('roleDefinitionId', ParseUUIDPipe) roleDefinitionId: string,
  ) {
    await this.assertMemberInOrg(memberId, user.organizationId);
    await this.rolesService.removeRole(memberId, roleDefinitionId, user.sub);
    return { success: true };
  }

  @Get(':memberId/permissions')
  @RequiredPermissions('members:read')
  @ApiOperation({ summary: 'Get effective permissions for a member (resolved via hierarchy)' })
  async getMemberPermissions(
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    await this.assertMemberInOrg(memberId, user.organizationId);
    const permissions = await this.permissionsService.getEffectivePermissions(memberId);
    return { success: true, data: permissions };
  }

  /**
   * Verify that the target member belongs to the caller's organization.
   * Prevents cross-tenant data access.
   */
  private async assertMemberInOrg(memberId: string, organizationId: string): Promise<void> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { id: memberId },
      select: { organizationId: true },
    });

    if (!member || member.organizationId !== organizationId) {
      throw new ForbiddenException('Member not found in your organization');
    }
  }
}

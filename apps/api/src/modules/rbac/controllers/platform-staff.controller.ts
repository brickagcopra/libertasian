import {
  BadRequestException,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Prisma } from '@prisma/client';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequiredPlatformPermissions } from '../../../common/decorators/platform-permissions.decorator';
import {
  JwtAuthGuard,
  MfaGuard,
  PlatformPermissionsGuard,
} from '../../../common/guards';
import { PrismaService } from '../../../prisma/prisma.service';
import { InviteMemberDto } from '../../organizations/dto';
import { OrganizationsService } from '../../organizations/organizations.service';
import { PermissionsService } from '../permissions.service';
import { RolesService } from '../roles.service';
import {
  AssignRoleDto,
  CreateCustomRoleDto,
  ListAuditLogsQueryDto,
  ListMembersQueryDto,
  ListPermissionsQueryDto,
} from '../dto';

interface AuthUser {
  sub: string;
  organizationId?: string;
  /** Resolved by PlatformPermissionsGuard. */
  platformMemberId?: string | null;
}

/**
 * Staff administration — the superadmin surface for platform capability.
 *
 * Every endpoint here operates on the PLATFORM organization explicitly, never
 * on the caller's current org. That is the whole reason it exists rather than
 * reusing /rbac/members directly: those endpoints scope to the JWT's
 * organizationId, and login picks a user's OLDEST active membership, which for
 * anyone who signed up normally is their personal workspace. A superadmin
 * would end up granting `editor` on their own workspace — a grant that confers
 * nothing, silently.
 *
 * Authorization is PlatformPermissionsGuard: the required permission must be
 * held ON THE PLATFORM ORG. A tenant-scoped check would be meaningless here,
 * since every account holds `owner` (and therefore `members:read`) somewhere.
 *
 * No role-name literals: the role list is loaded at runtime from
 * GET /rbac/platform/roles, so a role created in the panel is immediately
 * grantable with no deploy (P1).
 *
 * Every grant and revoke is audited by RolesService (`role.assigned` /
 * `role.removed`, entityType `member_role`), and role creation by
 * `role.created`. The audit trail is readable at GET /rbac/platform/audit-logs.
 */
@ApiTags('RBAC — Platform Staff')
@Controller('rbac/platform')
@UseGuards(JwtAuthGuard, MfaGuard, PlatformPermissionsGuard)
@Throttle({ default: { ttl: 60000, limit: 100 } })
@ApiBearerAuth()
export class PlatformStaffController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
    private readonly organizationsService: OrganizationsService,
    private readonly prisma: PrismaService,
  ) {}

  private get platformOrgId(): string {
    return this.permissionsService.platformOrganizationId;
  }

  // -----------------------------------------------------------------------
  // Roster
  // -----------------------------------------------------------------------

  @Get('members')
  @RequiredPlatformPermissions('members:read')
  @ApiOperation({
    summary: 'List platform staff with their roles, effective permissions and grant expiry',
  })
  async listMembers(@Query() query: ListMembersQueryDto) {
    // CARVE-OUT: platform-staff roster — reads the platform org regardless of
    // the caller's own tenant, by design.
    const result = await this.rolesService.getOrgMembersWithRolesPaginated(
      this.platformOrgId,
      {
        cursor: query.cursor,
        limit: query.limit,
        search: query.search,
        roleSlug: query.roleSlug,
      },
    );

    // Effective permissions are what a grant actually BUYS — the resolved set
    // after hierarchy expansion and expiry filtering. Showing only role names
    // hides the fact that `admin` carries `reviewer`'s grants through the
    // hierarchy, which is exactly the thing an operator needs to see before
    // granting.
    const items = await Promise.all(
      result.items.map(async (member) => ({
        ...member,
        effectivePermissions:
          await this.permissionsService.getEffectivePermissions(member.id),
      })),
    );

    return { success: true, data: items, meta: result.meta };
  }

  // -----------------------------------------------------------------------
  // Role catalogue (runtime-loaded — no hardcoded role names in the UI)
  // -----------------------------------------------------------------------

  @Get('roles')
  @RequiredPlatformPermissions('roles:read')
  @ApiOperation({ summary: 'Roles grantable on the platform org (system + platform-custom)' })
  async listRoles() {
    const roles = await this.rolesService.listRoleDefinitions(this.platformOrgId);
    return { success: true, data: roles };
  }

  @Get('permissions')
  @RequiredPlatformPermissions('roles:read')
  @ApiOperation({ summary: 'Permission catalogue, for the custom-role permission picker' })
  async listPermissions(@Query() query: ListPermissionsQueryDto) {
    const permissions = await this.permissionsService.getAllPermissions({
      category: query.category,
      resource: query.resource,
    });
    return { success: true, data: permissions };
  }

  @Post('roles')
  @RequiredPlatformPermissions('roles:create')
  @ApiOperation({ summary: 'Create a custom role on the platform org' })
  async createRole(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomRoleDto) {
    const role = await this.rolesService.createCustomRole(
      this.platformOrgId,
      dto,
      user.sub,
    );
    return { success: true, data: role };
  }

  // -----------------------------------------------------------------------
  // Grants
  // -----------------------------------------------------------------------

  @Post('members/invite')
  @RequiredPlatformPermissions('members:invite')
  @ApiOperation({ summary: 'Invite a user into the platform organization' })
  async invite(@CurrentUser() user: AuthUser, @Body() dto: InviteMemberDto) {
    const member = await this.organizationsService.inviteMember(
      this.platformOrgId,
      dto,
      user.sub,
    );
    return { success: true, data: member };
  }

  @Post('members/:memberId/roles')
  @RequiredPlatformPermissions('members:update-role')
  @ApiOperation({ summary: 'Grant a role to a platform staff member (optionally temporary)' })
  async grantRole(
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: AssignRoleDto,
  ) {
    await this.assertPlatformMember(memberId);

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      // getEffectivePermissions filters on expiresAt > now, so an already-past
      // expiry writes a row that grants nothing — a grant that silently does
      // nothing is worse than a refusal.
      throw new BadRequestException('expiresAt must be in the future');
    }

    const assignment = await this.rolesService.assignRole(
      memberId,
      dto.roleDefinitionId,
      user.sub,
      expiresAt,
    );
    return { success: true, data: assignment };
  }

  @Delete('members/:memberId/roles/:roleDefinitionId')
  @RequiredPlatformPermissions('members:update-role')
  @ApiOperation({ summary: 'Revoke a role from a platform staff member' })
  async revokeRole(
    @CurrentUser() user: AuthUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Param('roleDefinitionId', ParseUUIDPipe) roleDefinitionId: string,
  ) {
    await this.assertPlatformMember(memberId);
    await this.assertNotSelfLockout(user, memberId, roleDefinitionId);

    await this.rolesService.removeRole(memberId, roleDefinitionId, user.sub);
    return { success: true };
  }

  // -----------------------------------------------------------------------
  // Audit trail
  // -----------------------------------------------------------------------

  @Get('audit-logs')
  @RequiredPlatformPermissions('audit-logs:read')
  @ApiOperation({ summary: 'RBAC audit trail for the platform org (grants, revokes, role edits)' })
  async listAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    const limit = query.limit ?? 20;

    // CARVE-OUT: platform audit trail — reads the platform org regardless of
    // the caller's own tenant, by design.
    const where: Prisma.AuditLogWhereInput = {
      organizationId: this.platformOrgId,
      entityType: { in: ['member_role', 'role_definition'] },
    };
    if (query.action?.length) where.action = { in: query.action };
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.dateFrom || query.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.dateFrom) createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) createdAt.lte = new Date(query.dateTo);
      where.createdAt = createdAt;
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;
    const lastItem = items[items.length - 1];

    return {
      success: true,
      data: items,
      meta: { hasNext, nextCursor: hasNext && lastItem ? lastItem.id : undefined, limit },
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * The target must be a member of the PLATFORM org.
   *
   * Without this, a platform `members:update-role` holder could pass any
   * member id in the system and grant roles inside other tenants' orgs —
   * platform standing is not tenant standing.
   */
  private async assertPlatformMember(memberId: string): Promise<void> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { id: memberId },
      select: { organizationId: true },
    });

    if (!member || member.organizationId !== this.platformOrgId) {
      throw new ForbiddenException('Member is not part of the platform organization');
    }
  }

  /**
   * Refuse to let the caller revoke the grant that is letting them do the
   * revoking. Recovering from it needs a database migration, which is how the
   * previous lockout in this area had to be fixed.
   */
  private async assertNotSelfLockout(
    user: AuthUser,
    memberId: string,
    roleDefinitionId: string,
  ): Promise<void> {
    if (user.platformMemberId !== memberId) return;

    const role = await this.prisma.roleDefinition.findUnique({
      where: { id: roleDefinitionId },
      select: { id: true, rolePermissions: { select: { permission: { select: { code: true } } } } },
    });
    const grants = (role?.rolePermissions ?? []).map((rp) => rp.permission.code);

    if (grants.includes('members:update-role')) {
      throw new BadRequestException(
        'Refusing to revoke your own grant-management role. Have another platform admin do it.',
      );
    }
  }
}

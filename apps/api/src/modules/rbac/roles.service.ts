import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  MemberRoleAssignment,
  MemberWithRoles,
  RbacConstraint,
  RoleHierarchyEdge,
  RoleHierarchyNode,
} from '@libertasian/types';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from './permissions.service';
import { RbacCacheService } from './rbac-cache.service';
import {
  PLATFORM_CAPABILITY_REFUSAL,
  findPlatformScopedCodes,
} from './platform-scope';
import type { CreateCustomRoleDto, UpdateCustomRoleDto } from './dto';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RbacCacheService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  // -----------------------------------------------------------------------
  // Platform-capability containment
  // -----------------------------------------------------------------------

  /**
   * Refuse if `conferred` contains any platform-scope code.
   *
   * Writes an audit row on refusal: a caller probing for this boundary is a
   * privilege-escalation attempt and should be visible to whoever reads the
   * log, not just to the caller who got the 403.
   */
  private async assertConfersNoPlatformCapability(
    conferred: readonly string[],
    organizationId: string,
    actorUserId: string,
    context: {
      memberId?: string;
      roleSlug?: string;
      roleDefinitionId?: string;
      roleName?: string;
    },
  ): Promise<void> {
    const platformCodes = findPlatformScopedCodes(conferred);
    if (platformCodes.length === 0) return;

    await this.audit.log({
      organizationId,
      actorUserId,
      actorType: 'user',
      action: 'role.platform_capability_refused',
      entityType: 'role_definition',
      entityId: context.roleDefinitionId ?? 'n/a',
      metadata: { ...context, platformCodes },
    });

    this.logger.warn(
      `Refused platform capability through a workspace role: org=${organizationId} ` +
        `actor=${actorUserId} codes=${platformCodes.join(',')}`,
    );

    throw new ForbiddenException(PLATFORM_CAPABILITY_REFUSAL);
  }

  /**
   * Refuse unless the assigner's own effective workspace permissions are a
   * superset of what the role confers.
   *
   * Resolved from the DB rather than from anything the caller sends, and
   * scoped to the organization the target member belongs to — an assigner who
   * is not an active member of that org holds nothing there and can assign
   * nothing.
   */
  private async assertAssignerHoldsAtLeast(
    conferred: readonly string[],
    organizationId: string,
    assignedByUserId: string,
    roleName: string,
  ): Promise<void> {
    if (conferred.length === 0) return;

    const assignerMemberId = await this.permissions.resolveMemberId(
      assignedByUserId,
      organizationId,
    );
    if (!assignerMemberId) {
      throw new ForbiddenException(
        'You are not an active member of this organization.',
      );
    }

    const held = new Set(
      await this.permissions.getEffectivePermissions(assignerMemberId),
    );
    const missing = conferred.filter((code) => !held.has(code)).sort();
    if (missing.length === 0) return;

    throw new ForbiddenException(
      `You cannot assign "${roleName}" because it grants permissions you do not ` +
        `hold: ${missing.join(', ')}.`,
    );
  }

  /**
   * The codes a role inherits from its hierarchy children.
   *
   * Used when validating a PROPOSED permission set, where resolving the role
   * itself would read the permissions we are about to replace. There is no API
   * that creates a hierarchy edge today, so in practice this is empty — it is
   * here so that a role wired under a platform-bearing child by a seed or a
   * migration cannot then be edited into service through the org role editor.
   */
  private async resolveInheritedCodes(roleId: string): Promise<string[]> {
    const childEdges = await this.prisma.roleHierarchy.findMany({
      where: { parentRoleId: roleId },
      select: { childRoleId: true },
    });
    if (childEdges.length === 0) return [];
    return this.permissions.resolvePermissionCodes(
      childEdges.map((e) => e.childRoleId),
    );
  }

  // -----------------------------------------------------------------------
  // Role Assignment
  // -----------------------------------------------------------------------

  /**
   * Assign a role to an organization member.
   * Enforces: SoD constraints, cardinality limits, expiry roles.
   */
  async assignRole(
    memberId: string,
    roleDefinitionId: string,
    assignedByUserId: string,
    expiresAt?: Date,
  ): Promise<MemberRoleAssignment> {
    // Validate member exists
    const member = await this.prisma.organizationMember.findUnique({
      where: { id: memberId },
      select: { id: true, organizationId: true, userId: true, user: { select: { email: true, fullName: true } } },
    });
    if (!member) throw new NotFoundException('Organization member not found');

    // Validate role definition exists
    const roleDef = await this.prisma.roleDefinition.findUnique({
      where: { id: roleDefinitionId },
    });
    if (!roleDef) throw new NotFoundException('Role definition not found');

    // Check role is accessible: system roles are global; org roles must match org
    if (!roleDef.isSystem && roleDef.organizationId !== member.organizationId) {
      throw new BadRequestException('Role does not belong to this organization');
    }

    // What this role ACTUALLY confers, including everything inherited through
    // role_hierarchy. Reading role_permissions alone would miss a role whose
    // only path to `admin:*` is a parent edge, which is the same hole wearing
    // a hat.
    const conferred = await this.permissions.resolvePermissionCodes([
      roleDefinitionId,
    ]);

    // GATE 1 — a workspace role may never confer platform capability.
    //
    // Every signup owns a personal workspace, and the owner role holds
    // members:update-role. Without this, any account could POST its own
    // member id the system admin role id (which GET /rbac/roles lists) and
    // come back as a platform admin, because jwt.strategy derives
    // isPlatformAdmin from the presence of any `admin:` code.
    await this.assertConfersNoPlatformCapability(
      conferred,
      member.organizationId,
      assignedByUserId,
      { memberId, roleSlug: roleDef.slug, roleDefinitionId },
    );

    // GATE 2 — no escalation: you cannot hand out what you do not hold.
    //
    // There is deliberately no bypass parameter on this path. The one
    // legitimate bootstrap (the first platform admin) runs through
    // PlatformGrantsService, which has its own audited bypass; a tenant role
    // assignment never needs one.
    await this.assertAssignerHoldsAtLeast(
      conferred,
      member.organizationId,
      assignedByUserId,
      roleDef.name,
    );

    // Check if already assigned
    const existing = await this.prisma.memberRole.findUnique({
      where: {
        organizationMemberId_roleDefinitionId: {
          organizationMemberId: memberId,
          roleDefinitionId,
        },
      },
    });
    if (existing) throw new ConflictException('Role already assigned to this member');

    // Enforce SoD constraints
    await this.checkConstraints(memberId, roleDefinitionId);

    // Enforce cardinality (maxPerOrg)
    if (roleDef.maxPerOrg !== null) {
      const count = await this.prisma.memberRole.count({
        where: {
          roleDefinitionId,
          organizationMember: { organizationId: member.organizationId },
        },
      });
      if (count >= roleDef.maxPerOrg) {
        throw new ConflictException(
          `Role "${roleDef.name}" is limited to ${roleDef.maxPerOrg} member(s) per organization`,
        );
      }
    }

    // Create assignment
    const memberRole = await this.prisma.memberRole.create({
      data: {
        organizationMemberId: memberId,
        roleDefinitionId,
        assignedByUserId,
        expiresAt: expiresAt ?? null,
      },
      include: {
        roleDefinition: true,
        assignedBy: { select: { fullName: true } },
      },
    });

    // Invalidate cache
    await this.cache.invalidateForMember(memberId);

    // Audit
    await this.audit.log({
      organizationId: member.organizationId,
      actorUserId: assignedByUserId,
      actorType: 'user',
      action: 'role.assigned',
      entityType: 'member_role',
      entityId: memberRole.id,
      metadata: {
        memberId,
        roleSlug: roleDef.slug,
        roleName: roleDef.name,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });

    return {
      id: memberRole.id,
      roleDefinitionId: memberRole.roleDefinitionId,
      roleName: memberRole.roleDefinition.name,
      roleSlug: memberRole.roleDefinition.slug,
      isSystem: memberRole.roleDefinition.isSystem,
      assignedByUserId: memberRole.assignedByUserId,
      assignedByName: memberRole.assignedBy?.fullName ?? null,
      expiresAt: memberRole.expiresAt?.toISOString() ?? null,
      createdAt: memberRole.createdAt.toISOString(),
    };
  }

  /**
   * Remove a role from an organization member.
   */
  async removeRole(
    memberId: string,
    roleDefinitionId: string,
    removedByUserId: string,
  ): Promise<void> {
    const memberRole = await this.prisma.memberRole.findUnique({
      where: {
        organizationMemberId_roleDefinitionId: {
          organizationMemberId: memberId,
          roleDefinitionId,
        },
      },
      include: {
        organizationMember: { select: { organizationId: true } },
        roleDefinition: { select: { name: true, slug: true } },
      },
    });

    if (!memberRole) throw new NotFoundException('Role assignment not found');

    await this.prisma.memberRole.delete({ where: { id: memberRole.id } });

    // Invalidate cache
    await this.cache.invalidateForMember(memberId);

    // Audit
    await this.audit.log({
      organizationId: memberRole.organizationMember.organizationId,
      actorUserId: removedByUserId,
      actorType: 'user',
      action: 'role.removed',
      entityType: 'member_role',
      entityId: memberRole.id,
      metadata: {
        memberId,
        roleSlug: memberRole.roleDefinition.slug,
        roleName: memberRole.roleDefinition.name,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Get all role assignments for a member.
   */
  async getMemberRoles(memberId: string): Promise<MemberRoleAssignment[]> {
    const roles = await this.prisma.memberRole.findMany({
      where: { organizationMemberId: memberId },
      include: {
        roleDefinition: true,
        assignedBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return roles.map((r) => ({
      id: r.id,
      roleDefinitionId: r.roleDefinitionId,
      roleName: r.roleDefinition.name,
      roleSlug: r.roleDefinition.slug,
      isSystem: r.roleDefinition.isSystem,
      assignedByUserId: r.assignedByUserId,
      assignedByName: r.assignedBy?.fullName ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Get all members in an organization with their RBAC roles.
   */
  async getOrgMembersWithRoles(organizationId: string): Promise<MemberWithRoles[]> {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: { select: { email: true, fullName: true } },
        memberRoles: {
          include: {
            roleDefinition: true,
            assignedBy: { select: { fullName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      organizationId: m.organizationId,
      userId: m.userId,
      email: m.user.email,
      fullName: m.user.fullName,
      legacyRole: m.role,
      status: m.status,
      roles: m.memberRoles.map((mr) => ({
        id: mr.id,
        roleDefinitionId: mr.roleDefinitionId,
        roleName: mr.roleDefinition.name,
        roleSlug: mr.roleDefinition.slug,
        isSystem: mr.roleDefinition.isSystem,
        assignedByUserId: mr.assignedByUserId,
        assignedByName: mr.assignedBy?.fullName ?? null,
        expiresAt: mr.expiresAt?.toISOString() ?? null,
        createdAt: mr.createdAt.toISOString(),
      })),
      createdAt: m.createdAt.toISOString(),
    }));
  }

  /**
   * List all role definitions (system + org-scoped).
   */
  async listRoleDefinitions(organizationId?: string): Promise<
    Array<{
      id: string;
      organizationId: string | null;
      name: string;
      slug: string;
      description: string | null;
      isSystem: boolean;
      requiresMfa: boolean;
      maxPerOrg: number | null;
      permissionCount: number;
      memberCount: number;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    const where = organizationId
      ? { OR: [{ isSystem: true, organizationId: null }, { organizationId }] }
      : { isSystem: true, organizationId: null };

    const roles = await this.prisma.roleDefinition.findMany({
      where,
      include: {
        _count: {
          select: {
            rolePermissions: true,
            memberRoles: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return roles.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      name: r.name,
      slug: r.slug,
      description: r.description,
      isSystem: r.isSystem,
      requiresMfa: r.requiresMfa,
      maxPerOrg: r.maxPerOrg,
      permissionCount: r._count.rolePermissions,
      memberCount: r._count.memberRoles,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /**
   * Get a role definition by ID with its permissions.
   */
  async getRoleDefinitionById(roleId: string) {
    const role = await this.prisma.roleDefinition.findUnique({
      where: { id: roleId },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
        _count: { select: { memberRoles: true } },
      },
    });

    if (!role) throw new NotFoundException('Role definition not found');

    return {
      id: role.id,
      organizationId: role.organizationId,
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystem: role.isSystem,
      requiresMfa: role.requiresMfa,
      maxPerOrg: role.maxPerOrg,
      permissions: role.rolePermissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        resource: rp.permission.resource,
        action: rp.permission.action,
        category: rp.permission.category,
        description: rp.permission.description,
        isSystem: rp.permission.isSystem,
      })),
      memberCount: role._count.memberRoles,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Custom Role CRUD
  // -----------------------------------------------------------------------

  /**
   * Create a custom (org-scoped) role.
   */
  async createCustomRole(
    organizationId: string,
    dto: CreateCustomRoleDto,
    createdByUserId: string,
  ) {
    // Validate slug uniqueness within this org + system roles
    const existing = await this.prisma.roleDefinition.findFirst({
      where: {
        slug: dto.slug,
        OR: [{ organizationId }, { organizationId: null, isSystem: true }],
      },
    });
    if (existing) {
      throw new ConflictException(`A role with slug "${dto.slug}" already exists`);
    }

    // Validate all permission IDs exist
    const permissions = await this.prisma.permission.findMany({
      where: { id: { in: dto.permissionIds } },
      select: { id: true, code: true },
    });
    if (permissions.length !== dto.permissionIds.length) {
      const foundIds = new Set(permissions.map((p) => p.id));
      const missing = dto.permissionIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Invalid permission IDs: ${missing.join(', ')}`);
    }

    // An org role is a workspace role by construction, so it may not carry
    // platform capability. Without this, `roles:create` (held by every
    // workspace owner) is just a slower route to the same escalation as
    // assigning the system admin role.
    await this.assertConfersNoPlatformCapability(
      permissions.map((p) => p.code),
      organizationId,
      createdByUserId,
      { roleSlug: dto.slug, roleName: dto.name },
    );

    // Create role + permission links in a transaction
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.roleDefinition.create({
        data: {
          organizationId,
          name: dto.name,
          slug: dto.slug,
          description: dto.description ?? null,
          isSystem: false,
          requiresMfa: dto.requiresMfa ?? false,
          maxPerOrg: dto.maxPerOrg ?? null,
        },
      });

      await tx.rolePermission.createMany({
        data: dto.permissionIds.map((permissionId) => ({
          roleId: created.id,
          permissionId,
        })),
      });

      return created;
    });

    // Audit
    await this.audit.log({
      organizationId,
      actorUserId: createdByUserId,
      actorType: 'user',
      action: 'role.created',
      entityType: 'role_definition',
      entityId: role.id,
      metadata: {
        name: dto.name,
        slug: dto.slug,
        permissionCount: dto.permissionIds.length,
      },
    });

    return this.getRoleDefinitionById(role.id);
  }

  /**
   * Update a custom (non-system) role.
   */
  async updateCustomRole(
    roleId: string,
    dto: UpdateCustomRoleDto,
    updatedByUserId: string,
  ) {
    const role = await this.prisma.roleDefinition.findUnique({
      where: { id: roleId },
    });
    if (!role) throw new NotFoundException('Role definition not found');
    if (role.isSystem) {
      throw new BadRequestException('System roles cannot be modified');
    }

    // Validate permission IDs if provided
    if (dto.permissionIds) {
      const permissions = await this.prisma.permission.findMany({
        where: { id: { in: dto.permissionIds } },
        select: { id: true, code: true },
      });
      if (permissions.length !== dto.permissionIds.length) {
        const foundIds = new Set(permissions.map((p) => p.id));
        const missing = dto.permissionIds.filter((id) => !foundIds.has(id));
        throw new BadRequestException(`Invalid permission IDs: ${missing.join(', ')}`);
      }

      // Validate what the role WOULD confer after this edit: the proposed
      // codes plus anything reachable through its hierarchy children.
      await this.assertConfersNoPlatformCapability(
        [
          ...permissions.map((p) => p.code),
          ...(await this.resolveInheritedCodes(roleId)),
        ],
        role.organizationId ?? 'unknown',
        updatedByUserId,
        { roleSlug: role.slug, roleName: role.name, roleDefinitionId: roleId },
      );
    }

    // Update in transaction
    await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.RoleDefinitionUpdateInput = {};
      if (dto.name !== undefined) updateData.name = dto.name;
      if (dto.description !== undefined) updateData.description = dto.description;
      if (dto.requiresMfa !== undefined) updateData.requiresMfa = dto.requiresMfa;
      if (dto.maxPerOrg !== undefined) updateData.maxPerOrg = dto.maxPerOrg;

      if (Object.keys(updateData).length > 0) {
        await tx.roleDefinition.update({ where: { id: roleId }, data: updateData });
      }

      // Replace permissions if provided
      if (dto.permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: dto.permissionIds.map((permissionId) => ({
            roleId,
            permissionId,
          })),
        });
      }
    });

    // Invalidate cache for all members holding this role
    await this.cache.invalidateForRole(roleId);

    // Audit
    await this.audit.log({
      organizationId: role.organizationId ?? undefined,
      actorUserId: updatedByUserId,
      actorType: 'user',
      action: 'role.updated',
      entityType: 'role_definition',
      entityId: roleId,
      metadata: {
        name: dto.name ?? role.name,
        changes: Object.keys(dto).filter(
          (k) => (dto as Record<string, unknown>)[k] !== undefined,
        ),
      },
    });

    return this.getRoleDefinitionById(roleId);
  }

  /**
   * Delete a custom (non-system) role.
   * Fails if any members currently hold this role.
   */
  async deleteCustomRole(roleId: string, deletedByUserId: string): Promise<void> {
    const role = await this.prisma.roleDefinition.findUnique({
      where: { id: roleId },
      include: { _count: { select: { memberRoles: true } } },
    });
    if (!role) throw new NotFoundException('Role definition not found');
    if (role.isSystem) {
      throw new BadRequestException('System roles cannot be deleted');
    }
    if (role._count.memberRoles > 0) {
      throw new ConflictException(
        `Cannot delete role "${role.name}" — ${role._count.memberRoles} member(s) still hold this role. Remove all assignments first.`,
      );
    }

    // Delete permission links + role in transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.roleConstraint.deleteMany({
        where: { OR: [{ roleAId: roleId }, { roleBId: roleId }] },
      });
      await tx.roleHierarchy.deleteMany({
        where: { OR: [{ parentRoleId: roleId }, { childRoleId: roleId }] },
      });
      await tx.roleDefinition.delete({ where: { id: roleId } });
    });

    // Audit
    await this.audit.log({
      organizationId: role.organizationId ?? undefined,
      actorUserId: deletedByUserId,
      actorType: 'user',
      action: 'role.deleted',
      entityType: 'role_definition',
      entityId: roleId,
      metadata: { name: role.name, slug: role.slug },
    });
  }

  // -----------------------------------------------------------------------
  // Paginated Members Query
  // -----------------------------------------------------------------------

  /**
   * Get org members with roles, supporting cursor pagination, search, and role filter.
   */
  async getOrgMembersWithRolesPaginated(
    organizationId: string,
    opts: { cursor?: string; limit?: number; search?: string; roleSlug?: string },
  ): Promise<{ items: MemberWithRoles[]; meta: { hasNext: boolean; nextCursor?: string } }> {
    const limit = opts.limit ?? 20;

    const where: Prisma.OrganizationMemberWhereInput = { organizationId };

    // Search by name or email
    if (opts.search) {
      where.user = {
        OR: [
          { fullName: { contains: opts.search, mode: 'insensitive' } },
          { email: { contains: opts.search, mode: 'insensitive' } },
        ],
      };
    }

    // Filter by role slug
    if (opts.roleSlug) {
      where.memberRoles = {
        some: { roleDefinition: { slug: opts.roleSlug } },
      };
    }

    const members = await this.prisma.organizationMember.findMany({
      where,
      take: limit + 1,
      ...(opts.cursor && { skip: 1, cursor: { id: opts.cursor } }),
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { email: true, fullName: true } },
        memberRoles: {
          include: {
            roleDefinition: true,
            assignedBy: { select: { fullName: true } },
          },
        },
      },
    });

    const hasNext = members.length > limit;
    const items = hasNext ? members.slice(0, limit) : members;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items: items.map((m) => ({
        id: m.id,
        organizationId: m.organizationId,
        userId: m.userId,
        email: m.user.email,
        fullName: m.user.fullName,
        legacyRole: m.role,
        status: m.status,
        roles: m.memberRoles.map((mr) => ({
          id: mr.id,
          roleDefinitionId: mr.roleDefinitionId,
          roleName: mr.roleDefinition.name,
          roleSlug: mr.roleDefinition.slug,
          isSystem: mr.roleDefinition.isSystem,
          assignedByUserId: mr.assignedByUserId,
          assignedByName: mr.assignedBy?.fullName ?? null,
          expiresAt: mr.expiresAt?.toISOString() ?? null,
          createdAt: mr.createdAt.toISOString(),
        })),
        createdAt: m.createdAt.toISOString(),
      })),
      meta: { hasNext, nextCursor },
    };
  }

  // -----------------------------------------------------------------------
  // Hierarchy
  // -----------------------------------------------------------------------

  /** Get all hierarchy edges. */
  async getHierarchyEdges(): Promise<RoleHierarchyEdge[]> {
    const edges = await this.prisma.roleHierarchy.findMany({
      include: {
        parentRole: { select: { name: true } },
        childRole: { select: { name: true } },
      },
    });

    return edges.map((e) => ({
      id: e.id,
      parentRoleId: e.parentRoleId,
      parentRoleName: e.parentRole.name,
      childRoleId: e.childRoleId,
      childRoleName: e.childRole.name,
    }));
  }

  /** Build the full hierarchy tree starting from root roles. */
  async getHierarchyTree(): Promise<RoleHierarchyNode[]> {
    const [roles, edges] = await Promise.all([
      this.prisma.roleDefinition.findMany({
        where: { isSystem: true, organizationId: null },
        select: { id: true, name: true, slug: true },
      }),
      this.prisma.roleHierarchy.findMany({
        select: { parentRoleId: true, childRoleId: true },
      }),
    ]);

    // Build adjacency: parent → children
    const childrenOf = new Map<string, string[]>();
    const hasParent = new Set<string>();
    for (const edge of edges) {
      const arr = childrenOf.get(edge.parentRoleId) ?? [];
      arr.push(edge.childRoleId);
      childrenOf.set(edge.parentRoleId, arr);
      hasParent.add(edge.childRoleId);
    }

    // Role lookup
    const roleMap = new Map(roles.map((r) => [r.id, r]));

    // Root roles = those with no parent
    const rootIds = roles.filter((r) => !hasParent.has(r.id)).map((r) => r.id);

    function buildNode(roleId: string): RoleHierarchyNode | null {
      const role = roleMap.get(roleId);
      if (!role) return null;
      const childIds = childrenOf.get(roleId) ?? [];
      return {
        id: roleId,
        roleId: role.id,
        roleName: role.name,
        roleSlug: role.slug,
        children: childIds
          .map(buildNode)
          .filter((n): n is RoleHierarchyNode => n !== null),
      };
    }

    return rootIds
      .map(buildNode)
      .filter((n): n is RoleHierarchyNode => n !== null);
  }

  // -----------------------------------------------------------------------
  // Constraints
  // -----------------------------------------------------------------------

  /** List all role constraints. */
  async listConstraints(): Promise<RbacConstraint[]> {
    const constraints = await this.prisma.roleConstraint.findMany({
      include: {
        roleA: { select: { name: true, slug: true } },
        roleB: { select: { name: true, slug: true } },
      },
    });

    return constraints.map((c) => ({
      id: c.id,
      roleAId: c.roleAId,
      roleAName: c.roleA.name,
      roleASlug: c.roleA.slug,
      roleBId: c.roleBId,
      roleBName: c.roleB.name,
      roleBSlug: c.roleB.slug,
      constraintType: c.constraintType as RbacConstraint['constraintType'],
    }));
  }

  /**
   * Check SoD and cardinality constraints before assigning a role.
   * Throws ConflictException if a constraint is violated.
   */
  async checkConstraints(memberId: string, roleDefinitionId: string): Promise<void> {
    // Load member's current roles
    const currentRoles = await this.prisma.memberRole.findMany({
      where: { organizationMemberId: memberId },
      select: { roleDefinitionId: true },
    });
    const currentRoleIds = new Set(currentRoles.map((r) => r.roleDefinitionId));

    // Load constraints involving the candidate role
    const constraints = await this.prisma.roleConstraint.findMany({
      where: {
        OR: [
          { roleAId: roleDefinitionId },
          { roleBId: roleDefinitionId },
        ],
      },
      include: {
        roleA: { select: { name: true, slug: true } },
        roleB: { select: { name: true, slug: true } },
      },
    });

    for (const constraint of constraints) {
      if (constraint.constraintType === 'mutually_exclusive') {
        // Check if member already holds the conflicting role
        const conflictingId =
          constraint.roleAId === roleDefinitionId
            ? constraint.roleBId
            : constraint.roleAId;

        if (currentRoleIds.has(conflictingId)) {
          const conflictingRole =
            constraint.roleAId === roleDefinitionId
              ? constraint.roleB
              : constraint.roleA;
          const candidateRole =
            constraint.roleAId === roleDefinitionId
              ? constraint.roleA
              : constraint.roleB;

          throw new ConflictException(
            `Cannot assign "${candidateRole.name}" — it is mutually exclusive with "${conflictingRole.name}" (separation of duties)`,
          );
        }
      }
    }
  }
}

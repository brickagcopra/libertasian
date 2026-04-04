import {
  BadRequestException,
  ConflictException,
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
import { RbacCacheService } from './rbac-cache.service';
import type { CreateCustomRoleDto, UpdateCustomRoleDto } from './dto';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RbacCacheService,
    private readonly audit: AuditService,
  ) {}

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
      select: { id: true },
    });
    if (permissions.length !== dto.permissionIds.length) {
      const foundIds = new Set(permissions.map((p) => p.id));
      const missing = dto.permissionIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Invalid permission IDs: ${missing.join(', ')}`);
    }

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
        select: { id: true },
      });
      if (permissions.length !== dto.permissionIds.length) {
        const foundIds = new Set(permissions.map((p) => p.id));
        const missing = dto.permissionIds.filter((id) => !foundIds.has(id));
        throw new BadRequestException(`Invalid permission IDs: ${missing.join(', ')}`);
      }
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

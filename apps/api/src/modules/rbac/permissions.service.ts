import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RbacCacheService } from './rbac-cache.service';

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RbacCacheService,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Resolve the complete set of effective permission codes for an org member.
   *
   * Resolution order:
   * 1. Check Redis cache → return if hit
   * 2. Load all role IDs assigned to the member (filter expired)
   * 3. For each role, collect inherited roles via BFS on the hierarchy DAG
   * 4. Union all permission codes from direct + inherited roles
   * 5. Store in cache
   */
  async getEffectivePermissions(memberId: string): Promise<string[]> {
    // 1. Cache hit?
    const cached = await this.cache.getCachedPermissions(memberId);
    if (cached !== null) return cached;

    // 2. Load assigned role IDs (exclude expired)
    const memberRoles = await this.prisma.memberRole.findMany({
      where: {
        organizationMemberId: memberId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: { roleDefinitionId: true },
    });

    const directRoleIds = memberRoles.map((mr) => mr.roleDefinitionId);

    if (directRoleIds.length === 0) {
      await this.cache.setCachedPermissions(memberId, []);
      return [];
    }

    // 3. Expand roles via hierarchy (BFS — parent inherits child permissions)
    const allRoleIds = await this.expandRolesViaHierarchy(directRoleIds);

    // 4. Fetch distinct permission codes for all resolved roles
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { roleId: { in: allRoleIds } },
      select: {
        permission: { select: { code: true } },
      },
    });

    const permissions = [...new Set(rolePermissions.map((rp) => rp.permission.code))];

    // 5. Cache and return
    await this.cache.setCachedPermissions(memberId, permissions);
    return permissions;
  }

  /**
   * Check if a member has a specific permission.
   */
  async hasPermission(memberId: string, permissionCode: string): Promise<boolean> {
    const permissions = await this.getEffectivePermissions(memberId);
    return permissions.includes(permissionCode);
  }

  /**
   * Check if a member has ANY of the given permissions.
   */
  async hasAnyPermission(memberId: string, permissionCodes: string[]): Promise<boolean> {
    const permissions = await this.getEffectivePermissions(memberId);
    return permissionCodes.some((code) => permissions.includes(code));
  }

  /**
   * Check if a member has ALL of the given permissions.
   */
  async hasAllPermissions(memberId: string, permissionCodes: string[]): Promise<boolean> {
    const permissions = await this.getEffectivePermissions(memberId);
    return permissionCodes.every((code) => permissions.includes(code));
  }

  /**
   * Resolve the member ID for a user in a specific organization.
   * Returns null if the user is not an active member.
   */
  async resolveMemberId(userId: string, organizationId: string): Promise<string | null> {
    const member = await this.prisma.organizationMember.findFirst({
      where: { userId, organizationId, status: 'active' },
      select: { id: true },
    });
    return member?.id ?? null;
  }

  /**
   * Get all permissions, optionally filtered by category or resource.
   */
  async getAllPermissions(filters?: {
    category?: string;
    resource?: string;
  }): Promise<
    Array<{ id: string; code: string; resource: string; action: string; category: string; description: string | null }>
  > {
    const where: Prisma.PermissionWhereInput = {};
    if (filters?.category) where.category = filters.category;
    if (filters?.resource) where.resource = filters.resource;

    return this.prisma.permission.findMany({
      where,
      orderBy: [{ category: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
    });
  }

  /**
   * Get a single permission by its code (e.g. "documents:read").
   */
  async getPermissionByCode(code: string) {
    const permission = await this.prisma.permission.findUnique({
      where: { code },
      include: {
        rolePermissions: {
          include: {
            role: { select: { id: true, name: true, slug: true, isSystem: true } },
          },
        },
      },
    });

    if (!permission) throw new NotFoundException(`Permission "${code}" not found`);

    return {
      id: permission.id,
      code: permission.code,
      resource: permission.resource,
      action: permission.action,
      category: permission.category,
      description: permission.description,
      isSystem: permission.isSystem,
      roles: permission.rolePermissions.map((rp) => ({
        id: rp.role.id,
        name: rp.role.name,
        slug: rp.role.slug,
        isSystem: rp.role.isSystem,
      })),
    };
  }

  // -----------------------------------------------------------------------
  // Hierarchy BFS
  // -----------------------------------------------------------------------

  /**
   * Expand a set of role IDs by following the hierarchy DAG downward.
   *
   * In our NIST RBAC model, parent roles inherit the permissions of their
   * children. E.g. if "owner" is parent of "admin" and "admin" is parent of
   * "editor", then a member with the "owner" role inherits admin + editor
   * permissions.
   *
   * BFS walks from each direct role down through child edges.
   */
  private async expandRolesViaHierarchy(directRoleIds: string[]): Promise<string[]> {
    // Load entire hierarchy (small table, <50 rows typical)
    const edges = await this.prisma.roleHierarchy.findMany({
      select: { parentRoleId: true, childRoleId: true },
    });

    // Build adjacency list: parent → children[]
    const childrenOf = new Map<string, string[]>();
    for (const edge of edges) {
      const children = childrenOf.get(edge.parentRoleId) ?? [];
      children.push(edge.childRoleId);
      childrenOf.set(edge.parentRoleId, children);
    }

    // BFS from each direct role
    const visited = new Set<string>(directRoleIds);
    const queue = [...directRoleIds];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = childrenOf.get(current) ?? [];
      for (const childId of children) {
        if (!visited.has(childId)) {
          visited.add(childId);
          queue.push(childId);
        }
      }
    }

    return [...visited];
  }
}

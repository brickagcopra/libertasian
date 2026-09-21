import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from './permissions.service';
import { RbacCacheService } from './rbac-cache.service';
import type { CreatePlatformRoleDto, UpdatePlatformRoleDto } from './dto';

/** A user who holds at least one platform grant. */
export interface PlatformStaffUser {
  userId: string;
  fullName: string;
  email: string;
}

/** One row of the staff list: a single grant, with who made it and when it lapses. */
export interface PlatformGrantRow {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  roleDefinitionId: string;
  roleName: string;
  roleSlug: string;
  isSystemRole: boolean;
  grantedByUserId: string | null;
  grantedByName: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** Effective permission codes this one role confers (hierarchy expanded). */
  permissions: string[];
}

/**
 * Every action this service audits. The staff panel's trail is exactly these
 * rows — including the refusals, so an operator can see a blocked escalation
 * attempt rather than only the grants that succeeded.
 */
export const PLATFORM_AUDIT_ACTIONS = [
  'platform_grant.created',
  'platform_grant.revoked',
  'platform_grant.refused',
  'platform_role.created',
  'platform_role.updated',
  'platform_role.deleted',
  'platform_role.refused',
] as const;

/** One row of the staff panel's audit trail. */
export interface PlatformAuditEntry {
  id: string;
  action: string;
  /** What actually happened, for the panel's badge. */
  outcome: 'granted' | 'revoked' | 'refused' | 'role_changed';
  actorUserId: string | null;
  actorName: string | null;
  /** Redacted — never a full address (CLAUDE.md: no PII in plaintext). */
  actorEmail: string | null;
  targetUserId: string | null;
  targetName: string | null;
  /** Redacted. */
  targetEmail: string | null;
  roleSlug: string | null;
  roleName: string | null;
  expiresAt: string | null;
  /** Which rule refused this, when one did. */
  refusal: string | null;
  /** The refusal message the operator was shown, verbatim. */
  reason: string | null;
  createdAt: string;
}

interface GrantOptions {
  /**
   * Skip the no-privilege-escalation check. Reserved for the interactive
   * bootstrap CLI, which has to be able to create the FIRST admin — at that
   * point no human holds anything to be a superset of. Never set from an HTTP
   * path; the audit row records it either way.
   */
  bypassEscalationCheck?: boolean;
  /** Free-text note about where the grant came from, written to the audit row. */
  source?: string;
}

/** Redact an email for logs: "jane.doe@example.com" → "j***@example.com". */
function redactEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.charAt(0)}***@${domain}`;
}

/** Read a string field out of an audit row's JSON metadata, or null. */
function readString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/** Collapse an audit action into the outcome the panel badges. */
function outcomeOf(action: string): PlatformAuditEntry['outcome'] {
  if (action.endsWith('.refused')) return 'refused';
  if (action === 'platform_grant.created') return 'granted';
  if (action === 'platform_grant.revoked') return 'revoked';
  return 'role_changed';
}

/**
 * Platform capability: roles granted to a PERSON, with no organization
 * anywhere in the model.
 *
 * Why this exists separately from RolesService: every tenant authorization
 * path is keyed on an `organization_members` row, and login picks a user's
 * OLDEST membership with no org-switch endpoint — so a user's JWT
 * organization is permanently their personal workspace. An org-scoped role
 * can therefore never express "this person administers the platform".
 *
 * Permission resolution here expands `role_hierarchy` through
 * PermissionsService.resolvePermissionCodes — the same call tenant resolution
 * uses — and drops expired grants, exactly like getEffectivePermissions.
 */
@Injectable()
export class PlatformGrantsService {
  private readonly logger = new Logger(PlatformGrantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RbacCacheService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  // -----------------------------------------------------------------------
  // Resolution
  // -----------------------------------------------------------------------

  /**
   * Effective platform permission codes for a user.
   *
   * Grants whose `expires_at` has passed are excluded here rather than being
   * deleted, so an expired grant stops conferring access the moment it lapses
   * (subject to the 5-minute cache TTL) while remaining visible in the panel.
   */
  async getPlatformPermissions(userId: string): Promise<string[]> {
    const cached = await this.cache.getCachedPlatformPermissions(userId);
    if (cached !== null) return cached;

    const grants = await this.prisma.platformRoleGrant.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { roleDefinitionId: true },
    });

    const permissions = await this.permissions.resolvePermissionCodes(
      grants.map((g) => g.roleDefinitionId),
    );

    await this.cache.setCachedPlatformPermissions(userId, permissions);
    return permissions;
  }

  /** Does this user hold `code` as a platform capability? */
  async hasPlatformPermission(userId: string, code: string): Promise<boolean> {
    const permissions = await this.getPlatformPermissions(userId);
    return permissions.includes(code);
  }

  /** Does this user hold ANY of `codes` as a platform capability? */
  async hasAnyPlatformPermission(
    userId: string,
    codes: string[],
  ): Promise<boolean> {
    const permissions = await this.getPlatformPermissions(userId);
    return codes.some((c) => permissions.includes(c));
  }

  /** Does this user hold ALL of `codes` as a platform capability? */
  async hasAllPlatformPermissions(
    userId: string,
    codes: string[],
  ): Promise<boolean> {
    const permissions = await this.getPlatformPermissions(userId);
    return codes.every((c) => permissions.includes(c));
  }

  /**
   * Every user whose platform permissions include `code`.
   *
   * Returns USER ids. `digests.assigned_reviewer_user_id` is a user id, not a
   * member id — returning member ids here assigns every digest to nobody, and
   * does it silently.
   *
   * This deliberately re-uses getPlatformPermissions per holder rather than
   * running its own role→permission query: the reviewer dropdown and the
   * assignment validator must never be able to disagree about who can review.
   * The holder set is small (staff, not users), so the per-user cache makes
   * this a handful of Redis reads.
   */
  async listUsersWithPlatformPermission(
    code: string,
  ): Promise<PlatformStaffUser[]> {
    const holders = await this.prisma.platformRoleGrant.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      distinct: ['userId'],
      select: {
        userId: true,
        user: { select: { fullName: true, email: true } },
      },
      orderBy: { userId: 'asc' },
    });

    const matches: PlatformStaffUser[] = [];
    for (const holder of holders) {
      const permissions = await this.getPlatformPermissions(holder.userId);
      if (permissions.includes(code)) {
        matches.push({
          userId: holder.userId,
          fullName: holder.user.fullName,
          email: holder.user.email,
        });
      }
    }

    return matches.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  // -----------------------------------------------------------------------
  // Staff list / search
  // -----------------------------------------------------------------------

  /** Current grants, cursor-paginated. Includes expired ones, flagged by date. */
  async listGrants(opts: {
    cursor?: string;
    limit?: number;
  }): Promise<{
    items: PlatformGrantRow[];
    meta: { hasNext: boolean; nextCursor?: string; limit: number };
  }> {
    const limit = opts.limit ?? 20;

    const grants = await this.prisma.platformRoleGrant.findMany({
      take: limit + 1,
      ...(opts.cursor && { skip: 1, cursor: { id: opts.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        roleDefinition: {
          select: { id: true, name: true, slug: true, isSystem: true },
        },
        grantedBy: { select: { fullName: true } },
      },
    });

    const hasNext = grants.length > limit;
    const page = hasNext ? grants.slice(0, limit) : grants;

    // Resolve each distinct role's effective permission set once, so the panel
    // can show "permissions this grants" without an extra round-trip per row.
    const permissionsByRole = new Map<string, string[]>();
    for (const roleId of new Set(page.map((g) => g.roleDefinitionId))) {
      permissionsByRole.set(
        roleId,
        (await this.permissions.resolvePermissionCodes([roleId])).sort(),
      );
    }

    const lastItem = page[page.length - 1];

    return {
      items: page.map((g) => ({
        id: g.id,
        userId: g.userId,
        fullName: g.user.fullName,
        email: g.user.email,
        roleDefinitionId: g.roleDefinitionId,
        roleName: g.roleDefinition.name,
        roleSlug: g.roleDefinition.slug,
        isSystemRole: g.roleDefinition.isSystem,
        grantedByUserId: g.grantedByUserId,
        grantedByName: g.grantedBy?.fullName ?? null,
        expiresAt: g.expiresAt?.toISOString() ?? null,
        createdAt: g.createdAt.toISOString(),
        permissions: permissionsByRole.get(g.roleDefinitionId) ?? [],
      })),
      meta: {
        hasNext,
        ...(hasNext && lastItem ? { nextCursor: lastItem.id } : {}),
        limit,
      },
    };
  }

  /**
   * Search EXISTING users by email or name.
   *
   * CARVE-OUT: platform staff administration — cross-tenant by design. Staff
   * belong to no organization, so candidate search cannot be org-scoped.
   * Guarded by platform-staff:manage.
   *
   * This never creates a user and never sends an invitation: if a person has
   * no account, they sign up themselves first.
   */
  async searchCandidates(
    query: string,
    limit = 10,
  ): Promise<Array<PlatformStaffUser & { status: string }>> {
    const users = await this.prisma.user.findMany({
      where: {
        status: 'active',
        deletedAt: null,
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { fullName: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, email: true, status: true },
    });

    return users.map((u) => ({
      userId: u.id,
      fullName: u.fullName,
      email: u.email,
      status: u.status,
    }));
  }

  /** All grants held by one user (including lapsed ones). */
  async getGrantsForUser(userId: string): Promise<PlatformGrantRow[]> {
    const grants = await this.prisma.platformRoleGrant.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        roleDefinition: {
          select: { id: true, name: true, slug: true, isSystem: true },
        },
        grantedBy: { select: { fullName: true } },
      },
    });

    const rows: PlatformGrantRow[] = [];
    for (const g of grants) {
      rows.push({
        id: g.id,
        userId: g.userId,
        fullName: g.user.fullName,
        email: g.user.email,
        roleDefinitionId: g.roleDefinitionId,
        roleName: g.roleDefinition.name,
        roleSlug: g.roleDefinition.slug,
        isSystemRole: g.roleDefinition.isSystem,
        grantedByUserId: g.grantedByUserId,
        grantedByName: g.grantedBy?.fullName ?? null,
        expiresAt: g.expiresAt?.toISOString() ?? null,
        createdAt: g.createdAt.toISOString(),
        permissions: (
          await this.permissions.resolvePermissionCodes([g.roleDefinitionId])
        ).sort(),
      });
    }
    return rows;
  }

  // -----------------------------------------------------------------------
  // Audit trail
  // -----------------------------------------------------------------------

  /**
   * The grant/revoke/refusal history, for the staff panel.
   *
   * Served from here rather than sending the operator to /rbac/audit-logs:
   * that surface is TenantGuard + SubscriptionGuard + `audit-logs:read`, a
   * permission held only by admin, owner and admin-manager. A platform-only
   * admin on a free personal workspace fails the plan gate AND the org-scoped
   * permission — so the one page that shows platform-grant history would be
   * shut to the people who administer platform grants.
   *
   * CARVE-OUT: platform staff administration — cross-tenant by design. These
   * rows describe grants that belong to no organization, so they are read
   * without an organizationId filter. Guarded by platform-staff:manage.
   */
  async listAuditTrail(opts: {
    cursor?: string;
    limit?: number;
  }): Promise<{
    items: PlatformAuditEntry[];
    meta: { hasNext: boolean; nextCursor?: string; limit: number };
  }> {
    const limit = opts.limit ?? 25;

    const rows = await this.prisma.auditLog.findMany({
      where: { action: { in: [...PLATFORM_AUDIT_ACTIONS] } },
      take: limit + 1,
      ...(opts.cursor && { skip: 1, cursor: { id: opts.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, fullName: true, email: true } },
      },
    });

    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;

    // Resolve target display names in one query. The metadata already carries
    // a REDACTED email (the service redacts before writing), so nothing here
    // un-redacts anything — it only adds the name.
    const targetIds = [
      ...new Set(
        page
          .map((r) => readString(r.metadataJson, 'targetUserId'))
          .filter((id): id is string => id !== null),
      ),
    ];
    const targets = targetIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameByUserId = new Map(targets.map((t) => [t.id, t.fullName]));

    const lastItem = page[page.length - 1];

    return {
      items: page.map((row) => {
        const targetUserId = readString(row.metadataJson, 'targetUserId');
        return {
          id: row.id,
          action: row.action,
          outcome: outcomeOf(row.action),
          actorUserId: row.actorUserId,
          actorName: row.actor?.fullName ?? null,
          actorEmail: row.actor?.email ? redactEmail(row.actor.email) : null,
          targetUserId,
          targetName: targetUserId
            ? (nameByUserId.get(targetUserId) ?? null)
            : null,
          // Already redacted at write time; passed through as-is.
          targetEmail: readString(row.metadataJson, 'targetEmail'),
          roleSlug:
            readString(row.metadataJson, 'roleSlug') ??
            readString(row.metadataJson, 'slug'),
          roleName:
            readString(row.metadataJson, 'roleName') ??
            readString(row.metadataJson, 'name'),
          expiresAt: readString(row.metadataJson, 'expiresAt'),
          refusal: readString(row.metadataJson, 'refusal'),
          reason: readString(row.metadataJson, 'reason'),
          createdAt: row.createdAt.toISOString(),
        };
      }),
      meta: {
        hasNext,
        ...(hasNext && lastItem ? { nextCursor: lastItem.id } : {}),
        limit,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Grant / revoke
  // -----------------------------------------------------------------------

  /**
   * Grant a platform role to a user.
   *
   * Enforced in order, each refusal audited with its reason:
   *   a. no privilege escalation — the role's effective permissions must be a
   *      SUBSET of the actor's own effective platform permissions;
   *   b. separation of duties — role_constraints, ported to the user-keyed model;
   *   c. cardinality — role_definitions.max_per_org as a platform-wide cap;
   *   d. scope — only system or platform-scope (organization_id IS NULL) roles.
   */
  async grant(
    targetUserId: string,
    roleDefinitionId: string,
    actorUserId: string | null,
    expiresAt?: Date,
    options: GrantOptions = {},
  ): Promise<PlatformGrantRow> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, fullName: true, email: true, status: true },
    });
    if (!target) {
      throw new NotFoundException(
        'User not found. Platform roles are granted to existing accounts only — ask the person to sign up first.',
      );
    }

    const roleDef = await this.prisma.roleDefinition.findUnique({
      where: { id: roleDefinitionId },
      select: {
        id: true,
        name: true,
        slug: true,
        isSystem: true,
        organizationId: true,
        maxPerOrg: true,
      },
    });
    if (!roleDef) throw new NotFoundException('Role definition not found');

    const existing = await this.prisma.platformRoleGrant.findUnique({
      where: {
        userId_roleDefinitionId: { userId: targetUserId, roleDefinitionId },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        `${target.fullName} already holds the platform role "${roleDef.name}".`,
      );
    }

    const rolePermissions =
      await this.permissions.resolvePermissionCodes([roleDefinitionId]);

    // --- a. NO PRIVILEGE ESCALATION -------------------------------------
    // An actor may only hand out capability they themselves hold. Without
    // this, anyone with platform-staff:manage can mint themselves a
    // superadmin role by granting it to a second account they control.
    if (!options.bypassEscalationCheck) {
      const actorPermissions = actorUserId
        ? await this.getPlatformPermissions(actorUserId)
        : [];
      const missing = rolePermissions.filter(
        (c) => !actorPermissions.includes(c),
      );
      if (missing.length > 0) {
        const reason = `Privilege escalation refused: "${roleDef.name}" confers ${missing.length} permission(s) you do not hold — ${missing.sort().slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}. You can only grant a role whose permissions are a subset of your own.`;
        await this.auditRefusal(
          'platform_grant.refused',
          actorUserId,
          targetUserId,
          roleDef.slug,
          'privilege_escalation',
          reason,
        );
        throw new ForbiddenException(reason);
      }
    }

    // --- b. SEPARATION OF DUTIES ----------------------------------------
    await this.checkPlatformConstraints(
      targetUserId,
      roleDefinitionId,
      actorUserId,
      roleDef.slug,
    );

    // --- c. CARDINALITY --------------------------------------------------
    // role_definitions.max_per_org is REINTERPRETED here as the maximum
    // number of PLATFORM holders of the role. There is no organization in
    // this model, so "per org" has no meaning; the column's intent — "at most
    // N people may hold this at once" — carries over exactly. Keeping the
    // column means a role's cap is still data, editable in the panel.
    if (roleDef.maxPerOrg !== null) {
      const holders = await this.prisma.platformRoleGrant.count({
        where: {
          roleDefinitionId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (holders >= roleDef.maxPerOrg) {
        const reason = `Cardinality refused: "${roleDef.name}" is limited to ${roleDef.maxPerOrg} platform holder(s) and already has ${holders}. Revoke one before granting another.`;
        await this.auditRefusal(
          'platform_grant.refused',
          actorUserId,
          targetUserId,
          roleDef.slug,
          'cardinality',
          reason,
        );
        throw new ConflictException(reason);
      }
    }

    // --- d. SCOPE --------------------------------------------------------
    // An org-custom role is a tenant artefact: its permissions were chosen by
    // that organization for its own members. Letting one become a platform
    // grant would let any org owner author platform capability.
    if (roleDef.organizationId !== null) {
      const reason = `Scope refused: "${roleDef.name}" is a custom role belonging to an organization. Only system roles and platform-scope roles (no organization) can be granted as platform capability.`;
      await this.auditRefusal(
        'platform_grant.refused',
        actorUserId,
        targetUserId,
        roleDef.slug,
        'org_scoped_role',
        reason,
      );
      throw new BadRequestException(reason);
    }

    const created = await this.prisma.platformRoleGrant.create({
      data: {
        userId: targetUserId,
        roleDefinitionId,
        grantedByUserId: actorUserId,
        expiresAt: expiresAt ?? null,
      },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        roleDefinition: {
          select: { id: true, name: true, slug: true, isSystem: true },
        },
        grantedBy: { select: { fullName: true } },
      },
    });

    await this.cache.invalidatePlatformForUser(targetUserId);

    await this.audit.log({
      actorUserId: actorUserId ?? undefined,
      actorType: actorUserId ? 'admin' : 'system',
      action: 'platform_grant.created',
      entityType: 'platform_role_grant',
      entityId: created.id,
      metadata: {
        targetUserId,
        targetEmail: redactEmail(target.email),
        roleSlug: roleDef.slug,
        roleName: roleDef.name,
        expiresAt: expiresAt?.toISOString() ?? null,
        permissionCount: rolePermissions.length,
        ...(options.source ? { source: options.source } : {}),
        ...(options.bypassEscalationCheck
          ? {
              escalationCheckBypassed: true,
              bypassNote:
                'BOOTSTRAP: granted without the no-escalation check. Only the interactive CLI may do this.',
            }
          : {}),
      },
    });

    if (options.bypassEscalationCheck) {
      this.logger.warn(
        `BOOTSTRAP GRANT: "${roleDef.slug}" granted to ${redactEmail(target.email)} WITHOUT the no-privilege-escalation check (source: ${options.source ?? 'unknown'}). Every later grant must go through the staff panel.`,
      );
    }

    this.logger.log(
      `Platform role "${roleDef.slug}" granted to ${redactEmail(target.email)}`,
    );

    return {
      id: created.id,
      userId: created.userId,
      fullName: created.user.fullName,
      email: created.user.email,
      roleDefinitionId: created.roleDefinitionId,
      roleName: created.roleDefinition.name,
      roleSlug: created.roleDefinition.slug,
      isSystemRole: created.roleDefinition.isSystem,
      grantedByUserId: created.grantedByUserId,
      grantedByName: created.grantedBy?.fullName ?? null,
      expiresAt: created.expiresAt?.toISOString() ?? null,
      createdAt: created.createdAt.toISOString(),
      permissions: [...rolePermissions].sort(),
    };
  }

  /**
   * Revoke a platform grant.
   *
   * LAST-ADMIN PROTECTION: refuses a revoke that would leave nobody holding
   * any `admin:*` platform permission. Counted over platform grants only —
   * legacy member_roles-linked admins are deliberately NOT counted, because
   * counting them would let the last platform admin be revoked on the
   * strength of access this system exists to replace.
   */
  async revoke(
    targetUserId: string,
    roleDefinitionId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const grant = await this.prisma.platformRoleGrant.findUnique({
      where: {
        userId_roleDefinitionId: { userId: targetUserId, roleDefinitionId },
      },
      include: {
        user: { select: { fullName: true, email: true } },
        roleDefinition: { select: { name: true, slug: true } },
      },
    });
    if (!grant) throw new NotFoundException('Platform grant not found');

    const remainingAdmins = await this.countAdminHoldersExcluding(
      targetUserId,
      roleDefinitionId,
    );
    if (remainingAdmins === 0) {
      const reason = `Last-admin protection: revoking "${grant.roleDefinition.name}" from ${grant.user.fullName} would leave nobody on the platform holding any admin:* permission, and no one could grant it back. Grant an admin-bearing role to someone else first.`;
      await this.auditRefusal(
        'platform_revoke.refused',
        actorUserId,
        targetUserId,
        grant.roleDefinition.slug,
        'last_admin',
        reason,
      );
      throw new ConflictException(reason);
    }

    await this.prisma.platformRoleGrant.delete({ where: { id: grant.id } });
    await this.cache.invalidatePlatformForUser(targetUserId);

    await this.audit.log({
      actorUserId: actorUserId ?? undefined,
      actorType: actorUserId ? 'admin' : 'system',
      action: 'platform_grant.revoked',
      entityType: 'platform_role_grant',
      entityId: grant.id,
      metadata: {
        targetUserId,
        targetEmail: redactEmail(grant.user.email),
        roleSlug: grant.roleDefinition.slug,
        roleName: grant.roleDefinition.name,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
      },
    });

    this.logger.log(
      `Platform role "${grant.roleDefinition.slug}" revoked from ${redactEmail(grant.user.email)}`,
    );
  }

  // -----------------------------------------------------------------------
  // Platform-scope roles
  // -----------------------------------------------------------------------

  /**
   * Roles that can be granted as platform capability: organization_id IS NULL
   * (system roles plus platform-scope custom roles).
   */
  async listGrantableRoles(): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      isSystem: boolean;
      requiresMfa: boolean;
      maxPerOrg: number | null;
      holderCount: number;
      permissions: string[];
    }>
  > {
    const roles = await this.prisma.roleDefinition.findMany({
      where: { organizationId: null },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { platformGrants: true } } },
    });

    const out = [];
    for (const r of roles) {
      out.push({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        isSystem: r.isSystem,
        requiresMfa: r.requiresMfa,
        maxPerOrg: r.maxPerOrg,
        holderCount: r._count.platformGrants,
        permissions: (
          await this.permissions.resolvePermissionCodes([r.id])
        ).sort(),
      });
    }
    return out;
  }

  /**
   * Create a PLATFORM-SCOPE custom role: organization_id NULL, is_system false.
   *
   * Subject to the same no-escalation rule as grant(): the creator may not put
   * a permission into a role that the creator does not hold. Otherwise
   * authoring a role becomes a way around 2a.
   */
  async createPlatformRole(dto: CreatePlatformRoleDto, actorUserId: string) {
    const existing = await this.prisma.roleDefinition.findFirst({
      where: { slug: dto.slug, organizationId: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        `A platform role with slug "${dto.slug}" already exists.`,
      );
    }

    const permissions = await this.prisma.permission.findMany({
      where: { id: { in: dto.permissionIds } },
      select: { id: true, code: true },
    });
    if (permissions.length !== dto.permissionIds.length) {
      const found = new Set(permissions.map((p) => p.id));
      throw new BadRequestException(
        `Invalid permission IDs: ${dto.permissionIds.filter((id) => !found.has(id)).join(', ')}`,
      );
    }

    await this.assertActorHolds(
      actorUserId,
      permissions.map((p) => p.code),
      dto.name,
    );

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.roleDefinition.create({
        data: {
          organizationId: null,
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

    await this.audit.log({
      actorUserId,
      actorType: 'admin',
      action: 'platform_role.created',
      entityType: 'role_definition',
      entityId: role.id,
      metadata: {
        name: dto.name,
        slug: dto.slug,
        scope: 'platform',
        permissionCount: dto.permissionIds.length,
      },
    });

    return this.getPlatformRole(role.id);
  }

  /** Edit a platform-scope role. System roles are immutable — clone instead. */
  async updatePlatformRole(
    roleId: string,
    dto: UpdatePlatformRoleDto,
    actorUserId: string,
  ) {
    const role = await this.assertPlatformRole(roleId);
    if (role.isSystem) {
      throw new BadRequestException(
        `"${role.name}" is a built-in role and cannot be edited. Clone it to a platform role to customise it.`,
      );
    }

    let permissionCodes: string[] | undefined;
    if (dto.permissionIds) {
      const permissions = await this.prisma.permission.findMany({
        where: { id: { in: dto.permissionIds } },
        select: { id: true, code: true },
      });
      if (permissions.length !== dto.permissionIds.length) {
        const found = new Set(permissions.map((p) => p.id));
        throw new BadRequestException(
          `Invalid permission IDs: ${dto.permissionIds.filter((id) => !found.has(id)).join(', ')}`,
        );
      }
      permissionCodes = permissions.map((p) => p.code);
      await this.assertActorHolds(actorUserId, permissionCodes, role.name);
    }

    await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.RoleDefinitionUpdateInput = {};
      if (dto.name !== undefined) updateData.name = dto.name;
      if (dto.description !== undefined) updateData.description = dto.description;
      if (dto.requiresMfa !== undefined) updateData.requiresMfa = dto.requiresMfa;
      if (dto.maxPerOrg !== undefined) updateData.maxPerOrg = dto.maxPerOrg;

      if (Object.keys(updateData).length > 0) {
        await tx.roleDefinition.update({ where: { id: roleId }, data: updateData });
      }

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

    // Holders' cached permission sets are stale the moment the role changes.
    await this.cache.invalidatePlatformForRole(roleId);
    await this.cache.invalidateForRole(roleId);

    await this.audit.log({
      actorUserId,
      actorType: 'admin',
      action: 'platform_role.updated',
      entityType: 'role_definition',
      entityId: roleId,
      metadata: {
        name: dto.name ?? role.name,
        scope: 'platform',
        changes: Object.keys(dto).filter(
          (k) => (dto as Record<string, unknown>)[k] !== undefined,
        ),
      },
    });

    return this.getPlatformRole(roleId);
  }

  /** Delete a platform-scope role. Refuses system roles and roles in use. */
  async deletePlatformRole(roleId: string, actorUserId: string): Promise<void> {
    const role = await this.assertPlatformRole(roleId);
    if (role.isSystem) {
      throw new BadRequestException(
        `"${role.name}" is a built-in role and cannot be deleted.`,
      );
    }

    const [platformHolders, memberHolders] = await Promise.all([
      this.prisma.platformRoleGrant.count({ where: { roleDefinitionId: roleId } }),
      this.prisma.memberRole.count({ where: { roleDefinitionId: roleId } }),
    ]);
    const holders = platformHolders + memberHolders;
    if (holders > 0) {
      throw new ConflictException(
        `Cannot delete "${role.name}" — ${holders} holder(s) still have it. Revoke every grant first.`,
      );
    }

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

    await this.audit.log({
      actorUserId,
      actorType: 'admin',
      action: 'platform_role.deleted',
      entityType: 'role_definition',
      entityId: roleId,
      metadata: { name: role.name, slug: role.slug, scope: 'platform' },
    });
  }

  /** Full detail for one platform-grantable role. */
  async getPlatformRole(roleId: string) {
    const role = await this.prisma.roleDefinition.findUnique({
      where: { id: roleId },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { platformGrants: true } },
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
      effectivePermissions: (
        await this.permissions.resolvePermissionCodes([role.id])
      ).sort(),
      holderCount: role._count.platformGrants,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Separation of duties, ported to the user-keyed model.
   *
   * RolesService.checkConstraints reads `member_roles` by memberId. Calling it
   * here would find no rows for a platform holder and silently pass — the
   * editor ⊥ reviewer constraint in `role_constraints` would stop existing for
   * staff. This reads the same `role_constraints` table against
   * `platform_role_grants` instead.
   */
  private async checkPlatformConstraints(
    targetUserId: string,
    roleDefinitionId: string,
    actorUserId: string | null,
    candidateSlug: string,
  ): Promise<void> {
    const held = await this.prisma.platformRoleGrant.findMany({
      where: {
        userId: targetUserId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { roleDefinitionId: true },
    });
    const heldIds = new Set(held.map((g) => g.roleDefinitionId));

    const constraints = await this.prisma.roleConstraint.findMany({
      where: {
        OR: [{ roleAId: roleDefinitionId }, { roleBId: roleDefinitionId }],
      },
      include: {
        roleA: { select: { name: true, slug: true } },
        roleB: { select: { name: true, slug: true } },
      },
    });

    for (const constraint of constraints) {
      if (constraint.constraintType !== 'mutually_exclusive') continue;

      const isA = constraint.roleAId === roleDefinitionId;
      const conflictingId = isA ? constraint.roleBId : constraint.roleAId;
      if (!heldIds.has(conflictingId)) continue;

      const conflicting = isA ? constraint.roleB : constraint.roleA;
      const candidate = isA ? constraint.roleA : constraint.roleB;
      const reason = `Separation of duties refused: "${candidate.name}" is mutually exclusive with "${conflicting.name}", which this person already holds on the platform. Revoke one before granting the other.`;
      await this.auditRefusal(
        'platform_grant.refused',
        actorUserId,
        targetUserId,
        candidateSlug,
        'separation_of_duties',
        reason,
      );
      throw new ConflictException(reason);
    }
  }

  /**
   * How many users would still hold an `admin:*` platform permission if the
   * given grant were removed.
   */
  private async countAdminHoldersExcluding(
    excludedUserId: string,
    excludedRoleId: string,
  ): Promise<number> {
    const grants = await this.prisma.platformRoleGrant.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { userId: true, roleDefinitionId: true },
    });

    const remainingByUser = new Map<string, string[]>();
    for (const g of grants) {
      if (g.userId === excludedUserId && g.roleDefinitionId === excludedRoleId) {
        continue;
      }
      const roles = remainingByUser.get(g.userId) ?? [];
      roles.push(g.roleDefinitionId);
      remainingByUser.set(g.userId, roles);
    }

    let count = 0;
    for (const roleIds of remainingByUser.values()) {
      const codes = await this.permissions.resolvePermissionCodes(roleIds);
      if (codes.some((c) => c.startsWith('admin:'))) count += 1;
    }
    return count;
  }

  /** Refuse if the actor does not personally hold every code in `codes`. */
  private async assertActorHolds(
    actorUserId: string,
    codes: string[],
    roleName: string,
  ): Promise<void> {
    const actorPermissions = await this.getPlatformPermissions(actorUserId);
    const missing = codes.filter((c) => !actorPermissions.includes(c));
    if (missing.length === 0) return;

    const reason = `Privilege escalation refused: "${roleName}" would contain ${missing.length} permission(s) you do not hold — ${missing.sort().slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}. You can only put permissions into a role that you hold yourself.`;
    await this.audit.log({
      actorUserId,
      actorType: 'admin',
      action: 'platform_role.refused',
      entityType: 'role_definition',
      metadata: { roleName, refusal: 'privilege_escalation', missing },
    });
    throw new ForbiddenException(reason);
  }

  /** Load a role and refuse anything that is not platform-grantable. */
  private async assertPlatformRole(roleId: string) {
    const role = await this.prisma.roleDefinition.findUnique({
      where: { id: roleId },
      select: {
        id: true,
        name: true,
        slug: true,
        isSystem: true,
        organizationId: true,
      },
    });
    if (!role) throw new NotFoundException('Role definition not found');
    if (role.organizationId !== null) {
      throw new BadRequestException(
        `"${role.name}" belongs to an organization and is not a platform role. Manage it from that organization's role settings.`,
      );
    }
    return role;
  }

  /** Audit a refusal, so the panel's error message has a matching log entry. */
  private async auditRefusal(
    action: string,
    actorUserId: string | null,
    targetUserId: string,
    roleSlug: string,
    refusal: string,
    reason: string,
  ): Promise<void> {
    await this.audit.log({
      actorUserId: actorUserId ?? undefined,
      actorType: actorUserId ? 'admin' : 'system',
      action,
      entityType: 'platform_role_grant',
      metadata: { targetUserId, roleSlug, refusal, reason },
    });
  }
}

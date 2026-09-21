/** Organization membership roles per PDD Section 5.1 */
export enum UserRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  EDITOR = 'editor',
  MEMBER = 'member',
  REVIEWER = 'reviewer',
  STUDENT = 'student',
}

export enum MfaMethod {
  TOTP = 'totp',
  NONE = 'none',
}

export enum SubscriptionTier {
  FREE = 'free',
  EDU = 'edu',
  PRO = 'pro',
  TEAM = 'team',
  ENTERPRISE = 'enterprise',
}

export enum SubscriptionStatus {
  PROVISIONING = 'provisioning',
  TRIALING = 'trialing',
  TRIAL_EXPIRED = 'trial_expired',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  GRACE_PERIOD = 'grace_period',
  SUSPENDED = 'suspended',
  CANCELLING = 'cancelling',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  COMPLIMENTARY = 'complimentary',
  MIGRATING = 'migrating',
  TERMINATED = 'terminated',
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  organizationId: string;
  mfaVerified: boolean;
  iat: number;
  exp: number;
  /**
   * Resolved per-request from the member's effective permissions
   * (any `admin:*`). NOT a JWT claim — populated by JwtStrategy.validate()
   * so revoking the role takes effect on the next request.
   */
  isPlatformAdmin?: boolean;
  /** Org member id resolved per-request by JwtStrategy/PermissionsGuard. */
  memberId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Self-identified user role for personalization (NOT the RBAC role) */
export type UserProfileRole =
  | 'student'
  | 'bar_taker'
  | 'solo_practitioner'
  | 'firm_member'
  | 'legal_editor';

export interface OnboardingData {
  userRole: UserProfileRole;
  preferredBarSubjects?: string[];
  practiceAreas?: string[];
  skipped?: boolean;
}

// ==========================================================================
// RBAC (Role-Based Access Control) Types
// ==========================================================================

/** Permission definition from the permission catalogue */
export interface PermissionDef {
  id: string;
  code: string;
  resource: string;
  action: string;
  category: string;
  description?: string;
  isSystem: boolean;
}

/** Role definition (system default or org-scoped custom) */
export interface RoleDefinitionDto {
  id: string;
  organizationId?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  isSystem: boolean;
  requiresMfa: boolean;
  maxPerOrg?: number | null;
  permissions: PermissionDef[];
  /** Permissions inherited via hierarchy (read-only) */
  inheritedPermissions?: PermissionDef[];
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** Hierarchy node for tree visualization */
export interface RoleHierarchyNode {
  id: string;
  roleId: string;
  roleName: string;
  roleSlug: string;
  children: RoleHierarchyNode[];
}

/** Hierarchy edge (parent → child) */
export interface RoleHierarchyEdge {
  id: string;
  parentRoleId: string;
  parentRoleName: string;
  childRoleId: string;
  childRoleName: string;
}

/** Organization member with resolved RBAC roles */
export interface MemberWithRoles {
  id: string;
  organizationId: string;
  userId: string;
  email: string;
  fullName: string;
  legacyRole: string;
  status: string;
  roles: MemberRoleAssignment[];
  effectivePermissions?: string[];
  createdAt: string;
}

/** A single role assignment for a member */
export interface MemberRoleAssignment {
  id: string;
  roleDefinitionId: string;
  roleName: string;
  roleSlug: string;
  isSystem: boolean;
  assignedByUserId?: string | null;
  assignedByName?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

/** Separation-of-duty or cardinality constraint */
export interface RbacConstraint {
  id: string;
  roleAId: string;
  roleAName: string;
  roleASlug: string;
  roleBId: string;
  roleBName: string;
  roleBSlug: string;
  constraintType: 'mutually_exclusive' | 'prerequisite' | 'cardinality';
}

/** Permission categories for grouping in the UI */
export type PermissionCategory =
  | 'corpus'
  | 'digests'
  | 'editorial'
  | 'workspace'
  | 'ai'
  | 'study'
  | 'search'
  | 'admin'
  | 'billing'
  | 'community';

/** Grouped permissions for the permission matrix UI */
export interface PermissionGroup {
  category: PermissionCategory;
  permissions: PermissionDef[];
}

// ==========================================================================
// Platform capability (no organization)
// ==========================================================================

/**
 * Effective permissions for the current user, from GET /rbac/me/permissions.
 *
 * Two independent sets, deliberately not merged: `tenantPermissions` come
 * from the caller's membership in their JWT organization (their personal
 * workspace, in practice — login picks the oldest membership and there is no
 * org-switch endpoint), while `platformPermissions` come from
 * `platform_role_grants`, which have no organization at all.
 */
export interface MyPermissions {
  tenantPermissions: string[];
  platformPermissions: string[];
  isPlatformStaff: boolean;
}

/** A user who holds at least one platform grant. */
export interface PlatformStaffUser {
  userId: string;
  fullName: string;
  email: string;
}

/** One platform staff grant, as the staff panel lists it. */
export interface PlatformGrant {
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

/** A candidate for a grant: an EXISTING account found by search. */
export interface PlatformStaffCandidate extends PlatformStaffUser {
  status: string;
}

/** A role that can be granted as platform capability (organization_id IS NULL). */
export interface PlatformRoleSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  requiresMfa: boolean;
  /** Maximum simultaneous PLATFORM holders (stored in role_definitions.max_per_org). */
  maxPerOrg: number | null;
  holderCount: number;
  permissions: string[];
}

/** Full detail for one platform role, including its own permission rows. */
export interface PlatformRoleDetail {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  requiresMfa: boolean;
  maxPerOrg: number | null;
  permissions: PermissionDef[];
  effectivePermissions: string[];
  holderCount: number;
  createdAt: string;
  updatedAt: string;
}

/** The permission catalogue, grouped for the picker. */
export interface PermissionCatalogue {
  permissions: PermissionDef[];
  groups: Array<{
    category: string;
    resources: Array<{ resource: string; permissions: PermissionDef[] }>;
  }>;
}

/** A user who may be assigned a digest to review, with their workload. */
export interface DigestReviewer {
  userId: string;
  fullName: string;
  email: string;
  assigned: number;
  reviewed: number;
}

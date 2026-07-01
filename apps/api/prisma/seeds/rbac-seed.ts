/**
 * RBAC Seed Data — Permissions, Roles, Hierarchy, Constraints
 *
 * Seeds ~90 system permissions (resource:action format), 6 system roles,
 * role→permission mappings, default hierarchy edges, and SoD constraints.
 *
 * This seed is idempotent — safe to run multiple times.
 */

import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Permission Catalogue (~90 permissions)
// ---------------------------------------------------------------------------

interface PermissionSeed {
  code: string;
  resource: string;
  action: string;
  category: string;
  description: string;
}

export const PERMISSIONS: PermissionSeed[] = [
  // --- Corpus ---
  { code: 'documents:read', resource: 'documents', action: 'read', category: 'corpus', description: 'View legal documents' },
  { code: 'documents:create', resource: 'documents', action: 'create', category: 'corpus', description: 'Create legal documents' },
  { code: 'documents:update', resource: 'documents', action: 'update', category: 'corpus', description: 'Edit legal documents' },
  { code: 'documents:delete', resource: 'documents', action: 'delete', category: 'corpus', description: 'Delete legal documents' },
  { code: 'documents:publish', resource: 'documents', action: 'publish', category: 'corpus', description: 'Publish legal documents to public corpus' },
  { code: 'sections:read', resource: 'sections', action: 'read', category: 'corpus', description: 'View document sections' },
  { code: 'citations:read', resource: 'citations', action: 'read', category: 'corpus', description: 'View citations' },
  { code: 'citations:create', resource: 'citations', action: 'create', category: 'corpus', description: 'Create citations' },
  { code: 'citations:update', resource: 'citations', action: 'update', category: 'corpus', description: 'Edit citations' },
  { code: 'citations:resolve', resource: 'citations', action: 'resolve', category: 'corpus', description: 'Resolve citation references' },
  { code: 'sources:read', resource: 'sources', action: 'read', category: 'corpus', description: 'View ingestion sources' },
  { code: 'sources:create', resource: 'sources', action: 'create', category: 'corpus', description: 'Add ingestion sources' },
  { code: 'sources:update', resource: 'sources', action: 'update', category: 'corpus', description: 'Edit ingestion sources' },
  { code: 'sources:delete', resource: 'sources', action: 'delete', category: 'corpus', description: 'Remove ingestion sources' },
  { code: 'sources:fetch', resource: 'sources', action: 'fetch', category: 'corpus', description: 'Trigger source fetch/crawl' },

  // --- Digests ---
  { code: 'digests:read', resource: 'digests', action: 'read', category: 'digests', description: 'View digests' },
  { code: 'digests:create', resource: 'digests', action: 'create', category: 'digests', description: 'Create digests' },
  { code: 'digests:update', resource: 'digests', action: 'update', category: 'digests', description: 'Edit digests' },
  { code: 'digests:delete', resource: 'digests', action: 'delete', category: 'digests', description: 'Delete digests' },
  { code: 'digests:review', resource: 'digests', action: 'review', category: 'digests', description: 'Review digests for quality' },
  { code: 'digests:approve', resource: 'digests', action: 'approve', category: 'digests', description: 'Approve digests for publication' },
  { code: 'digests:reject', resource: 'digests', action: 'reject', category: 'digests', description: 'Reject digests back to draft' },
  { code: 'digests:assign', resource: 'digests', action: 'assign', category: 'digests', description: 'Assign digests to reviewers' },

  // --- Editorial ---
  { code: 'editorial-flags:read', resource: 'editorial-flags', action: 'read', category: 'editorial', description: 'View editorial flags' },
  { code: 'editorial-flags:create', resource: 'editorial-flags', action: 'create', category: 'editorial', description: 'Create editorial flags' },
  { code: 'editorial-flags:resolve', resource: 'editorial-flags', action: 'resolve', category: 'editorial', description: 'Resolve editorial flags' },
  { code: 'doctrines:read', resource: 'doctrines', action: 'read', category: 'editorial', description: 'View doctrine extracts' },
  { code: 'doctrines:create', resource: 'doctrines', action: 'create', category: 'editorial', description: 'Create doctrine extracts' },
  { code: 'doctrines:update', resource: 'doctrines', action: 'update', category: 'editorial', description: 'Edit doctrine extracts' },
  { code: 'doctrines:delete', resource: 'doctrines', action: 'delete', category: 'editorial', description: 'Delete doctrine extracts' },
  { code: 'doctrines:approve', resource: 'doctrines', action: 'approve', category: 'editorial', description: 'Approve doctrine extracts' },

  // --- Workspace ---
  { code: 'matters:read', resource: 'matters', action: 'read', category: 'workspace', description: 'View matters' },
  { code: 'matters:create', resource: 'matters', action: 'create', category: 'workspace', description: 'Create matters' },
  { code: 'matters:update', resource: 'matters', action: 'update', category: 'workspace', description: 'Edit matters' },
  { code: 'matters:delete', resource: 'matters', action: 'delete', category: 'workspace', description: 'Delete matters' },
  { code: 'notes:read', resource: 'notes', action: 'read', category: 'workspace', description: 'View notes' },
  { code: 'notes:create', resource: 'notes', action: 'create', category: 'workspace', description: 'Create notes' },
  { code: 'notes:update', resource: 'notes', action: 'update', category: 'workspace', description: 'Edit notes' },
  { code: 'notes:delete', resource: 'notes', action: 'delete', category: 'workspace', description: 'Delete notes' },
  { code: 'tasks:read', resource: 'tasks', action: 'read', category: 'workspace', description: 'View tasks' },
  { code: 'tasks:create', resource: 'tasks', action: 'create', category: 'workspace', description: 'Create tasks' },
  { code: 'tasks:update', resource: 'tasks', action: 'update', category: 'workspace', description: 'Edit tasks' },
  { code: 'tasks:delete', resource: 'tasks', action: 'delete', category: 'workspace', description: 'Delete tasks' },
  { code: 'bookmarks:read', resource: 'bookmarks', action: 'read', category: 'workspace', description: 'View bookmarks' },
  { code: 'bookmarks:create', resource: 'bookmarks', action: 'create', category: 'workspace', description: 'Create bookmarks' },
  { code: 'bookmarks:delete', resource: 'bookmarks', action: 'delete', category: 'workspace', description: 'Delete bookmarks' },
  { code: 'annotations:read', resource: 'annotations', action: 'read', category: 'workspace', description: 'View annotations' },
  { code: 'annotations:create', resource: 'annotations', action: 'create', category: 'workspace', description: 'Create annotations' },
  { code: 'annotations:delete', resource: 'annotations', action: 'delete', category: 'workspace', description: 'Delete annotations' },
  { code: 'uploads:read', resource: 'uploads', action: 'read', category: 'workspace', description: 'View uploads' },
  { code: 'uploads:create', resource: 'uploads', action: 'create', category: 'workspace', description: 'Upload files' },
  { code: 'uploads:delete', resource: 'uploads', action: 'delete', category: 'workspace', description: 'Delete uploads' },
  { code: 'shares:read', resource: 'shares', action: 'read', category: 'workspace', description: 'View workspace shares' },
  { code: 'shares:create', resource: 'shares', action: 'create', category: 'workspace', description: 'Create workspace shares' },
  { code: 'shares:delete', resource: 'shares', action: 'delete', category: 'workspace', description: 'Delete workspace shares' },

  // --- AI Workflows ---
  { code: 'ai-answers:generate', resource: 'ai-answers', action: 'generate', category: 'ai', description: 'Generate AI-powered answers' },
  { code: 'memos:read', resource: 'memos', action: 'read', category: 'ai', description: 'View legal memos' },
  { code: 'memos:create', resource: 'memos', action: 'create', category: 'ai', description: 'Generate legal memos' },
  { code: 'memos:delete', resource: 'memos', action: 'delete', category: 'ai', description: 'Delete legal memos' },
  { code: 'pleadings:read', resource: 'pleadings', action: 'read', category: 'ai', description: 'View pleadings' },
  { code: 'pleadings:create', resource: 'pleadings', action: 'create', category: 'ai', description: 'Generate pleadings' },
  { code: 'pleadings:delete', resource: 'pleadings', action: 'delete', category: 'ai', description: 'Delete pleadings' },
  { code: 'comparisons:read', resource: 'comparisons', action: 'read', category: 'ai', description: 'View case comparisons' },
  { code: 'comparisons:create', resource: 'comparisons', action: 'create', category: 'ai', description: 'Generate case comparisons' },
  { code: 'timelines:read', resource: 'timelines', action: 'read', category: 'ai', description: 'View case timelines' },
  { code: 'timelines:create', resource: 'timelines', action: 'create', category: 'ai', description: 'Generate case timelines' },
  { code: 'hearing-prep:read', resource: 'hearing-prep', action: 'read', category: 'ai', description: 'View hearing prep packs' },
  { code: 'hearing-prep:create', resource: 'hearing-prep', action: 'create', category: 'ai', description: 'Generate hearing prep packs' },
  { code: 'contradictions:read', resource: 'contradictions', action: 'read', category: 'ai', description: 'View contradiction reports' },
  { code: 'contradictions:create', resource: 'contradictions', action: 'create', category: 'ai', description: 'Generate contradiction reports' },
  { code: 'research-workspaces:read', resource: 'research-workspaces', action: 'read', category: 'ai', description: 'View research workspaces' },
  { code: 'research-workspaces:create', resource: 'research-workspaces', action: 'create', category: 'ai', description: 'Create research workspaces' },
  { code: 'research-workspaces:delete', resource: 'research-workspaces', action: 'delete', category: 'ai', description: 'Delete research workspaces' },

  // --- Study ---
  { code: 'flashcards:read', resource: 'flashcards', action: 'read', category: 'study', description: 'View flashcard sets' },
  { code: 'flashcards:create', resource: 'flashcards', action: 'create', category: 'study', description: 'Create flashcard sets' },
  { code: 'flashcards:update', resource: 'flashcards', action: 'update', category: 'study', description: 'Edit flashcard sets' },
  { code: 'flashcards:delete', resource: 'flashcards', action: 'delete', category: 'study', description: 'Delete flashcard sets' },
  { code: 'reviewer-packs:read', resource: 'reviewer-packs', action: 'read', category: 'study', description: 'View reviewer packs' },
  { code: 'reviewer-packs:create', resource: 'reviewer-packs', action: 'create', category: 'study', description: 'Create reviewer packs' },
  { code: 'reviewer-packs:update', resource: 'reviewer-packs', action: 'update', category: 'study', description: 'Edit reviewer packs' },
  { code: 'reviewer-packs:delete', resource: 'reviewer-packs', action: 'delete', category: 'study', description: 'Delete reviewer packs' },
  { code: 'study-progress:read', resource: 'study-progress', action: 'read', category: 'study', description: 'View study progress' },
  { code: 'study-progress:update', resource: 'study-progress', action: 'update', category: 'study', description: 'Update study progress' },

  // --- Search ---
  { code: 'search:query', resource: 'search', action: 'query', category: 'search', description: 'Execute search queries' },
  { code: 'search:advanced', resource: 'search', action: 'advanced', category: 'search', description: 'Use advanced search filters' },

  // --- Admin ---
  { code: 'admin:dashboard', resource: 'admin', action: 'dashboard', category: 'admin', description: 'Access admin dashboard' },
  { code: 'admin:corpus-health', resource: 'admin', action: 'corpus-health', category: 'admin', description: 'View corpus health metrics' },
  { code: 'admin:ingestion', resource: 'admin', action: 'ingestion', category: 'admin', description: 'Manage ingestion pipeline' },
  { code: 'admin:review-queue', resource: 'admin', action: 'review-queue', category: 'admin', description: 'Access review queue' },
  { code: 'admin:coverage-gaps', resource: 'admin', action: 'coverage-gaps', category: 'admin', description: 'View coverage gap analysis' },
  { code: 'admin:duplicates', resource: 'admin', action: 'duplicates', category: 'admin', description: 'Manage document duplicates' },
  { code: 'admin:knowledge-graph', resource: 'admin', action: 'knowledge-graph', category: 'admin', description: 'Access knowledge graph' },
  { code: 'admin:settings', resource: 'admin', action: 'settings', category: 'admin', description: 'Manage platform settings (derivatives, backfill, site content)' },
  { code: 'admin:documents', resource: 'admin', action: 'documents', category: 'admin', description: 'Manage document classification and metadata' },
  { code: 'admin:billing', resource: 'admin', action: 'billing', category: 'admin', description: 'Manage billing, subscriptions, coupons, and promotions' },
  { code: 'admin:users', resource: 'admin', action: 'users', category: 'admin', description: 'View users across organizations (admin user management)' },
  { code: 'admin:ai-settings', resource: 'admin', action: 'ai-settings', category: 'admin', description: 'Manage AI model settings and budgets' },
  { code: 'users:read', resource: 'users', action: 'read', category: 'admin', description: 'View organization members' },
  { code: 'users:update', resource: 'users', action: 'update', category: 'admin', description: 'Update user profiles' },
  { code: 'users:deactivate', resource: 'users', action: 'deactivate', category: 'admin', description: 'Deactivate/suspend users' },
  { code: 'roles:read', resource: 'roles', action: 'read', category: 'admin', description: 'View role definitions' },
  { code: 'roles:create', resource: 'roles', action: 'create', category: 'admin', description: 'Create custom roles' },
  { code: 'roles:update', resource: 'roles', action: 'update', category: 'admin', description: 'Edit role definitions' },
  { code: 'roles:delete', resource: 'roles', action: 'delete', category: 'admin', description: 'Delete custom roles' },
  { code: 'permissions:read', resource: 'permissions', action: 'read', category: 'admin', description: 'View permission catalogue' },
  { code: 'organizations:read', resource: 'organizations', action: 'read', category: 'admin', description: 'View organization details' },
  { code: 'organizations:update', resource: 'organizations', action: 'update', category: 'admin', description: 'Update organization settings' },
  { code: 'members:read', resource: 'members', action: 'read', category: 'admin', description: 'View member list' },
  { code: 'members:invite', resource: 'members', action: 'invite', category: 'admin', description: 'Invite new members' },
  { code: 'members:update-role', resource: 'members', action: 'update-role', category: 'admin', description: 'Change member roles' },
  { code: 'members:remove', resource: 'members', action: 'remove', category: 'admin', description: 'Remove members from organization' },
  { code: 'audit-logs:read', resource: 'audit-logs', action: 'read', category: 'admin', description: 'View audit logs' },

  // --- Billing ---
  { code: 'subscriptions:read', resource: 'subscriptions', action: 'read', category: 'billing', description: 'View subscription details' },
  { code: 'subscriptions:manage', resource: 'subscriptions', action: 'manage', category: 'billing', description: 'Manage subscriptions (upgrade/downgrade/cancel)' },
  { code: 'invoices:read', resource: 'invoices', action: 'read', category: 'billing', description: 'View invoices' },
  { code: 'payment-methods:read', resource: 'payment-methods', action: 'read', category: 'billing', description: 'View payment methods' },
  { code: 'payment-methods:manage', resource: 'payment-methods', action: 'manage', category: 'billing', description: 'Add/remove payment methods' },
  { code: 'admin:plans', resource: 'plans', action: 'manage', category: 'billing', description: 'Manage plans, prices, and entitlements (admin)' },

  // --- Community ---
  { code: 'community:rate', resource: 'community', action: 'rate', category: 'community', description: 'Rate community content' },
  { code: 'community:vote', resource: 'community', action: 'vote', category: 'community', description: 'Vote on community content' },
  { code: 'community:flag', resource: 'community', action: 'flag', category: 'community', description: 'Flag inappropriate content' },
  { code: 'community:moderate', resource: 'community', action: 'moderate', category: 'community', description: 'Moderate community flags' },

  // --- Blog ---
  { code: 'blog:read', resource: 'blog', action: 'read', category: 'blog', description: 'View blog posts' },
  { code: 'blog:create', resource: 'blog', action: 'create', category: 'blog', description: 'Create blog posts' },
  { code: 'blog:update', resource: 'blog', action: 'update', category: 'blog', description: 'Edit blog posts' },
  { code: 'blog:delete', resource: 'blog', action: 'delete', category: 'blog', description: 'Delete blog posts' },
  { code: 'blog:manage', resource: 'blog', action: 'manage', category: 'blog', description: 'Full blog administration' },

  // --- Advertising ---
  { code: 'ads:read', resource: 'ads', action: 'read', category: 'ads', description: 'View ad campaigns' },
  { code: 'ads:create', resource: 'ads', action: 'create', category: 'ads', description: 'Create ad campaigns' },
  { code: 'ads:update', resource: 'ads', action: 'update', category: 'ads', description: 'Edit ad campaigns' },
  { code: 'ads:delete', resource: 'ads', action: 'delete', category: 'ads', description: 'Delete ad campaigns' },
  { code: 'ads:manage', resource: 'ads', action: 'manage', category: 'ads', description: 'Full ad administration' },
];

// ---------------------------------------------------------------------------
// Role Definitions
// ---------------------------------------------------------------------------

interface RoleSeed {
  name: string;
  slug: string;
  description: string;
  isSystem: boolean;
  requiresMfa: boolean;
  maxPerOrg?: number;
}

const ROLES: RoleSeed[] = [
  { name: 'Owner', slug: 'owner', description: 'Organization owner with full access', isSystem: true, requiresMfa: true, maxPerOrg: 1 },
  { name: 'Admin', slug: 'admin', description: 'Organization administrator', isSystem: true, requiresMfa: true },
  { name: 'Editor', slug: 'editor', description: 'Editorial staff for corpus management', isSystem: true, requiresMfa: true },
  { name: 'Reviewer', slug: 'reviewer', description: 'Digest and content reviewer', isSystem: true, requiresMfa: true },
  { name: 'Member', slug: 'member', description: 'Standard organization member', isSystem: true, requiresMfa: false },
  { name: 'Student', slug: 'student', description: 'Student member with study features', isSystem: true, requiresMfa: false },
];

// ---------------------------------------------------------------------------
// Role → Permission Mappings
// ---------------------------------------------------------------------------

/** All permission codes */
const ALL_CODES = PERMISSIONS.map((p) => p.code);

/** Helper: all permissions matching a category */
function byCategory(cat: string): string[] {
  return PERMISSIONS.filter((p) => p.category === cat).map((p) => p.code);
}

/** Helper: all permissions matching a resource prefix */
function byResource(res: string): string[] {
  return PERMISSIONS.filter((p) => p.resource === res).map((p) => p.code);
}

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  // Owner: ALL tenant permissions EXCEPT platform admin:* codes. Personal-
  // workspace owners are linked to this shared system role, so it must NOT
  // confer platform administration. Real admins are granted explicitly (see
  // migration 20260702120000_strip_owner_platform_admin), never via ownership.
  owner: ALL_CODES.filter((c) => !c.startsWith('admin:')),

  // Admin: all except billing:manage and org transfer
  admin: ALL_CODES.filter(
    (c) => !['subscriptions:manage', 'payment-methods:manage'].includes(c),
  ),

  // Editor: corpus CRUD, digests, editorial, doctrines, admin dashboard/review/flags, search, workspace read
  editor: [
    ...byCategory('corpus'),
    ...byCategory('digests'),
    ...byCategory('editorial'),
    'admin:dashboard',
    'admin:corpus-health',
    'admin:ingestion',
    'admin:review-queue',
    'admin:coverage-gaps',
    'admin:duplicates',
    'admin:knowledge-graph',
    'search:query',
    'search:advanced',
    'documents:read',
    'sections:read',
    'matters:read',
    'notes:read',
    'tasks:read',
    'bookmarks:read',
    'annotations:read',
    'uploads:read',
    'community:moderate',
    'blog:read',
    'blog:create',
    'blog:update',
    'blog:delete',
    'blog:manage',
  ],

  // Reviewer: digests read/review/approve/reject, editorial flags, search, workspace read
  reviewer: [
    'digests:read',
    'digests:review',
    'digests:approve',
    'digests:reject',
    'editorial-flags:read',
    'editorial-flags:create',
    'doctrines:read',
    'search:query',
    'search:advanced',
    'documents:read',
    'sections:read',
    'citations:read',
    'matters:read',
    'notes:read',
    'tasks:read',
    'bookmarks:read',
    'bookmarks:create',
    'annotations:read',
    'annotations:create',
    'uploads:read',
  ],

  // Member: workspace full, digests read/create, search, study, AI workflows, uploads, bookmarks, annotations
  member: [
    ...byCategory('workspace'),
    'digests:read',
    'digests:create',
    ...byCategory('search'),
    ...byCategory('study'),
    ...byCategory('ai'),
    'documents:read',
    'sections:read',
    'citations:read',
    'doctrines:read',
    'subscriptions:read',
    'invoices:read',
    'payment-methods:read',
    'community:rate',
    'community:vote',
    'community:flag',
  ],

  // Student: search, study full, digests read, bookmarks, annotations, AI answers
  student: [
    ...byCategory('search'),
    ...byCategory('study'),
    'digests:read',
    'documents:read',
    'sections:read',
    'citations:read',
    'doctrines:read',
    'bookmarks:read',
    'bookmarks:create',
    'bookmarks:delete',
    'annotations:read',
    'annotations:create',
    'annotations:delete',
    'ai-answers:generate',
    'community:rate',
    'community:vote',
    'community:flag',
  ],
};

// Deduplicate permission arrays
for (const role of Object.keys(ROLE_PERMISSIONS)) {
  ROLE_PERMISSIONS[role] = [...new Set(ROLE_PERMISSIONS[role])];
}

// ---------------------------------------------------------------------------
// Hierarchy Edges (parent → child)
// ---------------------------------------------------------------------------

// NOTE: deliberately NO owner→admin edge. PermissionsService resolves
// effective permissions by inheriting DOWN the hierarchy (parent gains child
// permissions), so an owner→admin edge would hand every personal-workspace
// owner the admin role's platform admin:* codes — the exact leak that
// migration 20260702120000_strip_owner_platform_admin removes. Owner loses
// nothing: it holds every tenant permission directly (see ROLE_PERMISSIONS).
export const HIERARCHY_EDGES: Array<{ parent: string; child: string }> = [
  { parent: 'admin', child: 'editor' },
  { parent: 'admin', child: 'reviewer' },
  { parent: 'editor', child: 'member' },
  { parent: 'member', child: 'student' },
];

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

const CONSTRAINTS: Array<{
  roleA: string;
  roleB: string;
  type: string;
}> = [
  // Editor and Reviewer are mutually exclusive (separation of duties)
  { roleA: 'editor', roleB: 'reviewer', type: 'mutually_exclusive' },
];

// ---------------------------------------------------------------------------
// Seed Function
// ---------------------------------------------------------------------------

export interface SeededRbac {
  permissionCount: number;
  roleCount: number;
  rolePermissionCount: number;
  hierarchyEdgeCount: number;
  constraintCount: number;
  roleIds: Record<string, string>;
}

export async function seedRbac(prisma: PrismaClient): Promise<SeededRbac> {
  console.log('\n--- Seeding RBAC data ---');

  // 0. Reconcile legacy 'system-admin' slug → 'admin' (prod DB may have this)
  const legacyAdmin = await prisma.roleDefinition.findFirst({
    where: { slug: 'system-admin', isSystem: true, organizationId: null },
  });
  if (legacyAdmin) {
    await prisma.roleDefinition.update({
      where: { id: legacyAdmin.id },
      data: { slug: 'admin' },
    });
    console.log('  Renamed legacy role slug system-admin → admin');
  }

  // 1. Seed permissions
  console.log('  Seeding permissions...');
  const permissionMap: Record<string, string> = {};

  for (const perm of PERMISSIONS) {
    const result = await prisma.permission.upsert({
      where: { code: perm.code },
      update: {
        resource: perm.resource,
        action: perm.action,
        category: perm.category,
        description: perm.description,
      },
      create: {
        code: perm.code,
        resource: perm.resource,
        action: perm.action,
        category: perm.category,
        description: perm.description,
        isSystem: true,
      },
    });
    permissionMap[perm.code] = result.id;
  }
  console.log(`  ${PERMISSIONS.length} permissions seeded.`);

  // 2. Seed role definitions (system-wide, organizationId = null)
  console.log('  Seeding role definitions...');
  const roleIds: Record<string, string> = {};

  for (const role of ROLES) {
    // System roles have null organizationId — use a findFirst + upsert approach
    const existing = await prisma.roleDefinition.findFirst({
      where: { slug: role.slug, isSystem: true, organizationId: null },
    });

    if (existing) {
      await prisma.roleDefinition.update({
        where: { id: existing.id },
        data: {
          name: role.name,
          description: role.description,
          requiresMfa: role.requiresMfa,
          maxPerOrg: role.maxPerOrg ?? null,
        },
      });
      roleIds[role.slug] = existing.id;
    } else {
      const created = await prisma.roleDefinition.create({
        data: {
          name: role.name,
          slug: role.slug,
          description: role.description,
          isSystem: true,
          requiresMfa: role.requiresMfa,
          maxPerOrg: role.maxPerOrg ?? null,
          organizationId: null,
        },
      });
      roleIds[role.slug] = created.id;
    }
  }
  console.log(`  ${ROLES.length} role definitions seeded.`);

  // 3. Seed role→permission mappings
  console.log('  Seeding role→permission mappings...');
  let rolePermissionCount = 0;

  for (const [roleSlug, permCodes] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleIds[roleSlug];
    if (!roleId) continue;

    // Clear existing mappings for this role to ensure clean state
    await prisma.rolePermission.deleteMany({ where: { roleId } });

    for (const code of permCodes) {
      const permId = permissionMap[code];
      if (!permId) {
        console.warn(`    Warning: permission "${code}" not found for role "${roleSlug}"`);
        continue;
      }
      await prisma.rolePermission.create({
        data: { roleId, permissionId: permId },
      });
      rolePermissionCount++;
    }
  }
  console.log(`  ${rolePermissionCount} role→permission mappings seeded.`);

  // 4. Seed hierarchy edges
  console.log('  Seeding role hierarchy...');
  let hierarchyEdgeCount = 0;

  for (const edge of HIERARCHY_EDGES) {
    const parentId = roleIds[edge.parent];
    const childId = roleIds[edge.child];
    if (!parentId || !childId) continue;

    await prisma.roleHierarchy.upsert({
      where: {
        parentRoleId_childRoleId: { parentRoleId: parentId, childRoleId: childId },
      },
      update: {},
      create: { parentRoleId: parentId, childRoleId: childId },
    });
    hierarchyEdgeCount++;
  }
  console.log(`  ${hierarchyEdgeCount} hierarchy edges seeded.`);

  // 5. Seed constraints
  console.log('  Seeding role constraints...');
  let constraintCount = 0;

  for (const constraint of CONSTRAINTS) {
    const roleAId = roleIds[constraint.roleA];
    const roleBId = roleIds[constraint.roleB];
    if (!roleAId || !roleBId) continue;

    await prisma.roleConstraint.upsert({
      where: {
        roleAId_roleBId_constraintType: {
          roleAId,
          roleBId,
          constraintType: constraint.type,
        },
      },
      update: {},
      create: {
        roleAId,
        roleBId,
        constraintType: constraint.type,
      },
    });
    constraintCount++;
  }
  console.log(`  ${constraintCount} constraints seeded.`);

  console.log('  RBAC seed complete.');

  return {
    permissionCount: PERMISSIONS.length,
    roleCount: ROLES.length,
    rolePermissionCount,
    hierarchyEdgeCount,
    constraintCount,
    roleIds,
  };
}

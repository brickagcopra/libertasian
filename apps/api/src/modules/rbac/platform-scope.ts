/**
 * The single definition of "this permission code is platform capability,
 * not workspace capability".
 *
 * Platform capability is granted through platform_role_grants (Admin → Staff,
 * PlatformGrantsService), which is keyed on users and has no organization at
 * all. It must NEVER be reachable through a tenant role, because every signup
 * is the owner of a personal workspace — so anything an owner can grant
 * themselves is effectively granted to every account that exists.
 *
 * Kept in one place because this invariant is enforced in two layers that
 * would otherwise drift:
 *   - prisma/seeds/rbac-seed.ts excludes these codes from the `owner` role
 *     (migration 20260702120000_strip_owner_platform_admin), and
 *   - RolesService refuses to assign or mint any workspace role that confers
 *     one (this file's callers).
 * A code added to PERMISSIONS that matches here is covered by both at once.
 */

/** Code prefixes that denote platform scope. */
export const PLATFORM_SCOPE_PREFIXES = ['admin:', 'platform-'] as const;

/**
 * Platform-scope codes that do not carry a platform-scope prefix.
 *
 * `digests:review` is here because reviewing the shared editorial corpus is
 * platform work that merely happens to live under a tenant-looking resource.
 * While `owner` held it, every self-registered user got HTTP 200 on
 * GET /admin/digests/review-queue (verified on prod 2026-09-21), because
 * DigestsAdminController accepts {digests:review, admin:review-queue} with
 * mode 'any'. Without this entry, an owner with `roles:create` could mint a
 * custom role carrying it and walk straight back in — the prefix rules alone
 * do not close that door.
 */
export const PLATFORM_SCOPE_EXACT_CODES = ['digests:review'] as const;

/** The refusal shown whenever a workspace role would confer platform capability. */
export const PLATFORM_CAPABILITY_REFUSAL =
  'Platform capability cannot be granted through a workspace role. Use Admin → Staff.';

/** True when `code` is platform capability rather than workspace capability. */
export function isPlatformScopedCode(code: string): boolean {
  return (
    PLATFORM_SCOPE_PREFIXES.some((prefix) => code.startsWith(prefix)) ||
    (PLATFORM_SCOPE_EXACT_CODES as readonly string[]).includes(code)
  );
}

/**
 * The platform-scoped subset of `codes`, sorted, for refusal messages and
 * audit metadata. Empty means the set is safe to confer through a workspace
 * role.
 */
export function findPlatformScopedCodes(codes: readonly string[]): string[] {
  return [...new Set(codes.filter(isPlatformScopedCode))].sort();
}

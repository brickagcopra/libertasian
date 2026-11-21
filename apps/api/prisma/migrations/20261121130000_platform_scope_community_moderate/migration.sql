-- Close the community:moderate hole.
--
-- VERIFIED on prod 2026-11-20: the SYSTEM 'owner' role carried
-- 'community:moderate', and every self-registered user is linked to it on
-- their personal workspace (73 owners). FeedAdminController and
-- CommunityAdminController checked that code through the TENANT
-- PermissionsGuard, so any signup could list every feed report platform-wide
-- (reporter names and details included), hide or remove anyone's post or
-- comment, and resolve community flags.
--
-- Same shape as the digests:review fix in 20260920140000_platform_role_grants:
-- moderating the cross-org community is a PLATFORM capability. The code is
-- now in PLATFORM_SCOPE_EXACT_CODES (rbac/platform-scope.ts), the controllers
-- use PlatformPermissionsGuard, and the capability travels only through
-- platform_role_grants. admin and editor keep the code; they are granted as
-- platform roles; only the system owner role and org-scoped custom roles
-- lose it.
DELETE FROM role_permissions rp
USING role_definitions rd, permissions p
WHERE rp.role_id = rd.id
  AND rp.permission_id = p.id
  AND rd.slug = 'owner' AND rd.is_system = true AND rd.organization_id IS NULL
  AND p.code = 'community:moderate';

-- Organization-scoped custom roles cannot hold a platform code either
-- (RolesService refuses to assign one, and would refuse any later edit of a
-- role that still carried it). The code is inert on them once the controllers
-- use PlatformPermissionsGuard; strip it so the stored state matches the rule.
DELETE FROM role_permissions rp
USING role_definitions rd, permissions p
WHERE rp.role_id = rd.id
  AND rp.permission_id = p.id
  AND rd.organization_id IS NOT NULL
  AND p.code = 'community:moderate';

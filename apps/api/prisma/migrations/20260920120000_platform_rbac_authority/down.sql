-- Manual rollback for 20260920120000_platform_rbac_authority.
--
-- Prisma Migrate has no automatic down path, so this file is applied by hand
-- (`psql -1 -f down.sql`). It is idempotent and safe to re-run.
--
-- ORDER MATTERS on the way back: restore the owner grant FIRST, then remove
-- the platform membership. Reverse that and there is a window with no
-- reviewers at all.
--
-- Roll this back only together with reverting the application change. With the
-- app still deployed, step 2 below removes the only membership that resolves
-- isPlatformAdmin and locks the superadmin out.

-- 1. Re-grant digests:review to the SYSTEM owner role.
INSERT INTO role_permissions (id, role_id, permission_id)
SELECT gen_random_uuid(), rd.id, p.id
FROM role_definitions rd, permissions p
WHERE rd.slug = 'owner' AND rd.is_system = true AND rd.organization_id IS NULL
  AND p.code = 'digests:review'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = rd.id AND rp.permission_id = p.id
  );

-- 2. Remove the platform-org admin grant and membership added by step 2 of the
--    forward migration. The personal-workspace admin grant from
--    20260702120000_strip_owner_platform_admin is left untouched, so the
--    reverted application code still resolves isPlatformAdmin = true.
DELETE FROM member_roles mr
USING organization_members om, users u
WHERE mr.organization_member_id = om.id
  AND om.user_id = u.id
  AND om.organization_id = '00000000-0000-0000-0000-000000000001'
  AND u.email = 'bma5871@gmail.com';

DELETE FROM organization_members om
USING users u
WHERE om.user_id = u.id
  AND om.organization_id = '00000000-0000-0000-0000-000000000001'
  AND u.email = 'bma5871@gmail.com';

-- Manual rollback for 20260920140000_platform_role_grants.
--
-- Prisma has no native down migrations, so this file is never executed
-- automatically. Run it by hand (psql -f) if the forward migration has to be
-- reverted, then delete the row for this migration from `_prisma_migrations`.
--
-- WARNING: step 1 destroys every platform staff grant. Those grants are only
-- ever created by a human through the panel or the bootstrap CLI, so they
-- cannot be regenerated — export them first:
--   COPY (SELECT * FROM platform_role_grants) TO '/tmp/platform_role_grants.csv' CSV HEADER;

-- 1. Drop the grant table (and with it every grant).
DROP TABLE IF EXISTS "platform_role_grants";

-- 2. Detach and remove the two platform permissions.
DELETE FROM role_permissions rp
USING permissions p
WHERE rp.permission_id = p.id
  AND p.code IN ('platform-staff:manage', 'platform-roles:manage');

DELETE FROM permissions
WHERE code IN ('platform-staff:manage', 'platform-roles:manage');

-- 3. Restore digests:review on the SYSTEM owner role.
--    This re-opens the hole the forward migration closed: every
--    self-registered user regains HTTP 200 on /admin/digests/review-queue.
INSERT INTO role_permissions (id, role_id, permission_id)
SELECT gen_random_uuid(), rd.id, p.id
FROM role_definitions rd
JOIN permissions p ON p.code = 'digests:review'
WHERE rd.slug = 'owner' AND rd.is_system = true AND rd.organization_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Step 5 of the forward migration (deleting owner→* hierarchy edges) is NOT
-- reversed: there were no such edges to begin with, and re-creating one would
-- re-grant admin:* to every owner — the exact leak migration
-- 20260702120000_strip_owner_platform_admin exists to prevent.

-- Every self-registered user owns a personal workspace and is linked to the
-- SYSTEM 'owner' role, which granted ALL permissions — including the 13
-- cross-tenant platform admin:* codes — so every signup resolved
-- isPlatformAdmin=true (jwt.strategy: any effective perm starting 'admin:').
-- Fix: strip admin:* from the owner role, drop the owner→admin hierarchy edge
-- (PermissionsService inherits permissions parent→child, so the edge alone
-- would re-grant admin:* to every owner), and re-grant platform admin to an
-- explicit allowlist. Single file = single transaction: no admin gap.

-- 1. Remove platform admin:* from the SYSTEM 'owner' role. Owners keep all
--    tenant-scoped permissions; only cross-tenant platform codes are stripped.
DELETE FROM role_permissions rp
USING role_definitions rd, permissions p
WHERE rp.role_id = rd.id
  AND rp.permission_id = p.id
  AND rd.slug = 'owner' AND rd.is_system = true AND rd.organization_id IS NULL
  AND p.code LIKE 'admin:%';

-- 2. Drop the owner→admin hierarchy edge. Effective-permission resolution
--    walks the hierarchy downward (parent inherits child permissions), so
--    with this edge in place every owner would still inherit the admin
--    role's admin:* codes even after step 1.
DELETE FROM role_hierarchy rh
USING role_definitions parent_rd, role_definitions child_rd
WHERE rh.parent_role_id = parent_rd.id
  AND rh.child_role_id = child_rd.id
  AND parent_rd.slug = 'owner' AND parent_rd.is_system = true AND parent_rd.organization_id IS NULL
  AND child_rd.slug = 'admin' AND child_rd.is_system = true AND child_rd.organization_id IS NULL;

-- 3. Re-grant platform admin to the explicit allowlist by linking their
--    personal-workspace (owner) membership to the SYSTEM 'admin' role. Idempotent.
INSERT INTO member_roles (id, organization_member_id, role_definition_id, assigned_by_user_id, created_at)
SELECT gen_random_uuid(), om.id, rd.id, om.user_id, now()
FROM organization_members om
JOIN users u ON u.id = om.user_id
JOIN role_definitions rd
  ON rd.slug = 'admin' AND rd.is_system = true AND rd.organization_id IS NULL
WHERE om.role = 'owner'
  AND u.email IN (
    'bma5871@gmail.com',
    'programmingfiles5871@gmail.com',
    'libertasianphilippines@gmail.com',
    'libertasian.play.reviewer@gmail.com'
  )
  AND NOT EXISTS (
    SELECT 1 FROM member_roles mr
    WHERE mr.organization_member_id = om.id
      AND mr.role_definition_id = rd.id
  );

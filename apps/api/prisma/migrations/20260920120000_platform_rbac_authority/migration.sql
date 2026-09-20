-- Platform RBAC authority: make editorial capability a property of platform
-- staffing rather than of owning a personal workspace.
--
-- Two halves, and they are inseparable — run as one file, one transaction, so
-- there is no window in which admin access is gone.
--
--  (a) The SYSTEM `owner` role still carried `digests:review`. Every
--      self-registered user is linked to that shared role on their personal
--      workspace, so every signup satisfied the review-queue guard
--      (@RequiredPermissions(['digests:review','admin:review-queue'], 'any')),
--      which resolves permissions against the caller's CURRENT org. Verified
--      on prod 2026-09-20: an ordinary signup got HTTP 200 on
--      GET /api/v1/admin/digests/review-queue.
--
--  (b) The application change that ships with this migration rescopes
--      isPlatformAdmin to the PLATFORM organization. bma5871@gmail.com's
--      `admin` grant currently sits on his PERSONAL workspace membership
--      (see 20260702120000_strip_owner_platform_admin step 3), and he is not
--      a member of the platform org at all. Without step 2 below, deploying
--      that change locks the only superadmin out of the admin panel.

-- ---------------------------------------------------------------------------
-- 1. Strip digests:review from the SYSTEM owner role.
--
-- Scoped to is_system = true AND organization_id IS NULL AND slug = 'owner':
-- the shared system role only. Org-custom roles and every other role are
-- untouched, including any org that deliberately granted review rights.
-- Naturally idempotent — a second run deletes nothing.
-- ---------------------------------------------------------------------------
DELETE FROM role_permissions rp
USING role_definitions rd, permissions p
WHERE rp.role_id = rd.id
  AND rp.permission_id = p.id
  AND rd.slug = 'owner' AND rd.is_system = true AND rd.organization_id IS NULL
  AND p.code = 'digests:review';

-- ---------------------------------------------------------------------------
-- 2. Ensure bma5871@gmail.com is ACTIVE platform staff with the system
--    `admin` role ON THE PLATFORM ORG.
--
-- Matched by email, never by hardcoded UUID, so it resolves per environment.
-- Both statements no-op cleanly when the user or the platform org is absent
-- (dev/CI databases seeded without them) and when the rows already exist.
-- ---------------------------------------------------------------------------

-- 2a. Active membership on the platform org.
INSERT INTO organization_members (id, organization_id, user_id, role, status, created_at)
SELECT gen_random_uuid(), o.id, u.id, 'admin', 'active', now()
FROM users u
JOIN organizations o ON o.id = '00000000-0000-0000-0000-000000000001'
WHERE u.email = 'bma5871@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = o.id AND om.user_id = u.id
  );

-- Membership may pre-exist in a non-active state; platform resolution requires
-- status = 'active'.
UPDATE organization_members om
SET status = 'active'
FROM users u
WHERE om.user_id = u.id
  AND om.organization_id = '00000000-0000-0000-0000-000000000001'
  AND u.email = 'bma5871@gmail.com'
  AND om.status <> 'active';

-- 2b. Link that membership to the SYSTEM `admin` role. This — not the legacy
--     `role` column above — is what getEffectivePermissions reads.
INSERT INTO member_roles (id, organization_member_id, role_definition_id, assigned_by_user_id, created_at)
SELECT gen_random_uuid(), om.id, rd.id, om.user_id, now()
FROM organization_members om
JOIN users u ON u.id = om.user_id
JOIN role_definitions rd
  ON rd.slug = 'admin' AND rd.is_system = true AND rd.organization_id IS NULL
WHERE om.organization_id = '00000000-0000-0000-0000-000000000001'
  AND om.status = 'active'
  AND u.email = 'bma5871@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM member_roles mr
    WHERE mr.organization_member_id = om.id
      AND mr.role_definition_id = rd.id
  );

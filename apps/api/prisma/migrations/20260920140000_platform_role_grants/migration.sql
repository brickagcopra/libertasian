-- Platform role grants: admin capability as a grant on a PERSON.
--
-- Why a new table instead of reusing member_roles: every authorization path
-- we have is keyed on an organization_members row, and login picks a user's
-- OLDEST membership (auth.service.ts) with no org-switch endpoint — so a
-- user's JWT organization is permanently their personal workspace. An
-- org-scoped grant can therefore never be seen by a guard for anybody except
-- the seeded org's members. Staff are not members of a "platform org"; they
-- belong to no organization at all. Hence: user_id + role_definition_id, and
-- deliberately NO organization_id column.
--
-- This migration INSERTS ZERO ROWS into platform_role_grants. Capability is
-- only ever conferred by a human, through the staff panel or the interactive
-- bootstrap CLI (`pnpm --filter api platform:grant`). Nothing here, in a seed,
-- or in a startup hook may hand anyone access.
--
-- Idempotent: safe to re-run. See down.sql in this folder for the manual
-- rollback (Prisma has no native down migrations).

-- 1. The grant table. No organization_id — that absence is the design.
CREATE TABLE IF NOT EXISTS "platform_role_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_definition_id" UUID NOT NULL,
    "granted_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_role_grants_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'platform_role_grants_user_id_fkey'
    ) THEN
        ALTER TABLE "platform_role_grants"
            ADD CONSTRAINT "platform_role_grants_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'platform_role_grants_role_definition_id_fkey'
    ) THEN
        ALTER TABLE "platform_role_grants"
            ADD CONSTRAINT "platform_role_grants_role_definition_id_fkey"
            FOREIGN KEY ("role_definition_id") REFERENCES "role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'platform_role_grants_granted_by_user_id_fkey'
    ) THEN
        ALTER TABLE "platform_role_grants"
            ADD CONSTRAINT "platform_role_grants_granted_by_user_id_fkey"
            FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_role_grant"
    ON "platform_role_grants"("user_id", "role_definition_id");
CREATE INDEX IF NOT EXISTS "idx_platform_role_grants_user"
    ON "platform_role_grants"("user_id");
CREATE INDEX IF NOT EXISTS "idx_platform_role_grants_expires"
    ON "platform_role_grants"("expires_at");

-- 2. Two new permissions guarding the staff panel itself. Defining a
--    permission and wiring it to a role is schema, not a grant to a person:
--    nobody holds the admin role by virtue of this statement.
INSERT INTO permissions (id, code, resource, action, category, description, is_system, created_at)
VALUES
  (gen_random_uuid(), 'platform-staff:manage', 'platform-staff', 'manage', 'admin',
   'Grant and revoke platform staff roles (no organization)', true, now()),
  (gen_random_uuid(), 'platform-roles:manage', 'platform-roles', 'manage', 'admin',
   'Create and edit platform-scope roles that can be granted to staff', true, now())
ON CONFLICT (code) DO NOTHING;

-- 3. Attach both to the SYSTEM admin role only (is_system, no organization).
INSERT INTO role_permissions (id, role_id, permission_id)
SELECT gen_random_uuid(), rd.id, p.id
FROM role_definitions rd
JOIN permissions p ON p.code IN ('platform-staff:manage', 'platform-roles:manage')
WHERE rd.slug = 'admin' AND rd.is_system = true AND rd.organization_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. Close the john@gmail.com hole.
--
--    VERIFIED on prod 2026-09-21: an ordinary self-registered user gets the
--    SYSTEM 'owner' role on their own personal workspace, that role carries
--    'digests:review', and DigestsAdminController accepts
--    {digests:review, admin:review-queue} with mode 'any' — so every signup
--    got HTTP 200 on GET /admin/digests/review-queue.
--
--    Owner is a TENANT role: full authority over your own workspace. Reviewing
--    the shared editorial corpus is a PLATFORM capability and now travels only
--    through platform_role_grants. Only the system owner role is touched;
--    admin, editor and reviewer keep digests:review, and org-custom roles that
--    happen to be called 'owner' are excluded by the is_system/organization_id
--    predicates.
DELETE FROM role_permissions rp
USING role_definitions rd, permissions p
WHERE rp.role_id = rd.id
  AND rp.permission_id = p.id
  AND rd.slug = 'owner' AND rd.is_system = true AND rd.organization_id IS NULL
  AND p.code = 'digests:review';

-- 5. Belt and braces: the owner role must not reach digests:review through the
--    hierarchy either. PermissionsService BFS inherits permissions downward
--    (parent gains child permissions), so a future owner→reviewer edge would
--    silently re-open step 4. There is no owner→* edge today (migration
--    20260702120000 removed owner→admin); this asserts the state rather than
--    assuming it.
DELETE FROM role_hierarchy rh
USING role_definitions parent_rd
WHERE rh.parent_role_id = parent_rd.id
  AND parent_rd.slug = 'owner' AND parent_rd.is_system = true AND parent_rd.organization_id IS NULL;

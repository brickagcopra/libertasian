-- Link every active membership to the SYSTEM role definition matching the
-- legacy `organization_members.role` string it already carries.
--
-- Why it is needed: authorization reads `member_roles` ONLY.
-- PermissionsService.getEffectivePermissions and the isPlatformAdmin
-- derivation in jwt.strategy never look at `organization_members.role`, so a
-- membership with role='owner' and no member_roles row resolves to ZERO
-- permissions. Migration 20260611120000_backfill_legacy_member_roles did this
-- once, for the memberships that existed then — but registration wrote only
-- the legacy column, so every signup since has had an empty permission set.
-- 43 active owners on prod, measured 2026-09-21.
--
-- Those 43 are not broken today: OrganizationsService.assertRole has a
-- legacy-role fallback that covers managing your own workspace. This is
-- cleanup that lets the fallback be deleted, not a fix for a live outage.
-- Removing the fallback is the follow-up, after this is deployed and verified.
--
-- SAFE ONLY AFTER 20260920140000_platform_role_grants HAS BEEN DEPLOYED.
-- Before that migration the system `owner` role still carries
-- `digests:review`, and DigestsAdminController accepts
-- {digests:review, admin:review-queue} with mode 'any' — so running this
-- first would hand the editorial review queue to 43 ordinary signups. The
-- guard below refuses to run in that state rather than trusting the order.
--
-- The companion code change makes both registration paths write this row, so
-- this is the last backfill of its kind.
--
-- Idempotent: the NOT EXISTS clause makes a re-run a no-op. See down.sql for
-- the manual rollback (Prisma has no native down migrations).

-- 0. Refuse to run before the platform-grants migration has stripped
--    digests:review from the system owner role.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM role_permissions rp
        JOIN role_definitions rd ON rd.id = rp.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rd.slug = 'owner' AND rd.is_system = true AND rd.organization_id IS NULL
          AND p.code = 'digests:review'
    ) THEN
        RAISE EXCEPTION
            'Refusing to backfill member_roles: the SYSTEM owner role still carries digests:review. Deploy 20260920140000_platform_role_grants first, or this hands the editorial review queue to every backfilled owner.';
    END IF;
END
$$;

-- 1. The backfill. Matches by slug against SYSTEM roles only, so an
--    org-custom role that happens to share a slug is never linked.
INSERT INTO member_roles (id, organization_member_id, role_definition_id, assigned_by_user_id, created_at)
SELECT gen_random_uuid(), om.id, rd.id, om.user_id, now()
FROM organization_members om
JOIN role_definitions rd
  ON rd.slug = om.role
 AND rd.is_system = true
 AND rd.organization_id IS NULL
WHERE om.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM member_roles mr
    WHERE mr.organization_member_id = om.id
      AND mr.role_definition_id = rd.id
  );

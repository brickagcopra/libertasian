-- Manual rollback for 20260921120000_backfill_member_roles_for_legacy_owners.
--
-- Prisma has no native down migrations, so this is never run automatically.
-- Apply by hand (psql -f), then delete this migration's row from
-- `_prisma_migrations`.
--
-- WARNING: this cannot distinguish a row the backfill created from one a human
-- assigned through the RBAC panel that happens to match the member's legacy
-- role. It removes both. Scope it with `created_at` if you need to be precise:
--   AND mr.created_at >= '<the deploy timestamp>'

DELETE FROM member_roles mr
USING organization_members om, role_definitions rd
WHERE mr.organization_member_id = om.id
  AND mr.role_definition_id = rd.id
  AND rd.slug = om.role
  AND rd.is_system = true
  AND rd.organization_id IS NULL
  AND mr.assigned_by_user_id = om.user_id;

-- The registration dual-write is a code change; reverting this SQL without
-- reverting the deploy means new signups keep getting their row, which is
-- correct and harmless.

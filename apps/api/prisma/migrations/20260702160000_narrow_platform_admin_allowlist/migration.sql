-- The 20260702120000_strip_owner_platform_admin migration re-granted platform
-- admin (SYSTEM 'admin' role via member_roles) to a 4-email allowlist. Three of
-- those accounts must NOT be platform admins; only bma5871@gmail.com and
-- admin@libertasian.com retain platform admin. The three rows were already
-- deleted directly in prod (2026-07-02, live-verified) — this migration
-- codifies the revocation for every other environment. Data-only, naturally
-- idempotent: no-op where the rows are already gone or the emails are absent.

-- Revoke the SYSTEM 'admin' role from the three de-listed accounts. Joins only —
-- no hardcoded UUIDs — so it resolves per-environment.
DELETE FROM member_roles mr
USING role_definitions rd, organization_members om, users u
WHERE mr.role_definition_id = rd.id
  AND mr.organization_member_id = om.id
  AND om.user_id = u.id
  AND rd.slug = 'admin' AND rd.is_system = true AND rd.organization_id IS NULL
  AND u.email IN (
    'programmingfiles5871@gmail.com',
    'libertasianphilippines@gmail.com',
    'libertasian.play.reviewer@gmail.com'
  );

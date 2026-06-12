-- Backfill member_roles for legacy organization_members.role values never linked
-- to a system role_definition (orgs predating the org-create RBAC dual-write, or
-- where the swallowing dual-write failed). Idempotent: skips already-linked members
-- and only links legacy roles that have a matching system role_definition by slug.
INSERT INTO member_roles (id, organization_member_id, role_definition_id, assigned_by_user_id, created_at)
SELECT gen_random_uuid(), om.id, rd.id, om.user_id, now()
FROM organization_members om
JOIN role_definitions rd
  ON rd.slug = om.role AND rd.is_system = true AND rd.organization_id IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM member_roles mr
  WHERE mr.organization_member_id = om.id
    AND mr.role_definition_id = rd.id
);

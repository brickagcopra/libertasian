-- Seed the `previewOnly` PlanEntitlement row for every existing plan so the
-- gate is enforced on a freshly-migrated DB even when seeds haven't been
-- re-run. Free plans get TRUE (gated to one item per corpus type on public
-- read endpoints); edu/pro/team/enterprise get FALSE.
--
-- Idempotent: ON CONFLICT (plan_id, key) DO NOTHING. The matching unique
-- object is the `uq_plan_entitlement_key` UNIQUE INDEX on (plan_id, key) —
-- `ON CONFLICT ON CONSTRAINT` only works for named CONSTRAINTs, so we use
-- the column form here. Existing rows are NEVER overwritten — admin edits
-- via the Plans entitlement editor are preserved.

INSERT INTO plan_entitlements (id, plan_id, key, value_type, boolean_value, description)
SELECT
  gen_random_uuid(),
  p.id,
  'previewOnly',
  'boolean',
  CASE WHEN p.code = 'free' THEN TRUE ELSE FALSE END,
  'Public read endpoints return one item per corpus type'
FROM plans p
WHERE p.code IN ('free', 'edu', 'pro', 'team', 'enterprise')
ON CONFLICT (plan_id, key) DO NOTHING;

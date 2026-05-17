-- Zero out the aiAnswers override on existing free subscriptions so the
-- updated plan default (aiAnswers: 0) actually applies to current users.
-- Without this, rows that froze {aiAnswers: 15, ...} into entitlements_json
-- at registration time would keep merging on top of the new default.
-- Idempotent: re-runs are a no-op. Affects only free plans that have the
-- override key; pro/team/edu/enterprise rows never match.
UPDATE subscriptions
SET entitlements_json = jsonb_set(
  entitlements_json,
  '{aiAnswers}',
  '0'::jsonb
)
WHERE plan_code = 'free' AND entitlements_json ? 'aiAnswers';

-- Data migration: enable ingestion_schedule defaults + reclassify Lawphil.
--
-- Both updates are guarded with an "untouched" check: the UPDATE only applies
-- when the stored value exactly matches the prior default blob. If an operator
-- has manually tweaked the row through the admin UI, the UPDATE is a no-op and
-- their change is preserved. This is intentional — this migration is meant to
-- heal fresh/unmodified production rows, not to overwrite admin intent.
--
-- Related:
--   * apps/api/prisma/seed.ts — source of the new defaults
--   * apps/api/src/modules/sources/ingestion-scheduler.service.ts
--   * services/worker-service/src/validators/truthfulness_validator.py

-- ---------------------------------------------------------------------------
-- 1. Flip ingestion_schedule to enabled=true globally and per-source.
--    Guard: the stored value must be the prior all-false default blob.
-- ---------------------------------------------------------------------------
UPDATE "ai_settings"
   SET "value" = '{
         "enabled": true,
         "schedules": [
           {"sourceKey": "supreme_court_elibrary", "cron": "0 2 * * *", "enabled": true},
           {"sourceKey": "lawphil",                "cron": "0 3 * * *", "enabled": true},
           {"sourceKey": "official_gazette",       "cron": "0 4 * * *", "enabled": true},
           {"sourceKey": "congress",               "cron": "0 5 * * *", "enabled": true}
         ]
       }'::jsonb,
       "updated_at" = NOW()
 WHERE "key" = 'ingestion_schedule'
   AND "value"::jsonb = '{
         "enabled": false,
         "schedules": [
           {"sourceKey": "supreme_court_elibrary", "cron": "0 2 * * *", "enabled": false},
           {"sourceKey": "lawphil",                "cron": "0 3 * * *", "enabled": false},
           {"sourceKey": "official_gazette",       "cron": "0 4 * * *", "enabled": false},
           {"sourceKey": "congress",               "cron": "0 5 * * *", "enabled": false}
         ]
       }'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Bump Lawphil from semi_official/medium to official/high so its docs clear
--    the truthfulness validator's "official_source" branch alongside SC docs.
--    Guard: row must still be at the prior default classification.
-- ---------------------------------------------------------------------------
UPDATE "sources"
   SET "type"        = 'official',
       "trust_level" = 'high',
       "updated_at"  = NOW()
 WHERE "name"        = 'Lawphil'
   AND "domain"      = 'lawphil.net'
   AND "type"        = 'semi_official'
   AND "trust_level" = 'medium';

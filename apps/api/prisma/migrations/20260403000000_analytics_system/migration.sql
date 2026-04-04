-- Analytics System Migration
-- Creates analytics tables with monthly partitioning for analytics_events
-- and append-only constraints per LIBERTASIAN-ANALYTICS.md spec

-- ==========================================================================
-- 1. analytics_events — partitioned by month on created_at
-- ==========================================================================

-- Drop the Prisma-created unpartitioned table if it exists (Prisma migrate
-- will create it, but we need it partitioned)
DROP TABLE IF EXISTS "analytics_events";

CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_name" VARCHAR(100) NOT NULL,
    "event_category" VARCHAR(50) NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,
    "session_id" VARCHAR(100),
    "device_type" VARCHAR(20),
    "properties" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

-- Indexes on the parent (inherited by partitions)
CREATE INDEX "idx_analytics_event_name" ON "analytics_events" ("event_name");
CREATE INDEX "idx_analytics_event_category" ON "analytics_events" ("event_category");
CREATE INDEX "idx_analytics_event_session" ON "analytics_events" ("session_id");
CREATE INDEX "idx_analytics_event_user" ON "analytics_events" ("user_id");
CREATE INDEX "idx_analytics_event_created" ON "analytics_events" ("created_at");
CREATE INDEX "idx_analytics_event_org" ON "analytics_events" ("organization_id");

-- Create initial partitions for current month and next 3 months
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..3 LOOP
        start_date := date_trunc('month', CURRENT_DATE + (i || ' months')::interval)::date;
        end_date := (start_date + interval '1 month')::date;
        partition_name := 'analytics_events_' || to_char(start_date, 'YYYY_MM');

        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF analytics_events FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            start_date,
            end_date
        );
    END LOOP;
END $$;

-- ==========================================================================
-- 2. Function to auto-create monthly partitions
-- Called by a cron job or on-demand before month boundary
-- ==========================================================================

CREATE OR REPLACE FUNCTION create_analytics_partition_if_not_exists(target_date DATE)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    start_date := date_trunc('month', target_date)::date;
    end_date := (start_date + interval '1 month')::date;
    partition_name := 'analytics_events_' || to_char(start_date, 'YYYY_MM');

    -- Check if partition already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = partition_name
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF analytics_events FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            start_date,
            end_date
        );
        RETURN 'created: ' || partition_name;
    END IF;

    RETURN 'exists: ' || partition_name;
END $$;

-- ==========================================================================
-- 3. Function to ensure next month partition exists (called by cron)
-- ==========================================================================

CREATE OR REPLACE FUNCTION ensure_analytics_partitions()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Ensure current month and next 2 months exist
    PERFORM create_analytics_partition_if_not_exists(CURRENT_DATE);
    PERFORM create_analytics_partition_if_not_exists((CURRENT_DATE + interval '1 month')::date);
    PERFORM create_analytics_partition_if_not_exists((CURRENT_DATE + interval '2 months')::date);
END $$;

-- ==========================================================================
-- 4. analytics_sessions
-- ==========================================================================

CREATE TABLE IF NOT EXISTS "analytics_sessions" (
    "id" VARCHAR(100) NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,
    "device_type" VARCHAR(20),
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "ended_at" TIMESTAMPTZ,
    "duration_seconds" INTEGER,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "entry_path" VARCHAR(500),
    "exit_path" VARCHAR(500),
    "referrer" VARCHAR(500),
    "properties" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "analytics_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_analytics_session_user" ON "analytics_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_analytics_session_org" ON "analytics_sessions" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_analytics_session_started" ON "analytics_sessions" ("started_at");

-- ==========================================================================
-- 5. analytics_daily_aggregates
-- ==========================================================================

CREATE TABLE IF NOT EXISTS "analytics_daily_aggregates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "date" DATE NOT NULL,
    "metric_name" VARCHAR(100) NOT NULL,
    "dimension" VARCHAR(100),
    "metric_value" BIGINT NOT NULL,
    "unique_users" INTEGER NOT NULL DEFAULT 0,
    "organization_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "analytics_daily_aggregates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_daily_aggregate"
    ON "analytics_daily_aggregates" ("date", "metric_name", "dimension", "organization_id");
CREATE INDEX IF NOT EXISTS "idx_daily_aggregate_date" ON "analytics_daily_aggregates" ("date");
CREATE INDEX IF NOT EXISTS "idx_daily_aggregate_metric" ON "analytics_daily_aggregates" ("metric_name");
CREATE INDEX IF NOT EXISTS "idx_daily_aggregate_org" ON "analytics_daily_aggregates" ("organization_id");

-- ==========================================================================
-- 6. analytics_funnel_steps
-- ==========================================================================

CREATE TABLE IF NOT EXISTS "analytics_funnel_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "funnel_name" VARCHAR(100) NOT NULL,
    "step_name" VARCHAR(100) NOT NULL,
    "step_order" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "entered_count" INTEGER NOT NULL DEFAULT 0,
    "completed_count" INTEGER NOT NULL DEFAULT 0,
    "dropped_count" INTEGER NOT NULL DEFAULT 0,
    "median_time_seconds" INTEGER,
    CONSTRAINT "analytics_funnel_steps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_funnel_step_funnel_date"
    ON "analytics_funnel_steps" ("funnel_name", "date");

-- ==========================================================================
-- 7. analytics_retention_cohorts
-- ==========================================================================

CREATE TABLE IF NOT EXISTS "analytics_retention_cohorts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cohort_week" DATE NOT NULL,
    "retention_week" INTEGER NOT NULL,
    "user_count" INTEGER NOT NULL,
    "returning_count" INTEGER NOT NULL,
    "retention_rate" REAL NOT NULL,
    "plan_segment" VARCHAR(20),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "analytics_retention_cohorts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_retention_cohort"
    ON "analytics_retention_cohorts" ("cohort_week", "retention_week", "plan_segment");
CREATE INDEX IF NOT EXISTS "idx_retention_cohort_week"
    ON "analytics_retention_cohorts" ("cohort_week");

-- ==========================================================================
-- 8. Append-only constraint for analytics_events
-- Revoke UPDATE and DELETE on analytics_events for the application role.
-- The actual role name depends on deployment — adjust if needed.
-- ==========================================================================

-- Prevent application-level UPDATE/DELETE via trigger (defense-in-depth)
CREATE OR REPLACE FUNCTION prevent_analytics_event_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'analytics_events is append-only. UPDATE and DELETE are prohibited.';
END $$;

CREATE OR REPLACE TRIGGER trg_analytics_events_no_update
    BEFORE UPDATE ON analytics_events
    FOR EACH ROW
    EXECUTE FUNCTION prevent_analytics_event_modification();

CREATE OR REPLACE TRIGGER trg_analytics_events_no_delete
    BEFORE DELETE ON analytics_events
    FOR EACH ROW
    EXECUTE FUNCTION prevent_analytics_event_modification();

-- ==========================================================================
-- 9. Auto-delete raw events older than 90 days (retention policy)
-- Called by a scheduled job
-- ==========================================================================

CREATE OR REPLACE FUNCTION cleanup_old_analytics_events()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    cutoff_date DATE;
    partition_name TEXT;
    dropped_count INTEGER := 0;
    rec RECORD;
BEGIN
    cutoff_date := (CURRENT_DATE - interval '90 days')::date;

    -- Drop partitions older than cutoff
    FOR rec IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_inherits i ON c.oid = i.inhrelid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'analytics_events'
        AND c.relname LIKE 'analytics_events_%'
    LOOP
        -- Extract date from partition name (analytics_events_YYYY_MM)
        DECLARE
            part_date DATE;
        BEGIN
            part_date := to_date(
                replace(replace(rec.relname, 'analytics_events_', ''), '_', '-') || '-01',
                'YYYY-MM-DD'
            );
            IF part_date + interval '1 month' <= cutoff_date THEN
                EXECUTE format('DROP TABLE IF EXISTS %I', rec.relname);
                dropped_count := dropped_count + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Skip partitions with unexpected naming
            NULL;
        END;
    END LOOP;

    RETURN dropped_count;
END $$;

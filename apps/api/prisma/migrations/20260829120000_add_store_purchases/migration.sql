-- ==========================================================================
-- Store purchases (IAP). ADDITIVE ONLY: nothing existing is altered.
--
-- `subscriptions` needs no ALTER — `provider` is varchar(20) with no CHECK
-- constraint, so 'app_store' / 'play_store' are already legal values.
-- See docs/architecture/iap-entitlements-design.md D6.
-- ==========================================================================

-- 1. One row per store transaction the conduit reports to us.
CREATE TABLE "store_purchases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID,
    "store" VARCHAR(20) NOT NULL,
    "environment" VARCHAR(10) NOT NULL,
    "app_user_id" VARCHAR(255) NOT NULL,
    "product_id" VARCHAR(255) NOT NULL,
    "entitlement_ids" JSONB NOT NULL DEFAULT '[]',
    "plan_code" VARCHAR(50) NOT NULL,
    "billing_period" VARCHAR(20) NOT NULL,
    "rc_transaction_id" VARCHAR(255) NOT NULL,
    "rc_original_transaction_id" VARCHAR(255) NOT NULL,
    "store_transaction_id" TEXT,
    "period_type" VARCHAR(20) NOT NULL,
    "purchased_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "refunded_at" TIMESTAMPTZ,
    "transferred_at" TIMESTAMPTZ,
    "transferred_to_org_id" UUID,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_purchases_pkey" PRIMARY KEY ("id")
);

-- The idempotency guarantee for a transaction: one row per (store, txn).
CREATE UNIQUE INDEX "uq_store_purchases_txn"
    ON "store_purchases" ("store", "rc_transaction_id");
CREATE INDEX "idx_store_purchases_org"
    ON "store_purchases" ("organization_id");
CREATE INDEX "idx_store_purchases_original"
    ON "store_purchases" ("store", "rc_original_transaction_id");
CREATE INDEX "idx_store_purchases_app_user"
    ON "store_purchases" ("app_user_id");
CREATE INDEX "idx_store_purchases_sub"
    ON "store_purchases" ("subscription_id");

ALTER TABLE "store_purchases"
    ADD CONSTRAINT "store_purchases_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_purchases"
    ADD CONSTRAINT "store_purchases_transferred_to_org_id_fkey"
    FOREIGN KEY ("transferred_to_org_id") REFERENCES "organizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "store_purchases"
    ADD CONSTRAINT "store_purchases_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Append-only receipt log: durable idempotency, plus the audit artefact a
--    refund months later has to be explained against.
CREATE TABLE "store_webhook_events" (
    "id" UUID NOT NULL,
    "rc_event_id" VARCHAR(255) NOT NULL,
    "conduit" VARCHAR(20) NOT NULL DEFAULT 'revenuecat',
    "event_type" VARCHAR(50) NOT NULL,
    "store" VARCHAR(20),
    "environment" VARCHAR(10) NOT NULL,
    "app_user_id" VARCHAR(255) NOT NULL,
    "organization_id" UUID,
    "payload_json" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "processing_error" TEXT,

    CONSTRAINT "store_webhook_events_pkey" PRIMARY KEY ("id")
);

-- THE durable idempotency key. A replayed rc_event_id is rejected here even
-- after the 7-day Redis key has expired — which is the case a refund arriving
-- 60 days later actually exercises.
CREATE UNIQUE INDEX "store_webhook_events_rc_event_id_key"
    ON "store_webhook_events" ("rc_event_id");
CREATE INDEX "idx_store_webhook_events_org_received"
    ON "store_webhook_events" ("organization_id", "received_at" DESC);
CREATE INDEX "idx_store_webhook_events_app_user"
    ON "store_webhook_events" ("app_user_id");
-- Partial index for the §9 reconciliation sweep over events that never
-- processed. DELIBERATE DATAMODEL DIVERGENCE: Prisma cannot express a partial
-- index, so this one exists in the database and NOT in schema.prisma. It is
-- the only difference between the two, it is additive, and `migrate deploy`
-- does not care — but a future `migrate dev` will offer to drop it. Keep it:
-- the alternative is a full index over a column that is non-null for every row
-- this query is designed NOT to return.
CREATE INDEX "idx_store_webhook_events_unprocessed"
    ON "store_webhook_events" ("received_at") WHERE "processed_at" IS NULL;

ALTER TABLE "store_webhook_events"
    ADD CONSTRAINT "store_webhook_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

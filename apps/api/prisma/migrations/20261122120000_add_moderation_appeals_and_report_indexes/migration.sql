-- Author appeals of moderation decisions, plus the indexes behind the
-- per-user daily report cap. Platform-wide like moderation_actions, so no
-- organization_id and no forTenant() entry.

-- One appeal per decision (UNIQUE moderation_action_id).
-- No DB-side default on "id": Prisma's @default(uuid()) generates it.
CREATE TABLE "moderation_appeals" (
    "id" UUID NOT NULL,
    "moderation_action_id" UUID NOT NULL,
    "appellant_user_id" UUID NOT NULL,
    "statement" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "decided_by_user_id" UUID,
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_appeals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "moderation_appeals_moderation_action_id_key" ON "moderation_appeals"("moderation_action_id");
CREATE INDEX "idx_moderation_appeals_status_created" ON "moderation_appeals"("status", "created_at");
CREATE INDEX "idx_moderation_appeals_appellant" ON "moderation_appeals"("appellant_user_id", "created_at" DESC);

ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_moderation_action_id_fkey" FOREIGN KEY ("moderation_action_id") REFERENCES "moderation_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_appellant_user_id_fkey" FOREIGN KEY ("appellant_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Daily report cap: count a reporter's reports over the last 24h in each table.
CREATE INDEX "idx_feed_post_report_reporter_created" ON "feed_post_reports"("reporter_user_id", "created_at");
DROP INDEX IF EXISTS "idx_feed_comment_report_reporter";
CREATE INDEX "idx_feed_comment_report_reporter_created" ON "feed_comment_reports"("reporter_user_id", "created_at");
CREATE INDEX "idx_community_flags_reporter_created" ON "community_flags"("reporter_user_id", "created_at");

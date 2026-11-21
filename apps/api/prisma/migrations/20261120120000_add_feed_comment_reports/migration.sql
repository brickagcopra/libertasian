-- Feed comment reports (App Store Guideline 1.2: user-generated content must
-- be reportable). Mirrors feed_post_reports, including the absence of
-- organization_id: the public feed is cross-org, so comment reports are
-- reviewed platform-wide and the table is not in the forTenant() model map.

-- CreateTable
-- No DB-side default on "id": Prisma's @default(uuid()) generates it.
CREATE TABLE "feed_comment_reports" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "reason" VARCHAR(30) NOT NULL,
    "details" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "resolved_by_user_id" UUID,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_comment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One report per user per comment; a duplicate is answered with 400.
CREATE UNIQUE INDEX "uq_feed_comment_report_comment_reporter"
    ON "feed_comment_reports"("comment_id", "reporter_user_id");

-- CreateIndex
-- Serves the moderation queue (status filter, newest first).
CREATE INDEX "idx_feed_comment_report_status_created"
    ON "feed_comment_reports"("status", "created_at" DESC);

-- CreateIndex
-- Serves the FK cascade when a reporter is purged.
CREATE INDEX "idx_feed_comment_report_reporter"
    ON "feed_comment_reports"("reporter_user_id");

-- AddForeignKey
ALTER TABLE "feed_comment_reports" ADD CONSTRAINT "feed_comment_reports_comment_id_fkey"
    FOREIGN KEY ("comment_id") REFERENCES "feed_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comment_reports" ADD CONSTRAINT "feed_comment_reports_reporter_user_id_fkey"
    FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comment_reports" ADD CONSTRAINT "feed_comment_reports_resolved_by_user_id_fkey"
    FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

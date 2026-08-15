-- App Store Guideline 1.2 requires UGC apps to offer user blocking alongside
-- the reporting we already have (feed_post_reports). App Review asked to see
-- both on the iOS 1.0 submission.
--
-- A block is SYMMETRIC for reads: if A blocks B, neither party sees the
-- other's feed posts or comments, and B cannot like, bookmark, comment on or
-- report A's posts. Only A can see or remove the row; B is never told.
-- Blocking is a view filter, not a data-deletion event: existing likes,
-- bookmarks, comments and reports are left intact so that unblocking restores
-- the prior state and a harasser cannot erase report evidence by provoking a
-- block.
--
-- No organization_id, mirroring feed_post_reports. The public feed is
-- cross-org by design, so a block cannot be tenant-scoped; this table is
-- deliberately absent from the forTenant() model map in prisma.service.ts.

-- CreateTable
-- No DB-side default on "id": Prisma's @default(uuid()) generates it in the
-- client. A gen_random_uuid() default here shows up as permanent
-- `migrate diff` drift (same note as account_restore_tokens).
CREATE TABLE "feed_user_blocks" (
    "id" UUID NOT NULL,
    "blocker_user_id" UUID NOT NULL,
    "blocked_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Enforces idempotency (a duplicate block is a no-op, not an error) and
-- serves the "who did I block" half of the symmetric lookup as a leftmost
-- prefix.
CREATE UNIQUE INDEX "uq_feed_user_block_pair"
    ON "feed_user_blocks"("blocker_user_id", "blocked_user_id");

-- CreateIndex
-- Serves the "who blocked me" half of the symmetric lookup, and the FK
-- cascade when a user is purged.
CREATE INDEX "idx_feed_user_block_blocked"
    ON "feed_user_blocks"("blocked_user_id");

-- CreateIndex
-- Serves the paginated unblock list under Settings.
CREATE INDEX "idx_feed_user_block_blocker_created"
    ON "feed_user_blocks"("blocker_user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "feed_user_blocks" ADD CONSTRAINT "feed_user_blocks_blocker_user_id_fkey"
    FOREIGN KEY ("blocker_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_user_blocks" ADD CONSTRAINT "feed_user_blocks_blocked_user_id_fkey"
    FOREIGN KEY ("blocked_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
-- A self-block row would make a user invisible to themselves in every feed.
-- FeedBlocksService rejects it with 400; this is defence in depth.
--
-- NOTE: this is the first CHECK constraint in this migrations directory.
-- Prisma has no CHECK support and `migrate diff` does not track them, so it
-- will not show up as schema drift.
ALTER TABLE "feed_user_blocks" ADD CONSTRAINT "ck_feed_user_block_not_self"
    CHECK ("blocker_user_id" <> "blocked_user_id");

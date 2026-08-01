-- Self-serve account deletion (Apple App Store 5.1.1(v) and Google Play both
-- require an in-app path to delete the account). Mirrors the policy already
-- published at /account-deletion: immediate deactivation, 30-day restore
-- window, purge completed within 30 days.
--
-- users.status gains two values: 'pending_deletion' (inside the restore window)
-- and 'deleted' (anonymized and purged). Login and refresh already reject any
-- status other than 'active', so no new auth check is needed.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "anonymized_at" TIMESTAMPTZ;

-- CreateIndex
-- The purge cron scans for rows past the 30-day window; both columns are NULL
-- for every live account, so these stay tiny.
CREATE INDEX "idx_users_deleted_at" ON "users"("deleted_at");
CREATE INDEX "idx_users_deletion_requested_at" ON "users"("deletion_requested_at");

-- AlterTable
-- A solo org (the deleting user is its only active member) is marked alongside
-- the user. The row survives — billing records are retained 5 years — but it is
-- no longer a live tenant.
ALTER TABLE "organizations" ADD COLUMN "deleted_at" TIMESTAMPTZ;

-- Emailed restore token for the 30-day window promised at /account-deletion.
--
-- Deleting an account revokes every refresh-token family and login refuses a
-- non-'active' status, so the in-session Undo (POST /users/me/deletion/cancel)
-- only works while the caller's 15-minute access token is alive. This table
-- backs the public restore endpoint that covers the remaining 30 days without
-- issuing any token to a pending_deletion account.
--
-- Mirrors password_resets: SHA-256 hash of a 256-bit random token, never the
-- token itself; single-use via used_at.

-- CreateTable
-- No DB-side default on "id": Prisma's @default(uuid()) generates it in the
-- client, and password_resets — the table this mirrors — has none either. A
-- gen_random_uuid() default here shows up as permanent `migrate diff` drift.
CREATE TABLE "account_restore_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_restore_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_account_restore_token" ON "account_restore_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "account_restore_tokens" ADD CONSTRAINT "account_restore_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

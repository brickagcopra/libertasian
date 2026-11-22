-- Per-account device limits (phase 1): the client-generated device id and a
-- human-readable device label travel with each refresh-token family so the
-- API can dedupe same-device sign-ins and evict the least recently used
-- device when a plan's cap is exceeded. Both nullable: older clients send
-- neither header.

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "device_id" VARCHAR(64),
ADD COLUMN     "device_name" VARCHAR(120);

-- CreateIndex
CREATE INDEX "idx_refresh_token_user_device" ON "refresh_tokens"("user_id", "device_id");

-- Apple Sign In (mobile ID-token exchange): store the identity token's `sub`
-- claim as the stable Apple account identifier, mirroring users.google_id.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "apple_id" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "users_apple_id_key" ON "users"("apple_id");

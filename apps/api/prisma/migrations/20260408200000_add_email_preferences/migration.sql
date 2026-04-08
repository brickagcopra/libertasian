-- AlterTable: Add email_verify_token_expires_at to users
ALTER TABLE "users" ADD COLUMN "email_verify_token_expires_at" TIMESTAMPTZ;

-- CreateTable: email_preferences
CREATE TABLE "email_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "transactional" BOOLEAN NOT NULL DEFAULT true,
    "subscription_updates" BOOLEAN NOT NULL DEFAULT true,
    "announcements" BOOLEAN NOT NULL DEFAULT true,
    "blog_notifications" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribe_token" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_preferences_user_id_key" ON "email_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_preferences_unsubscribe_token_key" ON "email_preferences"("unsubscribe_token");

-- AddForeignKey
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Moderation queue (App Store Guideline 1.2: timely action on reports and the
-- ability to eject abusive users). Platform-wide like the report tables, so
-- neither table carries organization_id or appears in the forTenant() map.

-- One row per moderation decision. Append-only by convention.
-- No DB-side default on "id": Prisma's @default(uuid()) generates it.
CREATE TABLE "moderation_actions" (
    "id" UUID NOT NULL,
    "moderator_user_id" UUID,
    "subject_user_id" UUID,
    "target_type" VARCHAR(30) NOT NULL,
    "target_id" UUID NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(40),
    "note" TEXT,
    "reports_resolved" INTEGER NOT NULL DEFAULT 0,
    "metadata_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_moderation_actions_target" ON "moderation_actions"("target_type", "target_id", "created_at" DESC);
CREATE INDEX "idx_moderation_actions_subject" ON "moderation_actions"("subject_user_id", "created_at" DESC);
CREATE INDEX "idx_moderation_actions_created" ON "moderation_actions"("created_at" DESC);

-- SET NULL, not CASCADE: a moderator or subject deleting their account must
-- not erase the record that a decision was taken.
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderator_user_id_fkey" FOREIGN KEY ("moderator_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Community participation restrictions (warning / suspension / ban).
CREATE TABLE "community_sanctions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(40) NOT NULL,
    "note" TEXT,
    "starts_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "issued_by_user_id" UUID,
    "revoked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_sanctions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_community_sanctions_user" ON "community_sanctions"("user_id", "created_at" DESC);
CREATE INDEX "idx_community_sanctions_active" ON "community_sanctions"("revoked_at", "ends_at");

ALTER TABLE "community_sanctions" ADD CONSTRAINT "community_sanctions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_sanctions" ADD CONSTRAINT "community_sanctions_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_sanctions" ADD CONSTRAINT "community_sanctions_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

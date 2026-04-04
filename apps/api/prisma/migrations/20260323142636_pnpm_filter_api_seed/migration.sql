-- AlterTable
ALTER TABLE "digests" ADD COLUMN     "avg_rating" REAL,
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vote_score" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "flashcard_sets" ADD COLUMN     "avg_rating" REAL,
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "reviewer_packs" ADD COLUMN     "avg_rating" REAL,
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "community_ratings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "review_title" VARCHAR(255),
    "review_body" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_votes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" UUID NOT NULL,
    "vote_type" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_flags" (
    "id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" UUID NOT NULL,
    "reason" VARCHAR(50) NOT NULL,
    "details" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "resolved_by_user_id" UUID,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expert_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expertise_type" VARCHAR(30) NOT NULL,
    "credential_details" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "review_note" TEXT,
    "reviewed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expert_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_community_ratings_entity" ON "community_ratings"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_community_ratings_entity_score" ON "community_ratings"("entity_type", "entity_id", "score");

-- CreateIndex
CREATE UNIQUE INDEX "uq_community_rating_user_entity" ON "community_ratings"("user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_community_votes_entity" ON "community_votes"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_community_vote_user_entity" ON "community_votes"("user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_community_flags_entity" ON "community_flags"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_community_flags_status" ON "community_flags"("status");

-- CreateIndex
CREATE UNIQUE INDEX "expert_verifications_user_id_key" ON "expert_verifications"("user_id");

-- CreateIndex
CREATE INDEX "idx_expert_verification_status" ON "expert_verifications"("status");

-- CreateIndex
CREATE INDEX "idx_digests_marketplace" ON "digests"("visibility", "avg_rating" DESC);

-- CreateIndex
CREATE INDEX "idx_digests_vote_score" ON "digests"("visibility", "vote_score" DESC);

-- CreateIndex
CREATE INDEX "idx_flashcard_sets_marketplace" ON "flashcard_sets"("visibility", "avg_rating" DESC);

-- CreateIndex
CREATE INDEX "idx_reviewer_packs_marketplace" ON "reviewer_packs"("visibility", "avg_rating" DESC);

-- AddForeignKey
ALTER TABLE "community_ratings" ADD CONSTRAINT "community_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_flags" ADD CONSTRAINT "community_flags_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_flags" ADD CONSTRAINT "community_flags_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert_verifications" ADD CONSTRAINT "expert_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

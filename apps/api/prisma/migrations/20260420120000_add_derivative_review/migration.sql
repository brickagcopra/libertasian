-- CreateTable
CREATE TABLE "derivative_reviews" (
    "id" UUID NOT NULL,
    "derivative_artifact_id" UUID NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "verdict" VARCHAR(20) NOT NULL,
    "notes" TEXT,
    "truthfulness_score" REAL,
    "completeness_score" REAL,
    "citation_accuracy_score" REAL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derivative_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "derivative_reviews_derivative_artifact_id_idx" ON "derivative_reviews"("derivative_artifact_id");

-- CreateIndex
CREATE INDEX "derivative_reviews_reviewer_user_id_created_at_idx" ON "derivative_reviews"("reviewer_user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "derivative_reviews" ADD CONSTRAINT "derivative_reviews_derivative_artifact_id_fkey" FOREIGN KEY ("derivative_artifact_id") REFERENCES "derivative_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivative_reviews" ADD CONSTRAINT "derivative_reviews_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

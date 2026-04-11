-- AlterTable
ALTER TABLE "provenance_records" ALTER COLUMN "entity_type" SET DATA TYPE VARCHAR(40);

-- CreateTable
CREATE TABLE "derivative_artifacts" (
    "id" UUID NOT NULL,
    "derivative_type" VARCHAR(40) NOT NULL,
    "source_document_id" UUID,
    "source_section_id" UUID,
    "organization_id" UUID,
    "created_by_user_id" UUID,
    "derivative_generation_job_id" UUID,
    "title" TEXT NOT NULL,
    "content_json" JSONB NOT NULL,
    "content_plain_text" TEXT,
    "content_hash" VARCHAR(128) NOT NULL,
    "token_count" INTEGER,
    "confidence_score" REAL,
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "validator_verdict" VARCHAR(20),
    "validator_reasons_json" JSONB,
    "visibility" VARCHAR(20) NOT NULL DEFAULT 'private',
    "audience" VARCHAR(20) NOT NULL DEFAULT 'both',
    "content_rights" VARCHAR(40) NOT NULL,
    "content_disclaimer_id" UUID NOT NULL,
    "model_run_id" UUID,
    "taxonomy_version" VARCHAR(20),
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "derivative_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derivative_generation_jobs" (
    "id" UUID NOT NULL,
    "derivative_type" VARCHAR(40) NOT NULL,
    "trigger_type" VARCHAR(20) NOT NULL,
    "source_document_id" UUID,
    "backfill_batch_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "prompt_template_version" VARCHAR(40),
    "model_name" VARCHAR(100),
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "error_json" JSONB,
    "triggered_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derivative_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "derivative_artifacts_derivative_type_review_status_idx" ON "derivative_artifacts"("derivative_type", "review_status");

-- CreateIndex
CREATE INDEX "derivative_artifacts_source_document_id_derivative_type_idx" ON "derivative_artifacts"("source_document_id", "derivative_type");

-- CreateIndex
CREATE INDEX "derivative_artifacts_organization_id_derivative_type_idx" ON "derivative_artifacts"("organization_id", "derivative_type");

-- CreateIndex
CREATE INDEX "derivative_artifacts_visibility_derivative_type_published_a_idx" ON "derivative_artifacts"("visibility", "derivative_type", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "derivative_artifacts_source_document_id_derivative_type_tax_key" ON "derivative_artifacts"("source_document_id", "derivative_type", "taxonomy_version");

-- CreateIndex
CREATE INDEX "derivative_generation_jobs_derivative_type_status_idx" ON "derivative_generation_jobs"("derivative_type", "status");

-- CreateIndex
CREATE INDEX "derivative_generation_jobs_backfill_batch_id_idx" ON "derivative_generation_jobs"("backfill_batch_id");

-- CreateIndex
CREATE INDEX "derivative_generation_jobs_source_document_id_derivative_ty_idx" ON "derivative_generation_jobs"("source_document_id", "derivative_type");

-- AddForeignKey
ALTER TABLE "derivative_artifacts" ADD CONSTRAINT "derivative_artifacts_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivative_artifacts" ADD CONSTRAINT "derivative_artifacts_source_section_id_fkey" FOREIGN KEY ("source_section_id") REFERENCES "legal_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivative_artifacts" ADD CONSTRAINT "derivative_artifacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivative_artifacts" ADD CONSTRAINT "derivative_artifacts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivative_artifacts" ADD CONSTRAINT "derivative_artifacts_derivative_generation_job_id_fkey" FOREIGN KEY ("derivative_generation_job_id") REFERENCES "derivative_generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivative_artifacts" ADD CONSTRAINT "derivative_artifacts_model_run_id_fkey" FOREIGN KEY ("model_run_id") REFERENCES "model_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivative_artifacts" ADD CONSTRAINT "derivative_artifacts_content_disclaimer_id_fkey" FOREIGN KEY ("content_disclaimer_id") REFERENCES "content_disclaimers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivative_generation_jobs" ADD CONSTRAINT "derivative_generation_jobs_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivative_generation_jobs" ADD CONSTRAINT "derivative_generation_jobs_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

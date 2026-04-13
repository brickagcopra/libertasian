-- DropForeignKey
ALTER TABLE "ai_settings" DROP CONSTRAINT "ai_settings_updated_by_fkey";

-- AlterTable
ALTER TABLE "ai_settings" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "derivative_artifacts" ADD COLUMN     "deleted_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "digests" ADD COLUMN     "content_disclaimer_id" UUID,
ADD COLUMN     "derivative_generation_job_id" UUID,
ADD COLUMN     "model_run_id" UUID,
ADD COLUMN     "prompt_template_version" VARCHAR(40),
ADD COLUMN     "section_usage_json" JSONB,
ADD COLUMN     "validator_reasons_json" JSONB,
ADD COLUMN     "validator_verdict" VARCHAR(20);

-- AlterTable
ALTER TABLE "email_preferences" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ingestion_jobs" ADD COLUMN     "backfill_batch_id" UUID;

-- CreateTable
CREATE TABLE "bar_exam_sittings" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "part" VARCHAR(20),
    "subject_study_code" VARCHAR(40),
    "subject_bar_admin_code" VARCHAR(40),
    "chairperson" VARCHAR(255),
    "source_document_id" UUID,
    "source_url" TEXT,
    "taxonomy_version" VARCHAR(20) NOT NULL,

    CONSTRAINT "bar_exam_sittings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "essay_prompts" (
    "id" UUID NOT NULL,
    "derivative_artifact_id" UUID NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "suggested_time_minutes" INTEGER,
    "model_answer_json" JSONB,
    "rubric_json" JSONB,
    "subject_topic_id" UUID,
    "bar_exam_sitting_id" UUID,

    CONSTRAINT "essay_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "taxonomy_version" VARCHAR(20) NOT NULL,
    "weight_percent" DOUBLE PRECISION,
    "effective_from" INTEGER,
    "effective_to" INTEGER,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_topics" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "subject_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_equivalences" (
    "id" UUID NOT NULL,
    "study_subject_id" UUID NOT NULL,
    "bar_admin_subject_id" UUID NOT NULL,
    "relationship" VARCHAR(20) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "subject_equivalences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_subject_assignments" (
    "id" UUID NOT NULL,
    "legal_document_id" UUID,
    "derivative_artifact_id" UUID,
    "subject_id" UUID NOT NULL,
    "subject_topic_id" UUID,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "classified_by" VARCHAR(20) NOT NULL DEFAULT 'ai',
    "classifier_model_run_id" UUID,
    "manual_override" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "document_subject_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backfill_batches" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "source_endpoint_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "year_start" INTEGER NOT NULL,
    "year_end" INTEGER NOT NULL,
    "month_start" INTEGER,
    "month_end" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "budget_ceiling_usd" DECIMAL(10,4) NOT NULL,
    "budget_consumed_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "candidates_discovered" INTEGER NOT NULL DEFAULT 0,
    "candidates_processed" INTEGER NOT NULL DEFAULT 0,
    "candidates_skipped" INTEGER NOT NULL DEFAULT 0,
    "candidates_failed" INTEGER NOT NULL DEFAULT 0,
    "documents_created" INTEGER NOT NULL DEFAULT 0,
    "documents_updated" INTEGER NOT NULL DEFAULT 0,
    "checkpoint_state" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "last_tick_at" TIMESTAMPTZ,
    "admin_notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "backfill_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backfill_checkpoints" (
    "id" UUID NOT NULL,
    "backfill_batch_id" UUID NOT NULL,
    "cursor_json" JSONB NOT NULL,
    "candidates_seen" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backfill_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_ledger" (
    "id" UUID NOT NULL,
    "period_year_month" VARCHAR(7) NOT NULL,
    "period_day" VARCHAR(10),
    "scope" VARCHAR(80) NOT NULL,
    "amount_usd" DECIMAL(10,6) NOT NULL,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "request_count" INTEGER NOT NULL DEFAULT 1,
    "model_name" VARCHAR(100),
    "model_run_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "golden_set_entries" (
    "id" UUID NOT NULL,
    "golden_set_type" VARCHAR(30) NOT NULL,
    "source_document_id" UUID,
    "reference_data_json" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "review_notes" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "golden_set_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_runs" (
    "id" UUID NOT NULL,
    "golden_set_type" VARCHAR(30) NOT NULL,
    "prompt_template_version" VARCHAR(40) NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "total_entries" INTEGER NOT NULL,
    "passing_entries" INTEGER NOT NULL,
    "pass_rate" REAL NOT NULL,
    "score_details_json" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bar_exam_sittings_year_idx" ON "bar_exam_sittings"("year");

-- CreateIndex
CREATE UNIQUE INDEX "bar_exam_sittings_year_part_subject_study_code_key" ON "bar_exam_sittings"("year", "part", "subject_study_code");

-- CreateIndex
CREATE UNIQUE INDEX "essay_prompts_derivative_artifact_id_key" ON "essay_prompts"("derivative_artifact_id");

-- CreateIndex
CREATE INDEX "essay_prompts_subject_topic_id_idx" ON "essay_prompts"("subject_topic_id");

-- CreateIndex
CREATE INDEX "essay_prompts_bar_exam_sitting_id_idx" ON "essay_prompts"("bar_exam_sitting_id");

-- CreateIndex
CREATE INDEX "subjects_taxonomy_version_idx" ON "subjects"("taxonomy_version");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_code_taxonomy_version_key" ON "subjects"("code", "taxonomy_version");

-- CreateIndex
CREATE INDEX "subject_topics_subject_id_parent_id_display_order_idx" ON "subject_topics"("subject_id", "parent_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "subject_topics_subject_id_code_key" ON "subject_topics"("subject_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "subject_equivalences_study_subject_id_bar_admin_subject_id_key" ON "subject_equivalences"("study_subject_id", "bar_admin_subject_id");

-- CreateIndex
CREATE INDEX "document_subject_assignments_subject_id_is_primary_idx" ON "document_subject_assignments"("subject_id", "is_primary");

-- CreateIndex
CREATE INDEX "document_subject_assignments_subject_topic_id_idx" ON "document_subject_assignments"("subject_topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_subject_assignments_legal_document_id_subject_id_s_key" ON "document_subject_assignments"("legal_document_id", "subject_id", "subject_topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_subject_assignments_derivative_artifact_id_subject_key" ON "document_subject_assignments"("derivative_artifact_id", "subject_id", "subject_topic_id");

-- CreateIndex
CREATE INDEX "backfill_batches_source_id_status_idx" ON "backfill_batches"("source_id", "status");

-- CreateIndex
CREATE INDEX "backfill_batches_status_last_tick_at_idx" ON "backfill_batches"("status", "last_tick_at");

-- CreateIndex
CREATE INDEX "backfill_checkpoints_backfill_batch_id_created_at_idx" ON "backfill_checkpoints"("backfill_batch_id", "created_at");

-- CreateIndex
CREATE INDEX "budget_ledger_period_year_month_scope_idx" ON "budget_ledger"("period_year_month", "scope");

-- CreateIndex
CREATE INDEX "budget_ledger_period_day_scope_idx" ON "budget_ledger"("period_day", "scope");

-- CreateIndex
CREATE INDEX "budget_ledger_scope_created_at_idx" ON "budget_ledger"("scope", "created_at");

-- CreateIndex
CREATE INDEX "golden_set_entries_golden_set_type_status_idx" ON "golden_set_entries"("golden_set_type", "status");

-- CreateIndex
CREATE INDEX "golden_set_entries_source_document_id_idx" ON "golden_set_entries"("source_document_id");

-- CreateIndex
CREATE INDEX "evaluation_runs_golden_set_type_prompt_template_version_idx" ON "evaluation_runs"("golden_set_type", "prompt_template_version");

-- CreateIndex
CREATE INDEX "derivative_artifacts_deleted_at_idx" ON "derivative_artifacts"("deleted_at");

-- CreateIndex
CREATE INDEX "ingestion_jobs_backfill_batch_id_idx" ON "ingestion_jobs"("backfill_batch_id");

-- AddForeignKey
ALTER TABLE "digests" ADD CONSTRAINT "digests_model_run_id_fkey" FOREIGN KEY ("model_run_id") REFERENCES "model_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digests" ADD CONSTRAINT "digests_content_disclaimer_id_fkey" FOREIGN KEY ("content_disclaimer_id") REFERENCES "content_disclaimers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digests" ADD CONSTRAINT "digests_derivative_generation_job_id_fkey" FOREIGN KEY ("derivative_generation_job_id") REFERENCES "derivative_generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_backfill_batch_id_fkey" FOREIGN KEY ("backfill_batch_id") REFERENCES "backfill_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcq_questions" ADD CONSTRAINT "mcq_questions_subject_topic_id_fkey" FOREIGN KEY ("subject_topic_id") REFERENCES "subject_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bar_exam_sittings" ADD CONSTRAINT "bar_exam_sittings_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "essay_prompts" ADD CONSTRAINT "essay_prompts_derivative_artifact_id_fkey" FOREIGN KEY ("derivative_artifact_id") REFERENCES "derivative_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "essay_prompts" ADD CONSTRAINT "essay_prompts_subject_topic_id_fkey" FOREIGN KEY ("subject_topic_id") REFERENCES "subject_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "essay_prompts" ADD CONSTRAINT "essay_prompts_bar_exam_sitting_id_fkey" FOREIGN KEY ("bar_exam_sitting_id") REFERENCES "bar_exam_sittings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_topics" ADD CONSTRAINT "subject_topics_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_topics" ADD CONSTRAINT "subject_topics_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "subject_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_equivalences" ADD CONSTRAINT "subject_equivalences_study_subject_id_fkey" FOREIGN KEY ("study_subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_equivalences" ADD CONSTRAINT "subject_equivalences_bar_admin_subject_id_fkey" FOREIGN KEY ("bar_admin_subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_subject_assignments" ADD CONSTRAINT "document_subject_assignments_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_subject_assignments" ADD CONSTRAINT "document_subject_assignments_derivative_artifact_id_fkey" FOREIGN KEY ("derivative_artifact_id") REFERENCES "derivative_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_subject_assignments" ADD CONSTRAINT "document_subject_assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_subject_assignments" ADD CONSTRAINT "document_subject_assignments_subject_topic_id_fkey" FOREIGN KEY ("subject_topic_id") REFERENCES "subject_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_subject_assignments" ADD CONSTRAINT "document_subject_assignments_classifier_model_run_id_fkey" FOREIGN KEY ("classifier_model_run_id") REFERENCES "model_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backfill_batches" ADD CONSTRAINT "backfill_batches_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backfill_batches" ADD CONSTRAINT "backfill_batches_source_endpoint_id_fkey" FOREIGN KEY ("source_endpoint_id") REFERENCES "source_endpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backfill_batches" ADD CONSTRAINT "backfill_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backfill_checkpoints" ADD CONSTRAINT "backfill_checkpoints_backfill_batch_id_fkey" FOREIGN KEY ("backfill_batch_id") REFERENCES "backfill_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_ledger" ADD CONSTRAINT "budget_ledger_model_run_id_fkey" FOREIGN KEY ("model_run_id") REFERENCES "model_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "golden_set_entries" ADD CONSTRAINT "golden_set_entries_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "golden_set_entries" ADD CONSTRAINT "golden_set_entries_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


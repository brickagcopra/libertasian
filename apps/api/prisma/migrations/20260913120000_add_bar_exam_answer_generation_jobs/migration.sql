-- Bar exam answer generation jobs (Phase 3b).
--
-- Answer generation was fire-and-forget: the admin page dispatched a Celery
-- task, showed its id, and never learned anything else. Per-question failures
-- (llm_invalid_json, llm_abstained, …) lived only inside a Celery result
-- nobody read, and a 50-question cap at both ends meant the 1,375 unanswered
-- questions on prod (2026-09-13) could never be worked through.
--
-- These two tables make a run durable: one job row per dispatch, one item row
-- per question. The worker claims items in chunks of 20 with FOR UPDATE SKIP
-- LOCKED and re-enqueues itself, so no single task sits on the broker past
-- Redis's 1h visibility_timeout and gets redelivered underneath itself.
--
-- No counter columns on the job row on purpose: counts are computed with
-- GROUP BY over the items at read time, so concurrent item writes cannot race
-- into a wrong total.
--
-- Purely additive: two new tables, no changes to existing ones.

CREATE TABLE "bar_exam_answer_generation_jobs" (
    "id" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'queued',
    "filters_json" JSONB NOT NULL DEFAULT '{}',
    "only_missing" BOOLEAN NOT NULL DEFAULT true,
    "total" INTEGER NOT NULL DEFAULT 0,
    "triggered_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "bar_exam_answer_generation_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bar_exam_answer_generation_items" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'queued',
    "error_code" VARCHAR(40),
    "error_message" TEXT,
    "answer_id" UUID,
    "confidence" REAL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bar_exam_answer_generation_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bar_exam_answer_generation_jobs_status_created_at_idx"
    ON "bar_exam_answer_generation_jobs"("status", "created_at");
CREATE INDEX "bar_exam_answer_generation_jobs_created_at_idx"
    ON "bar_exam_answer_generation_jobs"("created_at");

-- One item per (job, question): the item set is resolved once at creation, and
-- this pair is what makes a re-created job idempotent per question.
CREATE UNIQUE INDEX "bar_exam_answer_generation_items_job_id_question_id_key"
    ON "bar_exam_answer_generation_items"("job_id", "question_id");
-- The claim query (status = 'queued' for one job, FOR UPDATE SKIP LOCKED) and
-- the per-status counts both read this index.
CREATE INDEX "bar_exam_answer_generation_items_job_id_status_idx"
    ON "bar_exam_answer_generation_items"("job_id", "status");
CREATE INDEX "bar_exam_answer_generation_items_question_id_idx"
    ON "bar_exam_answer_generation_items"("question_id");

ALTER TABLE "bar_exam_answer_generation_jobs"
    ADD CONSTRAINT "bar_exam_answer_generation_jobs_triggered_by_user_id_fkey"
    FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bar_exam_answer_generation_items"
    ADD CONSTRAINT "bar_exam_answer_generation_items_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "bar_exam_answer_generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bar_exam_answer_generation_items"
    ADD CONSTRAINT "bar_exam_answer_generation_items_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "bar_exam_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

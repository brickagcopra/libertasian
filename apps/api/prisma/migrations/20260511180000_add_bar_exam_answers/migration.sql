-- CreateTable: bar_exam_answers holds AI-generated ALAC answers (Phase 3a)
-- for past bar exam questions, gated behind admin review before they go
-- public. Future answer types ('editorial', 'community') reuse this table.
--
-- The unique (bar_exam_question_id, answer_type) constraint keeps the
-- worker idempotent — re-dispatching generation for a question that
-- already has an AI answer is a no-op skip in the task code.
CREATE TABLE "bar_exam_answers" (
    "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    "bar_exam_question_id"     UUID         NOT NULL,
    "answer_type"              VARCHAR(20)  NOT NULL DEFAULT 'ai_generated',
    "answer_text"              TEXT         NOT NULL,
    "structured_answer_json"   JSONB,
    "model_run_id"             UUID,
    "confidence"               REAL,
    "review_status"            VARCHAR(20)  NOT NULL DEFAULT 'pending',
    "visibility"               VARCHAR(20)  NOT NULL DEFAULT 'private',
    "reviewed_by_user_id"      UUID,
    "reviewed_at"              TIMESTAMPTZ,
    "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bar_exam_answers_pkey" PRIMARY KEY ("id")
);

-- One AI answer per question (Phase 3a). Future answer_type values share
-- the same constraint via the composite key.
CREATE UNIQUE INDEX "bar_exam_answers_question_type_key"
  ON "bar_exam_answers"("bar_exam_question_id", "answer_type");

-- Drives the admin review queue ordering (oldest pending first).
CREATE INDEX "bar_exam_answers_review_status_created_at_idx"
  ON "bar_exam_answers"("review_status", "created_at");

ALTER TABLE "bar_exam_answers"
  ADD CONSTRAINT "bar_exam_answers_bar_exam_question_id_fkey"
  FOREIGN KEY ("bar_exam_question_id") REFERENCES "bar_exam_questions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bar_exam_answers"
  ADD CONSTRAINT "bar_exam_answers_model_run_id_fkey"
  FOREIGN KEY ("model_run_id") REFERENCES "model_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bar_exam_answers"
  ADD CONSTRAINT "bar_exam_answers_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

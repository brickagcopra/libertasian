-- CreateTable: bar_exam_questions stores verbatim past bar examination question
-- texts from official archives (currently LawPhil 2006-2022). Read-only display.
-- Sub-parts (a)(b)(c) stay inline in question_text and are counted in
-- sub_parts_count. Cascade-deletes when the parent sitting is removed.
CREATE TABLE "bar_exam_questions" (
    "id"                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    "bar_exam_sitting_id"   UUID         NOT NULL,
    "question_number"       SMALLINT     NOT NULL,
    "question_text"         TEXT         NOT NULL,
    "sub_parts_count"       SMALLINT     NOT NULL DEFAULT 0,
    "source_url"            TEXT,
    "source_section_anchor" TEXT,
    "parsed_at"             TIMESTAMPTZ  NOT NULL,
    "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bar_exam_questions_pkey" PRIMARY KEY ("id")
);

-- Per-sitting question-number uniqueness lets the ingest task UPSERT (refresh
-- text if LawPhil corrects a typo) without growing duplicates.
CREATE UNIQUE INDEX "bar_exam_questions_bar_exam_sitting_id_question_number_key"
  ON "bar_exam_questions"("bar_exam_sitting_id", "question_number");

CREATE INDEX "bar_exam_questions_bar_exam_sitting_id_idx"
  ON "bar_exam_questions"("bar_exam_sitting_id");

CREATE INDEX "bar_exam_questions_question_number_idx"
  ON "bar_exam_questions"("question_number");

ALTER TABLE "bar_exam_questions"
  ADD CONSTRAINT "bar_exam_questions_bar_exam_sitting_id_fkey"
  FOREIGN KEY ("bar_exam_sitting_id") REFERENCES "bar_exam_sittings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

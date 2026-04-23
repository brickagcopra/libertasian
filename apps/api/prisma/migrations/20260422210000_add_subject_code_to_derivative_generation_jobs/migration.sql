-- Adds the `subject_code` column + composite index on
-- `derivative_generation_jobs`. Outline jobs now dispatch per subject
-- instead of per document (190/206 outline jobs failed in the 2026-04-22
-- bulk-gen because the per-doc caller violated the validator's
-- ≥3 sections + ≥2 cited docs invariant).
--
-- Backfill is not required: historical rows all carry source_document_id,
-- and subject_code is nullable.

ALTER TABLE "derivative_generation_jobs"
  ADD COLUMN "subject_code" VARCHAR(50);

CREATE INDEX "derivative_generation_jobs_derivative_type_subject_code_idx"
  ON "derivative_generation_jobs" ("derivative_type", "subject_code");

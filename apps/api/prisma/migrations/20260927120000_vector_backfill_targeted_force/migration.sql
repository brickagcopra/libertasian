-- Targeted, forced vector backfill runs.
--
-- A run can now be restricted to an explicit list of legal_documents ids and,
-- for such a list only, forced to re-embed vectors that already exist and to
-- delete vector _ids that no longer map to a section. Both options live on the
-- run row because the run row is the job's source of truth and `resume`
-- re-reads it: a resumed targeted run must stay targeted, never silently widen
-- to the whole corpus.
--
-- Purely additive: two columns with defaults; existing rows read as an
-- untargeted, unforced run, which is exactly what they were.

ALTER TABLE "vector_backfill_runs"
    ADD COLUMN "document_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    ADD COLUMN "force" BOOLEAN NOT NULL DEFAULT false;

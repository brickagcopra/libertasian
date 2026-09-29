-- pruneStale vector backfill runs.
--
-- Long sections are now indexed as chunk rows (`{sectionId}:c{n}`), so every
-- such section's old whole-section vector becomes stale once its chunks are
-- embedded. A pruneStale run embeds only the missing ids and, per document,
-- deletes the ids it no longer produces after its new vectors are written.
-- Lives on the run row for the same reason as `force`: `resume` re-reads it.
--
-- Purely additive: one column with a default; existing rows read as runs that
-- never pruned, which is exactly what they were.

ALTER TABLE "vector_backfill_runs"
    ADD COLUMN "prune_stale" BOOLEAN NOT NULL DEFAULT false;

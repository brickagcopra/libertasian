-- Add per-batch inflight_cap to backfill_batches.
--
-- Until now, services/worker-service/src/tasks/backfill_tasks.py read a
-- module-level constant ``MAX_INFLIGHT_JOBS_PER_BATCH = 5`` for every
-- backfill batch. That ceiling was tuned for the original Phase-1 pilot
-- (one-year SCEL pull, ~120 candidates) and is unworkable for decade-sized
-- batches: at 5 in-flight × ~12s per-doc median latency ≈ ~24 docs/min ≈
-- ~60h ETA on a 9930-candidate batch.
--
-- Default 25 is the napkin-math sweet spot for LawPhil/SCEL at ~1 req/sec
-- with ~12s median per-doc completion: stays well below the source's
-- rate-limit threshold while finishing a decade in ~2 days instead of
-- ~60h. Operators can override per batch via
-- PATCH /admin/backfill/batches/:id/inflight (min 1, max 200).
--
-- Existing rows backfill to 25 to match the new default. Old in-flight
-- batches will pick up the new cap on the next tick.

ALTER TABLE "backfill_batches"
  ADD COLUMN "inflight_cap" INTEGER NOT NULL DEFAULT 25;

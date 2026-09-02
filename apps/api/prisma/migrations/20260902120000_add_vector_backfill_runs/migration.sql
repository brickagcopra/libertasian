-- Vector index backfill bookkeeping.
--
-- The OpenSearch vector index covered 18.6% of the corpus on 2026-09-02
-- (16,182 chunks / ~3,347 documents against 90,008 / ~17,955 in the keyword
-- index, and every vector chunk a `decision` bar four stray
-- `administrative_matter` rows). The gap went unnoticed because the live
-- indexing path swallowed every failure. These two tables make a backfill run
-- and its per-document outcome durable and queryable.
--
-- Purely additive: two new tables, no changes to existing ones.

CREATE TABLE "vector_backfill_runs" (
    "id" UUID NOT NULL,
    "job_id" VARCHAR(64),
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "document_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "batch_size" INTEGER NOT NULL DEFAULT 64,
    "batch_delay_ms" INTEGER NOT NULL DEFAULT 0,
    "max_documents" INTEGER,
    "documents_total" INTEGER NOT NULL DEFAULT 0,
    "documents_processed" INTEGER NOT NULL DEFAULT 0,
    "documents_indexed" INTEGER NOT NULL DEFAULT 0,
    "documents_skipped" INTEGER NOT NULL DEFAULT 0,
    "documents_failed" INTEGER NOT NULL DEFAULT 0,
    "chunks_total" INTEGER NOT NULL DEFAULT 0,
    "chunks_indexed" INTEGER NOT NULL DEFAULT 0,
    "chunks_failed" INTEGER NOT NULL DEFAULT 0,
    "batches_completed" INTEGER NOT NULL DEFAULT 0,
    "batches_failed" INTEGER NOT NULL DEFAULT 0,
    "control_signal" VARCHAR(10),
    "gap_by_type" JSONB NOT NULL DEFAULT '{}',
    "message" TEXT,
    "failure_reason" TEXT,
    "triggered_by_user_id" UUID,
    "organization_id" UUID,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "last_progress_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vector_backfill_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vector_backfill_document_status" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "legal_document_id" UUID NOT NULL,
    "document_type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(300),
    "chunks_attempted" INTEGER NOT NULL DEFAULT 0,
    "chunks_indexed" INTEGER NOT NULL DEFAULT 0,
    "chunks_failed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vector_backfill_document_status_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_vector_backfill_runs_status" ON "vector_backfill_runs"("status", "created_at" DESC);

-- One row per (run, document): the processor upserts on this pair so a retried
-- document overwrites its earlier outcome instead of appending a second,
-- contradictory one.
CREATE UNIQUE INDEX "uq_vector_backfill_doc_status" ON "vector_backfill_document_status"("run_id", "legal_document_id");
CREATE INDEX "idx_vector_backfill_doc_status_run" ON "vector_backfill_document_status"("run_id", "status");
CREATE INDEX "idx_vector_backfill_doc_status_doc" ON "vector_backfill_document_status"("legal_document_id");

ALTER TABLE "vector_backfill_runs"
    ADD CONSTRAINT "vector_backfill_runs_triggered_by_user_id_fkey"
    FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vector_backfill_document_status"
    ADD CONSTRAINT "vector_backfill_document_status_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "vector_backfill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

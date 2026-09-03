/**
 * Constants for the vector-index gap backfill.
 *
 * Context (prod, 2026-09-02): `legal_documents_keyword` held 90,008 chunks
 * across ~17,955 documents; `legal_documents_vector` held 16,182 across ~3,347,
 * and every one of those was a `decision` except four stray
 * `administrative_matter` chunks. No `constitution` (325 keyword chunks), no
 * `codal` (3,965), no `republic_act`, no `rules_of_court`. The kNN arm of
 * retrieval could therefore only ever return case law, so a statutory query got
 * a candidate set of decisions from one of the two RRF arms.
 */

/** BullMQ queue name. Namespaced like the other search queues. */
export const VECTOR_BACKFILL_QUEUE = 'search-vector-backfill';

/** BullMQ job name within the queue. */
export const VECTOR_BACKFILL_JOB = 'backfill';

/**
 * Texts per embedding request.
 *
 * Measured throughput is 4.8 texts/s on CPU (a batch of 64 took 13.46s) on a
 * box shared with TTS, and the full gap is ~4.3 hours of continuous embedding.
 * 64 keeps a single request under ~15s so a pause signal is honoured promptly
 * and a transport timeout costs one batch, not a hundred.
 */
export const VECTOR_BACKFILL_DEFAULT_BATCH_SIZE = 64;

/** Upper bound accepted from an operator; the embedding service caps at 256. */
export const VECTOR_BACKFILL_MAX_BATCH_SIZE = 256;

/** Default pause between batches. 0 = run flat out; raise to yield to TTS. */
export const VECTOR_BACKFILL_DEFAULT_DELAY_MS = 0;

/** Ceiling on the inter-batch delay an operator can set (5 minutes). */
export const VECTOR_BACKFILL_MAX_DELAY_MS = 300_000;

/** How many documents to load from Postgres at a time while walking the gap. */
export const VECTOR_BACKFILL_DOCUMENT_PAGE_SIZE = 200;

/**
 * Document types to fill first, most valuable first.
 *
 * The first six are 24 documents / 7,685 chunks and close the
 * statutory-retrieval hole on their own — that is the whole reason the ordering
 * is explicit rather than "oldest first". Anything not listed here (chiefly
 * `decision`, ~17,900 documents) runs afterwards, ordered by recency.
 */
export const VECTOR_BACKFILL_TYPE_PRIORITY = [
  'constitution',
  'codal',
  'republic_act',
  'rules_of_court',
  'presidential_decree',
  'executive_order',
  'bar_exam_questions',
] as const;

export type VectorBackfillPriorityType =
  (typeof VECTOR_BACKFILL_TYPE_PRIORITY)[number];

/** Sentinel used in per-type gap reports for everything not in the priority list. */
export const VECTOR_BACKFILL_REST_BUCKET = '__rest__';

/** Terminal states — a run in one of these will never make further progress. */
export const VECTOR_BACKFILL_TERMINAL_STATES = [
  'completed',
  'failed',
  'cancelled',
  'paused',
] as const;

/** States that mean a run still owns the queue. */
export const VECTOR_BACKFILL_ACTIVE_STATES = ['queued', 'running'] as const;

/** Reasons a document is recorded as `skipped`. Stable strings — they are queried. */
export const SKIP_REASONS = {
  /** No section had >= 50 chars of plain text and there was no full text. */
  NO_EMBEDDABLE_TEXT: 'no_embeddable_text',
  /** Every chunk this document should have was already in the vector index. */
  ALREADY_INDEXED: 'already_indexed',
  /** Dry run: counted, deliberately not embedded. */
  DRY_RUN: 'dry_run',
} as const;

/** Reasons a document is recorded as `failed`. Stable strings — they are queried. */
export const FAILURE_REASONS = {
  EMBEDDING_UNAVAILABLE: 'embedding_service_returned_no_embeddings',
  BULK_INDEX_ERROR: 'opensearch_bulk_index_error',
} as const;

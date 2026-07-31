/**
 * Content kinds that can be synthesized to audio.
 *
 * `legal_document` covers BOTH codals and decisions — they are rows in the same
 * table, distinguished only by `document_type`. No derivative type is
 * narratable, so flashcards are unreachable by construction rather than by
 * exclusion logic.
 */
export const AUDIO_CONTENT_TYPES = [
  'digest',
  'bar_exam_answer',
  'legal_document',
] as const;
export type AudioContentType = (typeof AUDIO_CONTENT_TYPES)[number];

export function isAudioContentType(value: string): value is AudioContentType {
  return (AUDIO_CONTENT_TYPES as readonly string[]).includes(value);
}

/** BullMQ job payload for the `audio-generation` queue. */
export interface AudioGenerationJobData {
  contentType: AudioContentType;
  contentId: string;
  language: string;
  /** When true, bypass the content-hash short-circuit and re-synthesize. */
  force?: boolean;
}

/** Name of the BullMQ queue + the single job name on it. */
export const AUDIO_QUEUE = 'audio-generation';
export const AUDIO_JOB = 'generate-audio';

/**
 * Separator for {@link audioJobId}. MUST NOT BE ':' — Redis uses the colon as
 * its key separator, so BullMQ rejects custom job ids containing one
 * (`Job.validateOptions`: "Custom Id cannot contain :", bullmq 5.71.0
 * `classes/job.js:1038`). A colon here throws on EVERY enqueue, and because the
 * specs mock the queue no test catches it — the mock accepts any string.
 *
 * The check is `id.includes(':') && id.split(':').length !== 3`, a carve-out for
 * legacy repeatable jobs, so a two-colon id would sneak through today. Do not
 * rely on that: the library's own TODO says the next breaking change tightens it
 * to a plain `includes(':')`.
 */
const AUDIO_JOB_ID_SEPARATOR = '__';

/**
 * The deterministic BullMQ job id for one unit of audio work.
 *
 * This id IS the dedupe key: while a job with it is queued or active, BullMQ
 * drops a second `add` with the same id. Both enqueue sites — the reconciler
 * backfill and the on-demand `requestGeneration` — must therefore produce
 * IDENTICAL ids for the same content, which is what makes a running backfill
 * job absorb a concurrent user request instead of synthesizing it twice.
 *
 * Forced (admin) regen deliberately passes no jobId at all, so it is never
 * deduped and always runs.
 */
export function audioJobId(
  contentType: AudioContentType,
  contentId: string,
  language: string,
  voiceId: string,
): string {
  return [contentType, contentId, language, voiceId].join(AUDIO_JOB_ID_SEPARATOR);
}

/**
 * Failure reasons that describe the CONTENT, not the attempt.
 *
 * A rendition that failed for one of these cannot be changed by running the job
 * again: the text is longer than any single synthesis budget can cover, or its
 * audio is larger than the container can assemble. Prod has 4 such codals
 * (374,364 / 535,553 / 796,129 / 810,815 chars), all `output_too_large`.
 *
 * `permanent` is deliberately ABSENT. It covers 4xx responses and contract
 * violations — a wrong TTS_AUTH_TOKEN, a malformed payload — which a config
 * change or a deploy fixes, and the next tick SHOULD then pick the content up.
 * `timeout`, `transient` and `error` are retryable by construction.
 */
export const REFUSED_FAILURE_REASONS = [
  'text_too_long',
  'output_too_large',
] as const;

/**
 * Whether an `audio_renditions.failure_reason` describes permanently refused
 * content.
 *
 * The column holds `${reason}: ${detail}` (see
 * `AudioRenditionService.recordFailure`), so this matches on the reason prefix
 * rather than the whole string — the detail carries chars and byte counts that
 * differ per document.
 */
export function isPermanentlyRefused(
  failureReason: string | null | undefined,
): boolean {
  if (!failureReason) return false;
  return REFUSED_FAILURE_REASONS.some((reason) =>
    failureReason.startsWith(`${reason}:`),
  );
}

/**
 * The "codals" tier: codes and statutory issuances.
 *
 * Deliberately EXCLUDES 'administrative_matter' and 'administrative_case' —
 * those are issuances, not codes. Adding them later is a one-line change here.
 */
export const CODAL_DOCUMENT_TYPES = [
  'codal',
  'constitution',
  'republic_act',
  'presidential_decree',
  'executive_order',
  'rules_of_court',
] as const;

/**
 * Every `document_type` audio covers. Anything outside this list is out of
 * scope and must not be narrated — notably 'bar_exam_questions'.
 */
export const NARRATABLE_DOCUMENT_TYPES = [
  ...CODAL_DOCUMENT_TYPES,
  'decision',
] as const;

/**
 * Read-along manifest schema version. Folded into the content hash so that a
 * bump invalidates EVERY existing rendition row (whose hash predates the bump)
 * and forces a clean regeneration on the next synthesis pass — the supported
 * way to roll out a new manifest/marks format. v2 introduces segment-level
 * `<mark>` sync + the `readalong.json` manifest (replacing the word-marks-only
 * read-along), which does not change `normalizedText` and so would otherwise be
 * a silent no-op for the hash.
 */
export const READALONG_SCHEMA_VERSION = 2;

/**
 * The exact string that is SHA-256'd to produce `audio_renditions.content_hash`.
 * Versioned so {@link READALONG_SCHEMA_VERSION} bumps invalidate prior rows.
 * Shared by the synthesis service and the bulk pre-generation script so their
 * idempotency checks agree on a single hash.
 */
export function audioContentHashInput(normalizedText: string): string {
  return `${READALONG_SCHEMA_VERSION}\n${normalizedText}`;
}

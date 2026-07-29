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

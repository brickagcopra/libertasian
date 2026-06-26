/** Content kinds that can be synthesized to audio. */
export const AUDIO_CONTENT_TYPES = ['digest', 'bar_exam_answer'] as const;
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

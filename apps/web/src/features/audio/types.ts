/**
 * Types for the web "Listen" audio player + read-along feature.
 *
 * Mirrors the deployed NestJS audio endpoint contract:
 *   GET /audio/:contentType/:contentId?language=en
 * The backend owns synthesis; the web app only renders the rendition and the
 * speech-marks-driven read-along transcript. Do not infer the transcript from
 * the on-screen digest/answer text — it is built entirely from the marks.
 */

export type AudioContentType =
  | 'digest'
  | 'bar_exam_answer'
  /**
   * ONE `legal_document_sections` row. The four large statutory documents
   * cannot be narrated whole — the Civil Code would be a 344 MiB, 16-hour MP3 —
   * so every published statutory document is voiced one section at a time
   * (7,661 sections). Reference works are read by article, not scrubbed.
   */
  | 'legal_document_section';

/**
 * `unavailable` means synthesis failed for a reason re-running cannot change
 * (e.g. `output_too_large`). The server answers 200 and does NOT enqueue —
 * clients must stop polling and surface the state instead of spinning. When
 * `useSectionAudio` is true the same content is narrated section by section.
 */
export type AudioRenditionStatus = 'ready' | 'pending' | 'unavailable';

/** `data` payload of the `{ success, data }` envelope returned by the endpoint. */
export interface AudioRenditionResponse {
  status: AudioRenditionStatus;
  /** Short-lived (300s) signed URL. Null while pending. */
  audioUrl: string | null;
  /** Short-lived (300s) signed URL to the NDJSON speech marks. Null while pending. */
  marksUrl: string | null;
  /**
   * Short-lived (300s) signed URL to the segment read-along manifest JSON.
   * Null while pending OR for legacy rows synthesized before the segment
   * read-along format (the inline read-along then falls back to plain text).
   */
  readalongUrl: string | null;
  durationMs: number | null;
  language: string;
  voiceId: string;
  /** Why synthesis will never succeed. Present only when status is `unavailable`. */
  failureReason?: string | null;
  /**
   * True when this content cannot be narrated whole but every one of its
   * sections has audio — play `legal_document_section` renditions instead.
   */
  useSectionAudio?: boolean;
}

/** The kind of a read-along segment (mirrors the server manifest). */
export type ReadAlongKind = 'title' | 'heading' | 'sentence';

/**
 * One timed read-along segment from the server `readalong.json` manifest. The
 * `text` is the ORIGINAL on-page display text (never the spoken/normalized
 * form), so it can be rendered in place as the digest body. App-local by design
 * — do NOT import this from `@libertasian/types` (prod Docker build does not
 * build that package's dist).
 */
export interface ReadAlongSegment {
  id: string;
  kind: ReadAlongKind;
  /** Stable section key used to group segments back onto the digest sections. */
  sectionKey: string;
  text: string;
  /** ms offset into the audio at which this segment's `<mark>` fires. */
  timeMs: number;
  /**
   * 0-based paragraph index of a `sentence` within its section, used to restore
   * the original DB paragraph breaks in the inline render. Undefined for
   * title/heading segments (and treated as paragraph 0 when absent).
   */
  paragraphIndex?: number;
}

/** Parsed `readalong.json` manifest. */
export interface ReadAlongManifest {
  version: number;
  voiceId: string;
  durationMs: number | null;
  segments: ReadAlongSegment[];
}

/** A single Polly word speech mark (`type: "word"`). */
export interface WordMark {
  /** ms offset into the audio at which the word is spoken. */
  time: number;
  type: 'word';
  /** char offset (start) into the normalized spoken text. */
  start: number;
  /** char offset (end) into the normalized spoken text. */
  end: number;
  value: string;
}

/** A single Polly sentence speech mark (`type: "sentence"`). */
export interface SentenceMark {
  /** ms offset into the audio at which the sentence begins. */
  time: number;
  type: 'sentence';
  start: number;
  end: number;
  value: string;
}

export interface ParsedMarks {
  words: WordMark[];
  sentences: SentenceMark[];
}

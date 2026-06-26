/**
 * Types for the web "Listen" audio player + read-along feature.
 *
 * Mirrors the deployed NestJS audio endpoint contract:
 *   GET /audio/:contentType/:contentId?language=en
 * The backend owns synthesis; the web app only renders the rendition and the
 * speech-marks-driven read-along transcript. Do not infer the transcript from
 * the on-screen digest/answer text — it is built entirely from the marks.
 */

export type AudioContentType = 'digest' | 'bar_exam_answer';

export type AudioRenditionStatus = 'ready' | 'pending';

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

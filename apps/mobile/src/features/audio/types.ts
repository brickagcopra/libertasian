/**
 * Types for the mobile "Listen" audio player (digests + bar answers).
 *
 * Mirrors the deployed NestJS audio endpoint contract:
 *   GET /audio/:contentType/:contentId?language=en
 * and the web feature at apps/web/src/features/audio/types.ts. The backend
 * owns synthesis; the mobile app only streams the ready rendition and, for
 * digests, fetches the segment read-along manifest (`readalongUrl`) to drive
 * inline highlighting.
 */

export type AudioContentType = 'digest' | 'bar_exam_answer';

export type AudioRenditionStatus = 'ready' | 'pending';

/**
 * `data` payload of the `{ success, data }` envelope returned by the endpoint
 * (the mobile apiClient strips the envelope at the transport layer).
 */
export interface AudioRenditionReadModel {
  status: AudioRenditionStatus;
  /** Short-lived (300s) signed URL. Null while pending. */
  audioUrl: string | null;
  /** Short-lived (300s) signed URL to the NDJSON speech marks. Null while pending. */
  marksUrl: string | null;
  /**
   * Short-lived (300s) signed URL to the segment read-along manifest JSON.
   * Null while pending OR for legacy rows synthesized before the segment
   * read-along format.
   */
  readalongUrl: string | null;
  durationMs: number | null;
  language: string;
  voiceId: string;
}

// --- Segment read-along manifest (mirrors apps/web/src/features/audio/types.ts)

export type ReadAlongKind = 'title' | 'heading' | 'sentence';

/** One narrated segment of the read-along manifest, in reading order. */
export interface ReadAlongSegment {
  id: string;
  kind: ReadAlongKind;
  /** Digest section this segment belongs to (e.g. "facts", "ruling"). */
  sectionKey: string;
  /** Exact display text of the segment. */
  text: string;
  /** Onset of this segment in the audio, in milliseconds. */
  timeMs: number;
  /** Paragraph run within the section; restores original `\n\n` breaks. */
  paragraphIndex?: number;
}

/** Parsed `readalong.json` manifest fetched from its presigned URL. */
export interface ReadAlongManifest {
  version: number;
  voiceId: string;
  durationMs: number | null;
  segments: ReadAlongSegment[];
}

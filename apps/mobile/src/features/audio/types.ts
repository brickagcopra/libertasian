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

/**
 * `unavailable` means synthesis failed for a reason re-running cannot change
 * (e.g. `output_too_large`). The server answers 200 and does NOT enqueue —
 * clients must stop polling and surface the state instead of spinning. When
 * `useSectionAudio` is true the same content is narrated section by section.
 */
export type AudioRenditionStatus = 'ready' | 'pending' | 'unavailable';

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
  /** Why synthesis will never succeed. Present only when status is `unavailable`. */
  failureReason?: string | null;
  /**
   * True when this content cannot be narrated whole but every one of its
   * sections has audio — play `legal_document_section` renditions instead.
   */
  useSectionAudio?: boolean;
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

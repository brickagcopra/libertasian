/**
 * Types for the mobile "Listen" audio player (digests + bar answers).
 *
 * Mirrors the deployed NestJS audio endpoint contract:
 *   GET /audio/:contentType/:contentId?language=en
 * and the web feature at apps/web/src/features/audio/types.ts. The backend
 * owns synthesis; the mobile app only streams the ready rendition. Read-along
 * highlighting (marksUrl / readalongUrl) is a follow-up — the URLs are kept in
 * the read model so the hook stays contract-complete.
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

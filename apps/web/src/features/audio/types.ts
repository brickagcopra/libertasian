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
  durationMs: number | null;
  language: string;
  voiceId: string;
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

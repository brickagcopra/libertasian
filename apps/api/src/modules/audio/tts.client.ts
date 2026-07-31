/** MP3 audio bytes plus the matching speech-mark JSON lines. */
export interface SynthesisResult {
  /** Synthesized MP3 audio. */
  readonly audio: Buffer;
  /** Newline-delimited JSON speech marks (word + sentence + ssml types). */
  readonly marks: Buffer;
}

/**
 * One synthesis request carrying BOTH projections of the same document.
 *
 * Polly consumes `ssml`; Kokoro consumes `segments`. Passing both keeps the
 * call site provider-agnostic — it never branches on which backend is active.
 */
export interface TtsSynthesisInput {
  /** SSML document including the `<speak>` root (Polly). */
  readonly ssml: string;
  /** Plain spoken segments with pacing metadata (non-SSML backends). */
  readonly segments: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly leadSilenceMs: number;
  }>;
}

/** The contract both backends satisfy. */
export interface TtsClient {
  synthesize(input: TtsSynthesisInput, voiceId?: string): Promise<SynthesisResult>;
}

/** DI token for the active TTS backend, selected by `TTS_PROVIDER`. */
export const TTS_CLIENT = Symbol('TTS_CLIENT');

/**
 * Why a synthesis attempt gave up.
 *
 *  - `timeout`       — ran out of wall-clock budget (compute-bound, deterministic)
 *  - `transient`     — network error / 5xx / 429; retried
 *  - `permanent`     — 4xx or a contract violation; not retryable
 *  - `text_too_long` — refused before the call: one indivisible segment is
 *                      longer than any allowed budget could cover. A long
 *                      DOCUMENT is chunked instead (see KokoroClient).
 *  - `output_too_large` — refused before the call: the audio the whole document
 *                      would encode to does not fit the API container's heap.
 *                      Chunking bounds synthesis TIME, not output SIZE.
 */
export type TtsFailureReason =
  | 'timeout'
  | 'transient'
  | 'permanent'
  | 'text_too_long'
  | 'output_too_large';

/**
 * A classified synthesis failure.
 *
 * The `reason` is persisted onto the rendition row (`failure_reason`) so a
 * failed rendition says WHY instead of only that it failed — the difference
 * between "this document is too long for one call" and "the TTS host was down"
 * decides whether re-running the reconciler can ever help.
 */
export class TtsSynthesisError extends Error {
  constructor(
    readonly reason: TtsFailureReason,
    readonly detail: string,
  ) {
    super(`TTS synthesis failed [${reason}]: ${detail}`);
    this.name = 'TtsSynthesisError';
  }
}

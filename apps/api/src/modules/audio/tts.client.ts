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

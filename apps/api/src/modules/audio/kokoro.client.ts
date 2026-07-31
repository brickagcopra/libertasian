import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  TtsSynthesisError,
  type SynthesisResult,
  type TtsClient,
  type TtsSynthesisInput,
} from './tts.client';

/** Wire shape returned by the tts-service `/synthesize` endpoint. */
interface KokoroSynthesizeResponse {
  readonly audio: string;
  readonly marks: string;
}

/**
 * MEASURED on prod 2026-07-29: af_heart yields 13.5 characters per second of
 * audio. This is a property of the voice, not of the hardware, so it is a
 * constant here while the wall-clock factor below is configurable.
 */
const CHARS_PER_AUDIO_SECOND = 13.5;

/**
 * Wall-clock seconds spent per second of audio produced.
 *
 * Prod CPU measurement (2026-07-29): 1.0-1.4x realtime per worker — 1,793 chars
 * produced 131.0 s of audio in 135-142 s of wall clock, and the hourly rate
 * (41.5 items/hour, ~156 s audio/item, 2 workers) implies ~1.11x. The 2.5
 * default is that worst case with headroom for queueing inside the TTS service
 * and for the API sharing the box.
 *
 * A GPU box is ~an order of magnitude faster and MUST lower this (see
 * KOKORO_REALTIME_FACTOR in the GPU run command), otherwise the budget is
 * wildly generous and MAX_SYNTHESIZABLE_CHARS below stays needlessly small.
 */
const DEFAULT_REALTIME_FACTOR = 2.5;

/** Never budget below this: cold model load alone is ~13 s, plus HTTP. */
const FLOOR_MS = 60_000;

/**
 * Absolute cap on ONE synthesis call — not on the document.
 *
 * A request whose budget would exceed it is split into consecutive batches
 * rather than started and abandoned; only a single segment that cannot fit is
 * refused. See {@link KokoroClient.synthesizeInBatches}.
 */
const DEFAULT_CEILING_MS = 1_800_000;

/** How much larger the single timeout retry's budget is than the first try's. */
const TIMEOUT_RETRY_MULTIPLIER = 1.5;

/**
 * Share of the ceiling one batch of a chunked request is allowed to plan for.
 *
 * The headroom is what the single enlarged timeout retry spends: a batch
 * planned at the full ceiling could never be retried larger, which is exactly
 * the dead end {@link KokoroClient.synthesize} avoids for unchunked requests.
 */
const BATCH_BUDGET_FRACTION = 0.8;

/**
 * Length-proportional timeout budget for `chars` characters of spoken text.
 *
 * Exported so the budget can be unit-tested directly at the real corpus
 * lengths. The old model was a flat 300 s for every request, which is what made
 * digest 0a8d731f-8b21-4332-b001-93779ebdf054 (2,238 chars — near the 2,032
 * corpus average) fail permanently: its ~166 s of audio needs ~184-232 s of CPU
 * wall clock, close enough to 300 s that queueing pushed it over, and all three
 * attempts used the same doomed budget.
 */
export function kokoroTimeoutBudgetMs(
  chars: number,
  realtimeFactor = DEFAULT_REALTIME_FACTOR,
  floorMs = FLOOR_MS,
): number {
  const audioSeconds = Math.max(0, chars) / CHARS_PER_AUDIO_SECOND;
  return Math.max(floorMs, Math.ceil(audioSeconds * realtimeFactor * 1000));
}

/**
 * Client for the self-hosted Kokoro-82M synthesis service.
 *
 * Mirrors {@link PollyClient}'s public contract exactly — `{ audio, marks }`
 * with marks in Polly's NDJSON shape — so the rendition service is unaware of
 * which backend produced them.
 *
 * Failures are classified rather than blanket-retried. Kokoro synthesis is
 * CPU/GPU-bound and deterministic: a request that ran out of budget will run
 * out of the SAME budget again, so retrying it identically three times only
 * burns three times the compute (15 min of 8-core CPU, measured). Transient
 * network/5xx failures are retried; a timeout is retried at most ONCE and only
 * with a larger budget; everything else fails immediately.
 */
@Injectable()
export class KokoroClient implements TtsClient {
  private readonly logger = new Logger(KokoroClient.name);
  private readonly baseUrl: string;
  private readonly defaultVoiceId: string;
  private readonly authToken: string;
  private readonly realtimeFactor: number;
  private readonly ceilingMs: number;

  /** Attempts for TRANSIENT failures only (network error, 5xx, 429). */
  private static readonly MAX_ATTEMPTS = 3;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config
      .get<string>('TTS_SERVICE_URL', 'http://tts-service:8003')
      .replace(/\/+$/, '');
    this.defaultVoiceId = this.config.get<string>('KOKORO_VOICE_ID', 'af_heart');
    // Empty means "no auth", which is prod's in-network localhost-equivalent
    // call. Only a rented-GPU deployment, where this hop leaves the box, sets it.
    this.authToken = (this.config.get<string>('TTS_AUTH_TOKEN', '') ?? '').trim();
    this.realtimeFactor = this.positiveNumber(
      this.config.get<string>('KOKORO_REALTIME_FACTOR'),
      DEFAULT_REALTIME_FACTOR,
    );
    this.ceilingMs = this.positiveNumber(
      this.config.get<string>('KOKORO_TIMEOUT_CEILING_MS'),
      DEFAULT_CEILING_MS,
    );
  }

  async synthesize(
    input: TtsSynthesisInput,
    voiceId?: string,
  ): Promise<SynthesisResult> {
    const voice = voiceId ?? this.defaultVoiceId;
    const chars = KokoroClient.charCount(input);
    const budgetMs = kokoroTimeoutBudgetMs(chars, this.realtimeFactor);

    // Too long for ONE call is not too long to narrate: split it. At the default
    // factor a single call covers ~9,720 chars, which is above the 2,032-char
    // digest average but far below the 105,130-810,815 chars of the 13 published
    // codals — those needed ~1,947s to ~15,015s against a 1,800s ceiling and so
    // could never pass, no matter how often the reconciler re-enqueued them.
    if (budgetMs > this.ceilingMs) {
      return this.synthesizeInBatches(input, voice, chars);
    }

    return this.synthesizeWithRetries(input, voice, budgetMs, chars);
  }

  /**
   * Synthesize one request that already fits the ceiling, with the retry policy.
   *
   * `chars` is passed rather than recomputed so a batch's error text reports the
   * batch's own length.
   */
  private async synthesizeWithRetries(
    input: TtsSynthesisInput,
    voice: string,
    initialBudgetMs: number,
    chars: number,
  ): Promise<SynthesisResult> {
    let budgetMs = initialBudgetMs;
    let transientAttempts = 0;
    let timeoutRetried = false;

    for (;;) {
      try {
        return await this.synthesizeOnce(input, voice, budgetMs);
      } catch (err) {
        const { reason, detail } = this.classify(err);

        if (reason === 'timeout') {
          const nextBudgetMs = Math.min(
            this.ceilingMs,
            Math.round(budgetMs * TIMEOUT_RETRY_MULTIPLIER),
          );
          // A second identical budget cannot succeed where the first failed, so
          // once the ceiling is reached there is nothing left to try.
          if (timeoutRetried || nextBudgetMs <= budgetMs) {
            throw new TtsSynthesisError(
              'timeout',
              `exceeded ${budgetMs}ms budget for ${chars} chars${
                timeoutRetried ? ' (after one enlarged retry)' : ''
              }`,
            );
          }
          this.logger.warn(
            `Kokoro synthesis timed out after ${budgetMs}ms for ${chars} chars; retrying once with ${nextBudgetMs}ms`,
          );
          timeoutRetried = true;
          budgetMs = nextBudgetMs;
          continue;
        }

        if (reason === 'transient') {
          transientAttempts += 1;
          if (transientAttempts >= KokoroClient.MAX_ATTEMPTS) {
            throw new TtsSynthesisError(
              'transient',
              `failed after ${KokoroClient.MAX_ATTEMPTS} attempts: ${detail}`,
            );
          }
          const delayMs = 2_000 * 2 ** (transientAttempts - 1);
          this.logger.warn(
            `Kokoro synthesis attempt ${transientAttempts} failed (${detail}); retrying in ${delayMs}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        throw new TtsSynthesisError('permanent', detail);
      }
    }
  }

  /**
   * Synthesize a document too long for one call as consecutive batches.
   *
   * Batches are cut on segment boundaries only — a segment is one sentence or
   * heading and splitting inside it would produce audible mid-sentence seams and
   * a `<mark>` with nothing to point at. The MP3 buffers are concatenated in
   * order (Kokoro emits constant-bitrate frames, so a frame-aligned append plays
   * as one file) and the marks are merged with each batch's times shifted by the
   * audio that precedes it, which is what keeps read-along highlighting aligned
   * past the first batch.
   */
  private async synthesizeInBatches(
    input: TtsSynthesisInput,
    voice: string,
    chars: number,
  ): Promise<SynthesisResult> {
    const batches = this.planBatches(input.segments);
    this.logger.log(
      `Chunking ${chars} chars into ${batches.length} batches for ${voice} ` +
        `(per-batch budget <= ${Math.round(this.ceilingMs * BATCH_BUDGET_FRACTION)}ms)`,
    );

    const audioParts: Buffer[] = [];
    const markLines: string[] = [];
    let offsetMs = 0;

    for (const [index, batch] of batches.entries()) {
      const batchChars = KokoroClient.segmentChars(batch);
      const result = await this.synthesizeWithRetries(
        { ssml: input.ssml, segments: batch },
        voice,
        kokoroTimeoutBudgetMs(batchChars, this.realtimeFactor),
        batchChars,
      );
      markLines.push(...KokoroClient.shiftMarkTimes(result.marks, offsetMs));
      audioParts.push(result.audio);
      offsetMs += KokoroClient.batchDurationMs(result.marks, batch);
      this.logger.debug(
        `Batch ${index + 1}/${batches.length}: ${batchChars} chars, ` +
          `${result.audio.length}B audio, next offset ${offsetMs}ms`,
      );
    }

    return {
      audio: Buffer.concat(audioParts),
      marks: Buffer.from(markLines.join('\n'), 'utf-8'),
    };
  }

  /**
   * Group segments into consecutive batches that each fit the per-batch budget.
   *
   * A segment that alone exceeds the ceiling is the ONLY remaining
   * `text_too_long`: no grouping can help it, so refusing is still honest.
   */
  private planBatches(
    segments: TtsSynthesisInput['segments'],
  ): Array<TtsSynthesisInput['segments']> {
    const perBatchCeilingMs = this.ceilingMs * BATCH_BUDGET_FRACTION;
    const batches: Array<Array<TtsSynthesisInput['segments'][number]>> = [];
    let current: Array<TtsSynthesisInput['segments'][number]> = [];
    let currentChars = 0;

    for (const segment of segments) {
      const segmentChars = segment.text.length;
      const aloneMs = kokoroTimeoutBudgetMs(segmentChars, this.realtimeFactor);
      if (aloneMs > this.ceilingMs) {
        throw new TtsSynthesisError(
          'text_too_long',
          `segment ${segment.id} alone is ${segmentChars} chars, needing ~${Math.round(
            aloneMs / 1000,
          )}s above the ${Math.round(this.ceilingMs / 1000)}s ceiling`,
        );
      }
      const withSegmentMs = kokoroTimeoutBudgetMs(
        currentChars + segmentChars,
        this.realtimeFactor,
      );
      // `current.length` guards the floor case: a lone segment always starts a
      // batch, even when the 60s floor already exceeds the per-batch budget.
      if (current.length > 0 && withSegmentMs > perBatchCeilingMs) {
        batches.push(current);
        current = [];
        currentChars = 0;
      }
      current.push(segment);
      currentChars += segmentChars;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  /**
   * How far the merged timeline advances after a batch.
   *
   * Marks end at the ONSET of the last word, not at the end of the audio, so
   * using the last mark alone would make every later batch drift progressively
   * early. The measured {@link CHARS_PER_AUDIO_SECOND} plus the batch's lead
   * silences give an independent estimate of its true length; taking the larger
   * of the two keeps the merged marks monotonic.
   */
  private static batchDurationMs(
    marks: Buffer,
    batch: TtsSynthesisInput['segments'],
  ): number {
    const leadSilenceMs = batch.reduce(
      (total, segment) => total + Math.max(0, segment.leadSilenceMs),
      0,
    );
    const estimatedMs = Math.ceil(
      (KokoroClient.segmentChars(batch) / CHARS_PER_AUDIO_SECOND) * 1000 +
        leadSilenceMs,
    );
    // `marks` is the batch's own, unshifted response, so its times are already
    // relative to the start of this batch.
    return Math.max(estimatedMs, KokoroClient.lastMarkTimeMs(marks));
  }

  /** Latest `time` across every parseable mark line, or 0 when there are none. */
  private static lastMarkTimeMs(marks: Buffer): number {
    let latest = 0;
    for (const line of marks.toString('utf-8').split(/\r?\n/)) {
      const time = KokoroClient.markTime(line);
      if (time !== null && time > latest) latest = time;
    }
    return latest;
  }

  /**
   * Re-emit a batch's NDJSON marks with every `time` advanced by `offsetMs`.
   *
   * Lines that are blank are dropped; lines that do not parse, or carry no
   * numeric `time`, are passed through untouched rather than discarded — this
   * client does not own the mark vocabulary.
   */
  private static shiftMarkTimes(marks: Buffer, offsetMs: number): string[] {
    const lines: string[] = [];
    for (const raw of marks.toString('utf-8').split(/\r?\n/)) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const time = KokoroClient.markTime(trimmed);
      if (time === null || offsetMs === 0) {
        lines.push(trimmed);
        continue;
      }
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      lines.push(JSON.stringify({ ...record, time: time + offsetMs }));
    }
    return lines;
  }

  /** The numeric `time` of one NDJSON mark line, or null if it has none. */
  private static markTime(line: string): number | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const time = (parsed as Record<string, unknown>)['time'];
    return typeof time === 'number' ? time : null;
  }

  /** Characters of spoken text in the request — what synthesis cost scales with. */
  private static charCount(input: TtsSynthesisInput): number {
    return KokoroClient.segmentChars(input.segments);
  }

  /** Characters of spoken text across a list of segments. */
  private static segmentChars(segments: TtsSynthesisInput['segments']): number {
    return segments.reduce((total, segment) => total + segment.text.length, 0);
  }

  /** Issue one POST /synthesize with the caller's timeout budget. */
  private async synthesizeOnce(
    input: TtsSynthesisInput,
    voice: string,
    budgetMs: number,
  ): Promise<SynthesisResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      const response = await fetch(`${this.baseUrl}/synthesize`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          segments: input.segments,
          voice,
          format: 'mp3',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Deliberately does not echo the body — it may quote document text.
        throw new HttpStatusError(response.status);
      }

      const payload = (await response.json()) as KokoroSynthesizeResponse;
      if (
        typeof payload?.audio !== 'string' ||
        typeof payload?.marks !== 'string'
      ) {
        throw new MalformedPayloadError();
      }

      const audio = Buffer.from(payload.audio, 'base64');
      const marks = Buffer.from(payload.marks, 'utf-8');
      this.logger.debug(
        `Synthesized ${audio.length}B audio + ${marks.length}B marks (voice=${voice}, budget=${budgetMs}ms)`,
      );
      return { audio, marks };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Request headers. The bearer token is sent ONLY when configured, so the
   * in-network prod call is byte-identical to before this was added.
   */
  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.authToken) {
      headers['authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  /**
   * Sort a failure into the three classes the retry policy distinguishes.
   *
   * 408/425/429 and 5xx are the server saying "later"; every other status —
   * including 401 from a GPU host with the wrong TTS_AUTH_TOKEN — will say the
   * same thing on every retry. A malformed payload is a contract bug, not luck.
   */
  private classify(err: unknown): {
    reason: 'timeout' | 'transient' | 'permanent';
    detail: string;
  } {
    if (err instanceof HttpStatusError) {
      const retryable =
        err.status >= 500 || [408, 425, 429].includes(err.status);
      return {
        reason: retryable ? 'transient' : 'permanent',
        detail: `tts-service returned ${err.status}`,
      };
    }
    if (err instanceof MalformedPayloadError) {
      return { reason: 'permanent', detail: err.message };
    }
    if (err instanceof Error) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        return { reason: 'timeout', detail: 'timeout' };
      }
      // Anything else out of fetch is a connect/socket/DNS failure.
      return { reason: 'transient', detail: err.message };
    }
    return { reason: 'transient', detail: 'error' };
  }

  /**
   * Parse a positive numeric env value, falling back on anything unusable.
   *
   * Accepts a number as well as a string: the Joi schema coerces these two keys,
   * so ConfigService hands back a number in the app and a string in tests.
   */
  private positiveNumber(
    raw: string | number | undefined,
    fallback: number,
  ): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}

/** Non-2xx from tts-service, carrying the status for classification. */
class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`tts-service returned ${status}`);
    this.name = 'HttpStatusError';
  }
}

/** Response body that does not match the `{ audio, marks }` contract. */
class MalformedPayloadError extends Error {
  constructor() {
    super('tts-service returned a malformed payload');
    this.name = 'MalformedPayloadError';
  }
}

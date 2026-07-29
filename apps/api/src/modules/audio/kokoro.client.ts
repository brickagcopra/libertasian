import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { SynthesisResult, TtsClient, TtsSynthesisInput } from './tts.client';

/** Wire shape returned by the tts-service `/synthesize` endpoint. */
interface KokoroSynthesizeResponse {
  readonly audio: string;
  readonly marks: string;
}

/**
 * Client for the self-hosted Kokoro-82M synthesis service.
 *
 * Mirrors {@link PollyClient}'s public contract exactly — `{ audio, marks }`
 * with marks in Polly's NDJSON shape — so the rendition service is unaware of
 * which backend produced them.
 */
@Injectable()
export class KokoroClient implements TtsClient {
  private readonly logger = new Logger(KokoroClient.name);
  private readonly baseUrl: string;
  private readonly defaultVoiceId: string;

  /** A full decision runs several minutes of audio; allow for it. */
  private static readonly TIMEOUT_MS = 300_000;
  private static readonly MAX_ATTEMPTS = 3;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config
      .get<string>('TTS_SERVICE_URL', 'http://tts-service:8003')
      .replace(/\/+$/, '');
    this.defaultVoiceId = this.config.get<string>('KOKORO_VOICE_ID', 'af_heart');
  }

  async synthesize(
    input: TtsSynthesisInput,
    voiceId?: string,
  ): Promise<SynthesisResult> {
    const voice = voiceId ?? this.defaultVoiceId;
    let lastError: unknown;

    for (let attempt = 1; attempt <= KokoroClient.MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.synthesizeOnce(input, voice);
      } catch (err) {
        lastError = err;
        if (attempt === KokoroClient.MAX_ATTEMPTS) break;
        const delayMs = 2_000 * 2 ** (attempt - 1);
        this.logger.warn(
          `Kokoro synthesis attempt ${attempt} failed (${this.errorLabel(err)}); retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(
      `Kokoro synthesis failed after ${KokoroClient.MAX_ATTEMPTS} attempts: ${this.errorLabel(lastError)}`,
    );
  }

  /** Issue one POST /synthesize with a hard timeout. */
  private async synthesizeOnce(
    input: TtsSynthesisInput,
    voice: string,
  ): Promise<SynthesisResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), KokoroClient.TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}/synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          segments: input.segments,
          voice,
          format: 'mp3',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Deliberately does not echo the body — it may quote document text.
        throw new Error(`tts-service returned ${response.status}`);
      }

      const payload = (await response.json()) as KokoroSynthesizeResponse;
      if (
        typeof payload?.audio !== 'string' ||
        typeof payload?.marks !== 'string'
      ) {
        throw new Error('tts-service returned a malformed payload');
      }

      const audio = Buffer.from(payload.audio, 'base64');
      const marks = Buffer.from(payload.marks, 'utf-8');
      this.logger.debug(
        `Synthesized ${audio.length}B audio + ${marks.length}B marks (voice=${voice})`,
      );
      return { audio, marks };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Short label for logging an error without leaking internals. */
  private errorLabel(err: unknown): string {
    if (err instanceof Error) {
      return err.name === 'AbortError' ? 'timeout' : err.message;
    }
    return 'error';
  }
}

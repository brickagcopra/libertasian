import {
  PollyClient as AwsPollyClient,
  SynthesizeSpeechCommand,
  type Engine,
  type SynthesizeSpeechCommandOutput,
  type VoiceId,
} from '@aws-sdk/client-polly';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** MP3 audio bytes plus the matching word/sentence speech-mark JSON lines. */
export interface SynthesisResult {
  /** Synthesized MP3 audio. */
  readonly audio: Buffer;
  /** Newline-delimited JSON speech marks (word + sentence types). */
  readonly marks: Buffer;
}

/**
 * Thin injectable wrapper around Amazon Polly's synchronous SynthesizeSpeech.
 *
 * Content in this platform is short (digests + bar-exam answers), so the
 * synchronous API is sufficient — no async task / S3 round-trip from Polly.
 * Each call issues two requests against the same SSML: one for MP3 audio and
 * one for the word/sentence speech marks used to drive read-along highlighting.
 */
@Injectable()
export class PollyClient {
  private readonly logger = new Logger(PollyClient.name);
  private readonly client: AwsPollyClient;
  private readonly defaultVoiceId: string;
  private readonly engine: Engine;
  private readonly newscaster: boolean;

  constructor(private readonly config: ConfigService) {
    this.defaultVoiceId = this.config.get<string>('POLLY_VOICE_ID', 'Matthew');
    // Engine and voice must be compatible — Polly rejects a long-form-only
    // voice on the neural engine (and vice versa) at runtime.
    this.engine = this.config.get<string>('POLLY_ENGINE', 'neural') as Engine;
    // Newscaster delivery (<amazon:domain name="news">) is supported on the
    // neural engine (verified on Matthew + speech marks) and is on by default;
    // set POLLY_NEWSCASTER=false to disable. Never applied on generative/
    // long-form, which reject the domain tag.
    this.newscaster =
      this.config.get<string>('POLLY_NEWSCASTER', 'true') !== 'false';
    const region = this.config.get<string>('AWS_REGION', 'us-east-1');
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID', '');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY', '');

    // Omit explicit credentials when unset so the default AWS provider chain
    // (env, shared config, IAM role) applies — important in deployed envs.
    this.client = new AwsPollyClient({
      region,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
  }

  /**
   * Synthesize SSML to MP3 audio plus speech marks.
   *
   * On the neural engine (and when POLLY_NEWSCASTER !== 'false') the body is
   * wrapped in `<amazon:domain name="news">` for a newscaster delivery. If Polly
   * rejects that wrapper with an SSML/validation error, the call retries once
   * with the unwrapped SSML and logs a warning.
   *
   * @param ssml    SSML document (must include the `<speak>` root).
   * @param voiceId Polly voice; falls back to `POLLY_VOICE_ID` (default Matthew).
   */
  async synthesize(ssml: string, voiceId?: string): Promise<SynthesisResult> {
    const resolvedVoiceId = (voiceId ?? this.defaultVoiceId) as VoiceId;
    const useNewscaster = this.engine === 'neural' && this.newscaster;
    const text = useNewscaster ? this.wrapNewscaster(ssml) : ssml;

    try {
      return await this.synthesizeOnce(text, resolvedVoiceId);
    } catch (err) {
      if (useNewscaster && this.isSsmlError(err)) {
        this.logger.warn(
          `Newscaster domain wrapper rejected (${this.errorLabel(err)}); retrying without it`,
        );
        return await this.synthesizeOnce(ssml, resolvedVoiceId);
      }
      throw err;
    }
  }

  /** Issue the paired MP3 + speech-mark requests for one SSML document. */
  private async synthesizeOnce(
    text: string,
    resolvedVoiceId: VoiceId,
  ): Promise<SynthesisResult> {
    const [audioOut, marksOut] = await Promise.all([
      this.client.send(
        new SynthesizeSpeechCommand({
          Text: text,
          TextType: 'ssml',
          OutputFormat: 'mp3',
          VoiceId: resolvedVoiceId,
          Engine: this.engine,
        }),
      ),
      this.client.send(
        new SynthesizeSpeechCommand({
          Text: text,
          TextType: 'ssml',
          OutputFormat: 'json',
          SpeechMarkTypes: ['word', 'sentence'],
          VoiceId: resolvedVoiceId,
          Engine: this.engine,
        }),
      ),
    ]);

    const [audio, marks] = await Promise.all([
      this.streamToBuffer(audioOut.AudioStream),
      this.streamToBuffer(marksOut.AudioStream),
    ]);

    this.logger.debug(
      `Synthesized ${audio.length}B audio + ${marks.length}B marks (voice=${resolvedVoiceId})`,
    );
    return { audio, marks };
  }

  /** Wrap the `<speak>` body in `<amazon:domain name="news">` for newscaster tone. */
  private wrapNewscaster(ssml: string): string {
    const match = ssml.match(/^<speak>([\s\S]*)<\/speak>$/);
    const inner = match ? match[1] : ssml;
    return `<speak><amazon:domain name="news">${inner}</amazon:domain></speak>`;
  }

  /** True when an error looks like an SSML / validation rejection from Polly. */
  private isSsmlError(err: unknown): boolean {
    const name = (err as { name?: string } | null)?.name ?? '';
    const message = (err as { message?: string } | null)?.message ?? '';
    return /ssml|validation|invalid/i.test(name) || /ssml|validation/i.test(message);
  }

  /** Short label for logging an error without leaking internals. */
  private errorLabel(err: unknown): string {
    return (err as { name?: string } | null)?.name ?? 'error';
  }

  /** Collect Polly's streaming response body into a Buffer. */
  private async streamToBuffer(
    stream: SynthesizeSpeechCommandOutput['AudioStream'],
  ): Promise<Buffer> {
    if (!stream) {
      return Buffer.alloc(0);
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

import {
  PollyClient as AwsPollyClient,
  SynthesizeSpeechCommand,
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

  constructor(private readonly config: ConfigService) {
    this.defaultVoiceId = this.config.get<string>('POLLY_VOICE_ID', 'Gregory');
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
   * @param ssml    SSML document (must include the `<speak>` root).
   * @param voiceId Polly voice; falls back to `POLLY_VOICE_ID` (default Gregory).
   */
  async synthesize(ssml: string, voiceId?: string): Promise<SynthesisResult> {
    const resolvedVoiceId = (voiceId ?? this.defaultVoiceId) as VoiceId;

    const [audioOut, marksOut] = await Promise.all([
      this.client.send(
        new SynthesizeSpeechCommand({
          Text: ssml,
          TextType: 'ssml',
          OutputFormat: 'mp3',
          VoiceId: resolvedVoiceId,
          Engine: 'neural',
        }),
      ),
      this.client.send(
        new SynthesizeSpeechCommand({
          Text: ssml,
          TextType: 'ssml',
          OutputFormat: 'json',
          SpeechMarkTypes: ['word', 'sentence'],
          VoiceId: resolvedVoiceId,
          Engine: 'neural',
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

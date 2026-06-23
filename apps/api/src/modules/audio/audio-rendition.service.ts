import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../uploads/s3.service';
import {
  AUDIO_JOB,
  AUDIO_QUEUE,
  type AudioContentType,
  type AudioGenerationJobData,
} from './audio.types';
import { toSsml } from './legal-ssml.util';
import { PollyClient } from './polly.client';

/** Public read projection of a rendition, with short-lived signed URLs. */
export interface AudioRenditionReadModel {
  status: string;
  audioUrl: string | null;
  marksUrl: string | null;
  durationMs: number | null;
  language: string;
  voiceId: string;
}

/** Resolved spoken text for a content item plus its visibility. */
interface ResolvedContent {
  text: string;
  visibility: string;
}

/** TTL (seconds) for the signed audio/marks URLs handed to clients. */
const SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class AudioRenditionService {
  private readonly logger = new Logger(AudioRenditionService.name);
  private readonly defaultVoiceId: string;
  private readonly engine: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly polly: PollyClient,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
    @InjectQueue(AUDIO_QUEUE) private readonly queue: Queue,
  ) {
    this.defaultVoiceId = this.config.get<string>('POLLY_VOICE_ID', 'Matthew');
    this.engine = this.config.get<string>('POLLY_ENGINE', 'neural');
  }

  /** The voice every rendition is keyed on (single configured default). */
  get voiceId(): string {
    return this.defaultVoiceId;
  }

  /**
   * Assemble the spoken text for a content item.
   *  - digest → labeled chapters (Facts/Issues/Ruling/Doctrine/Dispositive).
   *  - bar_exam_answer → the answer text.
   * Throws NotFoundException if the content row does not exist.
   */
  async resolveText(
    contentType: AudioContentType,
    contentId: string,
  ): Promise<ResolvedContent> {
    if (contentType === 'digest') {
      const digest = await this.prisma.digest.findUnique({
        where: { id: contentId },
        select: {
          title: true,
          facts: true,
          issues: true,
          ruling: true,
          doctrine: true,
          dispositive: true,
          visibility: true,
        },
      });
      if (!digest) {
        throw new NotFoundException(`Digest ${contentId} not found`);
      }
      const chapters: Array<[string, string | null]> = [
        ['Facts', digest.facts],
        ['Issues', digest.issues],
        ['Ruling', digest.ruling],
        ['Doctrine', digest.doctrine],
        ['Dispositive', digest.dispositive],
      ];
      const parts: string[] = [digest.title];
      for (const [label, value] of chapters) {
        if (value && value.trim().length > 0) {
          parts.push(`${label}.\n\n${value.trim()}`);
        }
      }
      return { text: parts.join('\n\n'), visibility: digest.visibility };
    }

    const answer = await this.prisma.barExamAnswer.findUnique({
      where: { id: contentId },
      select: { answerText: true, visibility: true },
    });
    if (!answer) {
      throw new NotFoundException(`Bar exam answer ${contentId} not found`);
    }
    return { text: answer.answerText, visibility: answer.visibility };
  }

  /** Look up the rendition for the configured voice (any status). */
  async getRendition(
    contentType: AudioContentType,
    contentId: string,
    language: string,
  ) {
    return this.prisma.audioRendition.findUnique({
      where: {
        contentType_contentId_language_voiceId: {
          contentType,
          contentId,
          language,
          voiceId: this.defaultVoiceId,
        },
      },
    });
  }

  /**
   * Enqueue a synthesis job. A deterministic jobId dedupes concurrent
   * requests for the same content while one is already queued/active; a
   * forced (admin) regen uses a fresh jobId so it always runs.
   */
  async requestGeneration(
    contentType: AudioContentType,
    contentId: string,
    language: string,
    force = false,
  ): Promise<void> {
    const data: AudioGenerationJobData = {
      contentType,
      contentId,
      language,
      force,
    };
    await this.queue.add(AUDIO_JOB, data, {
      jobId: force
        ? undefined
        : `${contentType}:${contentId}:${language}:${this.defaultVoiceId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  /**
   * Synthesize and persist a rendition. Idempotent: if a ready rendition with
   * the same content hash + voice + language already exists, it is returned
   * without calling Polly (unless `force` is set).
   */
  async generate(data: AudioGenerationJobData) {
    const { contentType, contentId, force } = data;
    const language = data.language || 'en';
    const voiceId = this.defaultVoiceId;

    const { text, visibility } = await this.resolveText(contentType, contentId);
    const { ssml, normalizedText } = toSsml(text);
    const contentHash = crypto
      .createHash('sha256')
      .update(normalizedText)
      .digest('hex');

    if (!force) {
      const ready = await this.prisma.audioRendition.findFirst({
        where: { contentHash, voiceId, language, status: 'ready' },
      });
      if (ready) {
        this.logger.debug(
          `Short-circuit: ready rendition ${ready.id} matches hash for ${contentType}:${contentId}`,
        );
        return ready;
      }
    }

    const { audio, marks } = await this.polly.synthesize(ssml, voiceId);
    const durationMs = this.lastWordMarkTime(marks);
    const charCount = normalizedText.length;

    const baseKey = `audio/${contentType}/${contentId}/${voiceId}-${language}`;
    const audioObjectKey = `${baseKey}.mp3`;
    const marksObjectKey = `${baseKey}.marks.json`;
    await this.s3.upload(
      audioObjectKey,
      audio,
      'audio/mpeg',
      `${voiceId}-${language}.mp3`,
    );
    await this.s3.upload(
      marksObjectKey,
      marks,
      'application/json',
      `${voiceId}-${language}.marks.json`,
    );

    const rendition = await this.prisma.audioRendition.upsert({
      where: {
        contentType_contentId_language_voiceId: {
          contentType,
          contentId,
          language,
          voiceId,
        },
      },
      create: {
        contentType,
        contentId,
        contentHash,
        language,
        voiceId,
        engine: this.engine,
        audioObjectKey,
        marksObjectKey,
        durationMs,
        charCount,
        status: 'ready',
        visibility,
      },
      update: {
        contentHash,
        engine: this.engine,
        audioObjectKey,
        marksObjectKey,
        durationMs,
        charCount,
        status: 'ready',
        visibility,
      },
    });

    this.logger.log(
      `Rendition ready ${rendition.id} (${contentType}:${contentId}, ${charCount} chars, ${durationMs ?? '?'}ms)`,
    );
    return rendition;
  }

  /** Build the client read model, signing the object keys with a short TTL. */
  async buildReadModel(rendition: {
    status: string;
    audioObjectKey: string;
    marksObjectKey: string | null;
    durationMs: number | null;
    language: string;
    voiceId: string;
  }): Promise<AudioRenditionReadModel> {
    const isReady = rendition.status === 'ready';
    return {
      status: rendition.status,
      audioUrl: isReady
        ? await this.s3.getSignedUrl(rendition.audioObjectKey, SIGNED_URL_TTL_SECONDS)
        : null,
      marksUrl:
        isReady && rendition.marksObjectKey
          ? await this.s3.getSignedUrl(rendition.marksObjectKey, SIGNED_URL_TTL_SECONDS)
          : null,
      durationMs: rendition.durationMs,
      language: rendition.language,
      voiceId: rendition.voiceId,
    };
  }

  /**
   * Parse Polly's newline-delimited speech-mark JSON and return the `time`
   * (ms offset) of the last `word` mark — a serviceable duration estimate.
   */
  private lastWordMarkTime(marks: Buffer): number | null {
    let last: number | null = null;
    for (const line of marks.toString('utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null) continue;
      const rec = parsed as Record<string, unknown>;
      if (rec['type'] === 'word' && typeof rec['time'] === 'number') {
        last = rec['time'];
      }
    }
    return last;
  }
}

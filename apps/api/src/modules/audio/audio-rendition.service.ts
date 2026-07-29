import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../uploads/s3.service';
import {
  AUDIO_JOB,
  AUDIO_QUEUE,
  READALONG_SCHEMA_VERSION,
  audioContentHashInput,
  type AudioContentType,
  type AudioGenerationJobData,
} from './audio.types';
import {
  toSpokenSegments,
  toSsmlDocument,
  type ManifestEntry,
  type SpokenDocument,
} from './legal-ssml.util';
import { sanitizeRulingText } from './sanitize-ruling.util';
import { TTS_CLIENT, type TtsClient } from './tts.client';

/** Public read projection of a rendition, with short-lived signed URLs. */
export interface AudioRenditionReadModel {
  status: string;
  audioUrl: string | null;
  marksUrl: string | null;
  /** Signed URL to the segment read-along manifest JSON; null when absent. */
  readalongUrl: string | null;
  durationMs: number | null;
  language: string;
  voiceId: string;
}

/** One timed read-along segment in the persisted `readalong.json` manifest. */
interface ReadAlongSegment extends ManifestEntry {
  /** ms offset into the audio at which this segment's `<mark>` fires. */
  readonly timeMs: number;
}

/** Shape of the `readalong.json` object uploaded alongside the audio + marks. */
interface ReadAlongManifest {
  readonly version: number;
  readonly voiceId: string;
  readonly durationMs: number | null;
  readonly segments: ReadAlongSegment[];
}

/** Resolved spoken document for a content item plus its visibility. */
interface ResolvedContent {
  doc: SpokenDocument;
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
    @Inject(TTS_CLIENT) private readonly tts: TtsClient,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
    @InjectQueue(AUDIO_QUEUE) private readonly queue: Queue,
  ) {
    // voiceId and engine MUST track the active provider. The unique key is
    // (contentType, contentId, language, voiceId), so a distinct Kokoro voiceId
    // is exactly what makes its renditions land as NEW rows instead of
    // overwriting the 302 existing Polly ones.
    const provider = this.config.get<string>('TTS_PROVIDER', 'polly');
    this.defaultVoiceId =
      provider === 'kokoro'
        ? this.config.get<string>('KOKORO_VOICE_ID', 'af_heart')
        : this.config.get<string>('POLLY_VOICE_ID', 'Matthew');
    this.engine =
      provider === 'kokoro'
        ? 'kokoro'
        : this.config.get<string>('POLLY_ENGINE', 'neural');
  }

  /** The voice every rendition is keyed on (single configured default). */
  get voiceId(): string {
    return this.defaultVoiceId;
  }

  /**
   * Assemble the spoken document for a content item.
   *  - digest → titled document with named sections (Facts/Issues/Ruling/
   *    Doctrine/Dispositive); empty sections are skipped.
   *  - bar_exam_answer → a single untitled section holding the answer text.
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
      // [sectionKey, on-page display heading, value]. The key is carried into
      // every manifest segment so the web client can map segments back onto its
      // own section blocks; the display heading is the EXACT on-page label so
      // the manifest heading text matches what the reader sees. Order matches
      // the page's display order (Doctrine → Facts → Issues → Ruling →
      // Dispositive) so the highlight moves monotonically top-to-bottom instead
      // of jumping back up the page. Ruling is sanitized identically to the web
      // plain render so the text doesn't change when the user clicks Listen.
      const chapters: Array<[string, string, string | null]> = [
        ['doctrine', 'Doctrine', digest.doctrine],
        ['facts', 'Facts', digest.facts],
        ['issues', 'Issues', digest.issues],
        ['ruling', 'Ruling', sanitizeRulingText(digest.ruling)],
        ['dispositive', 'Dispositive Portion', digest.dispositive],
      ];
      const sections = chapters
        .filter(([, , value]) => value !== null && value.trim().length > 0)
        .map(([key, heading, value]) => ({
          key,
          heading,
          body: (value ?? '').trim(),
        }));
      const title =
        digest.title && digest.title.trim().length > 0 ? digest.title : undefined;
      return { doc: { title, sections }, visibility: digest.visibility };
    }

    const answer = await this.prisma.barExamAnswer.findUnique({
      where: { id: contentId },
      select: { answerText: true, visibility: true },
    });
    if (!answer) {
      throw new NotFoundException(`Bar exam answer ${contentId} not found`);
    }
    return {
      doc: { sections: [{ key: 'answer', body: answer.answerText }] },
      visibility: answer.visibility,
    };
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

    const { doc, visibility } = await this.resolveText(contentType, contentId);
    const { ssml, normalizedText, manifest } = toSsmlDocument(doc);
    // Hash the VERSIONED input so a READALONG_SCHEMA_VERSION bump invalidates
    // every prior row (whose hash predates the bump) and forces a clean regen —
    // adding `<mark>` tags does not change normalizedText, so without this the
    // hash would be unchanged and existing rows would never regenerate.
    const contentHash = crypto
      .createHash('sha256')
      .update(audioContentHashInput(normalizedText))
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

    const { audio, marks } = await this.tts.synthesize(
      { ssml, segments: toSpokenSegments(doc) },
      voiceId,
    );
    const durationMs = this.lastWordMarkTime(marks);
    const charCount = normalizedText.length;

    // Join the manifest (mark id → original text) onto the ssml-type speech
    // marks (mark id → time) to produce the timed read-along manifest.
    const readalong = this.buildReadAlong(manifest, marks, voiceId, durationMs);

    const baseKey = `audio/${contentType}/${contentId}/${voiceId}-${language}`;
    const audioObjectKey = `${baseKey}.mp3`;
    const marksObjectKey = `${baseKey}.marks.json`;
    const readalongObjectKey = `${baseKey}.readalong.json`;
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
    await this.s3.upload(
      readalongObjectKey,
      Buffer.from(JSON.stringify(readalong), 'utf-8'),
      'application/json',
      `${voiceId}-${language}.readalong.json`,
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
        readalongObjectKey,
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
        readalongObjectKey,
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
    readalongObjectKey: string | null;
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
      readalongUrl:
        isReady && rendition.readalongObjectKey
          ? await this.s3.getSignedUrl(
              rendition.readalongObjectKey,
              SIGNED_URL_TTL_SECONDS,
            )
          : null,
      durationMs: rendition.durationMs,
      language: rendition.language,
      voiceId: rendition.voiceId,
    };
  }

  /**
   * Join the SSML manifest onto Polly's `ssml`-type speech marks to produce the
   * timed read-along manifest. Each manifest entry keeps its original text and
   * gains the `time` of its `<mark>`; the rare entry without a matching mark
   * inherits the previous segment's time (monotonic, never undefined). Segments
   * are returned ordered by `timeMs`.
   */
  private buildReadAlong(
    manifest: ManifestEntry[],
    marks: Buffer,
    voiceId: string,
    durationMs: number | null,
  ): ReadAlongManifest {
    const timeById = this.parseSsmlMarkTimes(marks);
    let prevTime = 0;
    const segments: ReadAlongSegment[] = manifest.map((entry) => {
      const timeMs = timeById.get(entry.id) ?? prevTime;
      prevTime = timeMs;
      return { ...entry, timeMs };
    });
    segments.sort((a, b) => a.timeMs - b.timeMs);
    return {
      version: READALONG_SCHEMA_VERSION,
      voiceId,
      durationMs,
      segments,
    };
  }

  /**
   * Parse Polly's newline-delimited speech marks and return a map of
   * `<mark>` name (`seg-N`) → ms onset, for every `ssml`-type mark.
   */
  private parseSsmlMarkTimes(marks: Buffer): Map<string, number> {
    const times = new Map<string, number>();
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
      if (
        rec['type'] === 'ssml' &&
        typeof rec['value'] === 'string' &&
        typeof rec['time'] === 'number'
      ) {
        times.set(rec['value'], rec['time']);
      }
    }
    return times;
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

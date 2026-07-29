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
  CODAL_DOCUMENT_TYPES,
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
   * Whether audio generation is on for a content item.
   *
   * Only the DECISION tier is gated behind the second flag, because only it
   * has a storage problem (~158 GB against a 142 GB volume). Codals total
   * ~1.7 GB and pass on `AUDIO_RECONCILER_ENABLED` alone, so publishing one
   * narrates it immediately instead of waiting for the hourly tick.
   *
   * `documentType` is required for legal_document and ignored otherwise; an
   * unrecognised type is out of scope and returns false.
   */
  isGenerationEnabled(
    contentType: AudioContentType,
    documentType?: string,
  ): boolean {
    if (this.config.get<string>('AUDIO_RECONCILER_ENABLED', 'false') !== 'true') {
      return false;
    }
    if (contentType !== 'legal_document') return true;

    if (documentType === 'decision') {
      return (
        this.config.get<string>('AUDIO_RECONCILE_DECISIONS', 'false') === 'true'
      );
    }
    return (CODAL_DOCUMENT_TYPES as readonly string[]).includes(
      documentType ?? '',
    );
  }

  /**
   * Assemble the spoken document for a content item.
   *  - digest → titled document with named sections (Facts/Issues/Ruling/
   *    Doctrine/Dispositive); empty sections are skipped.
   *  - legal_document → one chapter per `legal_document_sections` row in
   *    `ordering` sequence. Serves codals and decisions alike.
   *  - bar_exam_answer → a single untitled section holding the answer text.
   * Throws NotFoundException if the content row does not exist.
   */
  async resolveText(
    contentType: AudioContentType,
    contentId: string,
  ): Promise<ResolvedContent> {
    if (contentType === 'legal_document') {
      return this.resolveLegalDocument(contentId);
    }

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

  /**
   * Build the spoken document for a legal document from its sections.
   *
   * Only published documents are narratable — an unpublished one would put
   * unreviewed text into the public audio corpus. Sections with no plain text
   * are skipped rather than emitting a heading with nothing under it.
   */
  private async resolveLegalDocument(contentId: string): Promise<ResolvedContent> {
    const document = await this.prisma.legalDocument.findUnique({
      where: { id: contentId },
      select: { title: true, status: true },
    });
    if (!document) {
      throw new NotFoundException(`Legal document ${contentId} not found`);
    }
    if (document.status !== 'published') {
      throw new NotFoundException(
        `Legal document ${contentId} is not published (status=${document.status})`,
      );
    }

    const sections = await this.prisma.legalDocumentSection.findMany({
      where: { legalDocumentId: contentId },
      orderBy: { ordering: 'asc' },
      select: { id: true, sectionLabel: true, sectionType: true, plainText: true },
    });

    // [sectionKey, display heading, value] — the same chapter shape the digest
    // branch produces, so the manifest/read-along contract is identical.
    const chapters: Array<[string, string, string | null]> = sections.map((section) => [
      section.id,
      section.sectionLabel ?? section.sectionType,
      section.plainText,
    ]);

    const spokenSections = chapters
      .filter(([, , value]) => value !== null && value.trim().length > 0)
      .map(([key, heading, value]) => ({
        key,
        heading,
        body: (value ?? '').trim(),
      }));

    const title =
      document.title && document.title.trim().length > 0 ? document.title : undefined;
    // `legal_documents` has NO visibility column — publication is expressed by
    // `status`, and this branch has already refused anything not 'published'.
    return {
      doc: { title, sections: spokenSections },
      visibility: 'public_editorial',
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

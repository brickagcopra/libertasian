import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { AudioStorageService } from './audio-storage.service';
import {
  AUDIO_JOB,
  AUDIO_QUEUE,
  CODAL_DOCUMENT_TYPES,
  READALONG_SCHEMA_VERSION,
  audioContentHashInput,
  audioJobId,
  isPermanentlyRefused,
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
import {
  TTS_CLIENT,
  type TtsClient,
  type TtsFailureReason,
} from './tts.client';

/** Public read projection of a rendition, with short-lived signed URLs. */
export interface AudioRenditionReadModel {
  /** One of {@link AudioRenditionReadStatus}; `string` because it is a DB column. */
  status: string;
  audioUrl: string | null;
  marksUrl: string | null;
  /** Signed URL to the segment read-along manifest JSON; null when absent. */
  readalongUrl: string | null;
  durationMs: number | null;
  language: string;
  voiceId: string;
  /**
   * Why synthesis will never succeed. Set ONLY on the `unavailable` response —
   * a ready rendition has nothing to explain.
   */
  failureReason?: string | null;
  /**
   * True when whole-item audio is refused but every one of the item's sections
   * has a ready rendition, so the client should play `legal_document_section`
   * renditions instead of showing a dead end.
   */
  useSectionAudio?: boolean;
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

/**
 * The already-voiced rendition an alias row copies its audio from.
 *
 * Structural rather than `Prisma.AudioRendition` so the copy is limited, in the
 * type, to the columns that describe the AUDIO — never the identity columns of
 * the row being aliased.
 */
interface AliasSource {
  readonly id: string;
  readonly contentType: string;
  readonly contentId: string;
  readonly contentHash: string;
  readonly engine: string;
  readonly audioObjectKey: string;
  readonly marksObjectKey: string | null;
  readonly readalongObjectKey: string | null;
  readonly durationMs: number | null;
  readonly charCount: number | null;
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
    private readonly s3: AudioStorageService,
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
   *
   * `legal_document_section` passes on `AUDIO_RECONCILER_ENABLED` alone, like
   * digests: its parent is always a statutory document (the decision tier is
   * narrated whole), so the decision storage flag has nothing to say about it.
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
   *  - legal_document_section → the SAME chapter shape, for exactly one of
   *    those rows, so a section narrated on its own is byte-identical in
   *    structure to the same section inside a whole-document rendition.
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

    if (contentType === 'legal_document_section') {
      return this.resolveLegalDocumentSection(contentId);
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

  /**
   * Build the spoken document for ONE `legal_document_sections` row.
   *
   * The publication guard is the parent document's, applied identically to
   * {@link resolveLegalDocument}: an unpublished document must not put
   * unreviewed text into the public audio corpus, and narrating it a section at
   * a time would be an obvious way around that.
   *
   * Emits exactly one chapter in the shape the whole-document branch produces —
   * `[sectionId, sectionLabel ?? sectionType, plainText]` — so the SSML,
   * manifest and read-along contracts are unchanged and a section keyed by its
   * own id lines up with the same segment key it would have had inside a
   * whole-document rendition.
   *
   * The spoken title is prefixed with the parent document's title because these
   * renditions are played standalone: "Civil Code of the Philippines — Article
   * 1156" tells the listener what they are hearing, where a bare "Article 1156"
   * does not.
   */
  private async resolveLegalDocumentSection(
    contentId: string,
  ): Promise<ResolvedContent> {
    const section = await this.prisma.legalDocumentSection.findUnique({
      where: { id: contentId },
      select: {
        sectionLabel: true,
        sectionType: true,
        plainText: true,
        legalDocument: { select: { title: true, status: true } },
      },
    });
    if (!section) {
      throw new NotFoundException(`Legal document section ${contentId} not found`);
    }

    const document = section.legalDocument;
    if (!document) {
      throw new NotFoundException(
        `Legal document section ${contentId} has no parent document`,
      );
    }
    if (document.status !== 'published') {
      throw new NotFoundException(
        `Legal document section ${contentId} belongs to an unpublished document (status=${document.status})`,
      );
    }

    const body = (section.plainText ?? '').trim();
    if (body.length === 0) {
      // The whole-document branch SKIPS empty sections; a per-section request
      // has nothing left to skip to, and synthesizing it would bill a TTS call
      // to produce silence and a rendition row that plays as a dead 0-second
      // file. 404 says what is actually true: there is nothing to narrate.
      throw new NotFoundException(
        `Legal document section ${contentId} has no plain text to narrate`,
      );
    }

    const heading = section.sectionLabel ?? section.sectionType;
    const documentTitle = document.title?.trim();
    const title =
      documentTitle && documentTitle.length > 0
        ? `${documentTitle} — ${heading}`
        : heading;

    return {
      doc: { title, sections: [{ key: contentId, heading, body }] },
      // `legal_documents` has NO visibility column — publication is expressed by
      // `status`, and this branch has already refused anything not 'published'.
      visibility: 'public_editorial',
    };
  }

  /**
   * Look up the rendition to serve.
   *
   * Prefers the configured voice, then falls back to ANY ready rendition for the
   * same content. Without the fallback, changing TTS_PROVIDER (and therefore
   * defaultVoiceId) makes every rendition produced by the previous backend
   * invisible in a single deploy.
   *
   * A served fallback also stops the read path from enqueueing work for
   * that content. That is intended ONLY while the reconciler is running:
   * its gap queries key on `ar.voice_id = <active voice>`, so
   * fallback-served rows are still counted as gaps and still get
   * re-synthesized. AUDIO_RECONCILER_ENABLED is currently false on prod —
   * with it off, this fallback makes a TTS_PROVIDER flip permanent, because
   * nothing else ever enqueues the migration. Enable the reconciler in the
   * same change window as any provider switch.
   */
  async getRendition(
    contentType: AudioContentType,
    contentId: string,
    language: string,
  ) {
    const active = await this.prisma.audioRendition.findUnique({
      where: {
        contentType_contentId_language_voiceId: {
          contentType,
          contentId,
          language,
          voiceId: this.defaultVoiceId,
        },
      },
    });
    if (active?.status === 'ready') return active;

    // `status: 'ready'` ONLY. A pending or failed row from a previous voice must
    // not mask the active voice's absence, or synthesis would never be enqueued.
    // Falling through on a non-ready ACTIVE row matters for the same reason in
    // reverse: it must not mask a ready row the previous backend left behind.
    const fallback = await this.prisma.audioRendition.findFirst({
      where: { contentType, contentId, language, status: 'ready' },
      orderBy: { createdAt: 'desc' },
    });
    return fallback ?? active;
  }

  /**
   * Whether this rendition failed for a reason RE-RUNNING CANNOT CHANGE.
   *
   * Prod 2026-07-31: 21,094 ready rows, 4 failed — the Civil Code,
   * Administrative Code, NIRC and Rules of Court, all `output_too_large`
   * (374k-811k chars projecting 159-344 MiB of mp3 against a 150 MiB ceiling).
   * All four are fully narrated per section instead, so those failures are the
   * designed outcome, not an incident.
   *
   * An UNRECOGNISED reason is treated as retryable. A row that failed on a
   * network blip, a timeout, or a reason added by a future backend must still
   * get another attempt; only reasons this codebase knows to be terminal
   * ({@link REFUSED_FAILURE_REASONS}) stop the retry.
   */
  isPermanentlyFailed(
    rendition:
      | { status: string; failureReason?: string | null }
      | null
      | undefined,
  ): boolean {
    if (!rendition || rendition.status !== 'failed') return false;
    return isPermanentlyRefused(rendition.failureReason);
  }

  /**
   * Whether every narratable section of a legal document already has audio, so
   * a client refused the whole-document rendition can play it section by
   * section instead of being told only that it cannot listen.
   *
   * "Narratable" excludes sections with empty `plain_text` — the same filter
   * the reconciler's section tier applies, so the 2 empty rows out of prod's
   * 4,857 do not make a fully-covered document read as incomplete.
   *
   * Deliberately NOT filtered by voice: `getRendition` serves any ready
   * rendition for the language, so coverage means "the client can play it",
   * not "the active voice produced it". Without that, a provider switch would
   * flip this to false while perfectly serviceable audio existed.
   */
  async hasCompleteSectionAudio(
    contentId: string,
    language: string,
  ): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ total: bigint; missing: bigint }>
    >`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE ar.id IS NULL) AS missing
      FROM legal_document_sections s
      LEFT JOIN audio_renditions ar
        ON ar.content_type = 'legal_document_section'
       AND ar.content_id = s.id::text
       AND ar.language = ${language}
       AND ar.status = 'ready'
      WHERE s.legal_document_id = ${contentId}::uuid
        AND s.plain_text IS NOT NULL
        AND btrim(s.plain_text) <> ''
    `;
    const total = Number(row?.total ?? 0);
    const missing = Number(row?.missing ?? 0);
    // A document with no narratable sections is not "covered" — it just has
    // nothing to offer, and claiming coverage would send the client hunting.
    return total > 0 && missing === 0;
  }

  /**
   * Enqueue a synthesis job. THE single enqueue path.
   *
   * The on-demand read path, the publish listener and the hourly reconciler all
   * route through here, so the job id, retry policy and retention are defined
   * once. `priority` is the only knob a caller varies: the reconciler tiers it
   * so a 15,464-document decision backfill can never starve a newly published
   * digest.
   *
   * A deterministic jobId dedupes concurrent requests for the same content while
   * one is queued or active; a forced (admin) regen uses no jobId at all, so it
   * is never deduped, never blocked, and always runs.
   */
  async requestGeneration(
    contentType: AudioContentType,
    contentId: string,
    language: string,
    force = false,
    priority?: number,
  ): Promise<void> {
    const data: AudioGenerationJobData = {
      contentType,
      contentId,
      language,
      force,
    };
    const jobId = force
      ? undefined
      : audioJobId(contentType, contentId, language, this.defaultVoiceId);

    if (jobId && !(await this.claimJobId(jobId))) return;

    await this.queue.add(AUDIO_JOB, data, {
      jobId,
      priority,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  /**
   * Make a deterministic job id usable, and say whether to enqueue at all.
   *
   * Drops a same-id job that has already FINISHED, so the id can be reused.
   *
   * BullMQ refuses `add` for an id that exists in any state — including
   * `completed` and `failed` — while both retention settings deliberately keep
   * terminal records (100 completed, 500 failed). A retained record therefore
   * blocks its content from ever being re-enqueued, and because retention is a
   * ring buffer the behaviour is positional: an id still inside the
   * last-100-completed window is blocked, an evicted one is not. That is the
   * opposite of what the id is documented to do — dedupe "while a job with it is
   * queued or active".
   *
   * MEASURED on prod 2026-07-31: 16 digests sat in the reconciler's gap while
   * every hourly tick "enqueued" them into a void — no processor log, no state
   * change. `EXISTS bull:audio-generation:digest__<uuid>__en__af_heart` returned
   * 1 with `finishedOn` set. Deleting those keys by hand and re-triggering
   * produced 16 alias rows immediately; the same block held the 13 failed
   * codals. This removal is what retires that manual Redis surgery.
   *
   * Waiting, active and delayed jobs are left ALONE and the enqueue is skipped —
   * that is the dedupe the id exists for. BullMQ would no-op the `add` anyway;
   * returning false states the intent in our own code and saves a round trip.
   *
   * getJob → remove → add is NOT atomic: two callers can both observe the same
   * terminal job and both proceed. The accepted worst case is one redundant
   * synthesis, never corruption — `generate()` short-circuits on the content
   * hash and the rendition row is an upsert on a unique key.
   *
   * @returns whether the caller should go on to `add` the job.
   */
  private async claimJobId(jobId: string): Promise<boolean> {
    try {
      const existing = await this.queue.getJob(jobId);
      if (!existing) return true;

      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
        this.logger.debug(
          `Removed ${state} job ${jobId} so this content can be enqueued again`,
        );
        return true;
      }

      this.logger.debug(
        `Job ${jobId} is already ${state}; not enqueueing a duplicate`,
      );
      return false;
    } catch (err) {
      // Fail OPEN. A Redis hiccup here must not stop the enqueue attempt; the
      // worst case is exactly the pre-existing behaviour, where `add` no-ops on
      // the stale id.
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Could not clear terminal job ${jobId}: ${message}`);
      return true;
    }
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
      if (
        ready &&
        ready.contentType === contentType &&
        ready.contentId === contentId
      ) {
        this.logger.debug(
          `Short-circuit: ready rendition ${ready.id} matches hash for ${contentType}:${contentId}`,
        );
        return ready;
      }
      if (ready) {
        return this.writeAliasRendition(
          ready,
          contentType,
          contentId,
          language,
          voiceId,
          visibility,
        );
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
        // A previous failure no longer describes this row.
        failureReason: null,
        visibility,
      },
    });

    this.logger.log(
      `Rendition ready ${rendition.id} (${contentType}:${contentId}, ${charCount} chars, ${durationMs ?? '?'}ms)`,
    );
    return rendition;
  }

  /**
   * Point a second content item at audio that already exists for identical text.
   *
   * 16 prod digests are byte-identical to an already-voiced one, so the content
   * hash matches a row belonging to a DIFFERENT contentId. Returning that row
   * (what this used to do) left the requested contentId with no row at all:
   * `getRendition` looks up by contentId, found nothing, answered 202 "pending"
   * and re-enqueued — the player spun forever and every page view added another
   * futile job.
   *
   * The alias reuses the source's object keys VERBATIM: the bytes are identical,
   * so re-uploading them under a second key would double the storage and the
   * synthesis cost to no effect. It is therefore NOT safe to delete an object
   * because one rendition row was deleted — check for aliases on the same keys.
   */
  private async writeAliasRendition(
    source: AliasSource,
    contentType: AudioContentType,
    contentId: string,
    language: string,
    voiceId: string,
    visibility: string,
  ) {
    const audio = {
      contentHash: source.contentHash,
      engine: source.engine,
      audioObjectKey: source.audioObjectKey,
      marksObjectKey: source.marksObjectKey,
      readalongObjectKey: source.readalongObjectKey,
      durationMs: source.durationMs,
      charCount: source.charCount,
      status: 'ready',
      visibility,
    };

    const alias = await this.prisma.audioRendition.upsert({
      where: {
        contentType_contentId_language_voiceId: {
          contentType,
          contentId,
          language,
          voiceId,
        },
      },
      create: { contentType, contentId, language, voiceId, ...audio },
      // A row that previously failed for this contentId now has serviceable
      // audio, so its failure no longer describes it.
      update: { ...audio, failureReason: null },
    });

    this.logger.debug(
      `Alias rendition ${alias.id} written for ${contentType}:${contentId}, ` +
        `reusing ${source.contentType}:${source.contentId} (rendition ${source.id}) ` +
        `on identical content hash — no TTS call, no upload`,
    );
    return alias;
  }

  /**
   * Record why a synthesis attempt gave up, on the rendition row itself.
   *
   * Called once per job, after BullMQ's last attempt — a mid-retry write would
   * publish a `failed` status that the next attempt may immediately contradict.
   *
   * NEVER downgrades a `ready` row: a forced regeneration that fails must not
   * take existing, serviceable audio out of circulation. The reconciler's gap
   * queries key on `status = 'ready'`, so a row left `failed` is still counted
   * as a gap and re-enqueued on a later tick.
   */
  async recordFailure(
    data: AudioGenerationJobData,
    reason: TtsFailureReason | 'error',
    detail: string,
  ): Promise<void> {
    const { contentType, contentId } = data;
    const language = data.language || 'en';
    const voiceId = this.defaultVoiceId;
    // VarChar(200); the detail never carries document text (see KokoroClient).
    const failureReason = `${reason}: ${detail}`.slice(0, 200);

    const where = {
      contentType_contentId_language_voiceId: {
        contentType,
        contentId,
        language,
        voiceId,
      },
    };

    const existing = await this.prisma.audioRendition.findUnique({ where });
    if (existing?.status === 'ready') {
      this.logger.warn({
        event: 'audio_failure_not_recorded',
        contentType,
        contentId,
        reason,
        message: 'Attempt failed but a ready rendition exists; leaving it ready',
      });
      return;
    }

    if (existing) {
      await this.prisma.audioRendition.update({
        where,
        data: { status: 'failed', failureReason },
      });
    } else {
      await this.prisma.audioRendition.create({
        data: {
          contentType,
          contentId,
          // No audio was produced, so there is no object to point at. The read
          // model returns null URLs for every non-ready status.
          contentHash: '',
          language,
          voiceId,
          engine: this.engine,
          audioObjectKey: '',
          status: 'failed',
          failureReason,
        },
      });
    }

    this.logger.error({
      event: 'audio_rendition_failed',
      contentType,
      contentId,
      voiceId,
      reason,
      detail,
    });
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

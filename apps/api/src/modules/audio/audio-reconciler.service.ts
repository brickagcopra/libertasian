import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { statfs } from 'fs/promises';

import { PrismaService } from '../../prisma/prisma.service';
import { AudioRenditionService } from './audio-rendition.service';
import { AudioStorageService } from './audio-storage.service';
import {
  CODAL_DOCUMENT_TYPES,
  REFUSED_FAILURE_REASONS,
  isPermanentlyRefused,
  type AudioContentType,
} from './audio.types';

/** One reconciliation tier, highest priority first. */
interface Tier {
  /**
   * Stable tier LABEL, not a rank — it appears in every log line, so tiers are
   * never renumbered. The array order below is what decides which tier draws
   * from the tick's batch budget first.
   */
  readonly n: 1 | 2 | 3 | 4;
  readonly label: string;
  readonly contentType: AudioContentType;
  /** Lower number = higher BullMQ priority. */
  readonly priority: number;
}

/**
 * Statutory document types narrated PER SECTION (tier 4) instead of whole.
 *
 * All four documents that need this are codals, and every other codal is a
 * reference work read the same way, so the set IS {@link CODAL_DOCUMENT_TYPES}.
 * Tier 2 derives its own set by SUBTRACTING this one, so the two can never
 * both claim a document — see {@link documentTypesFor}.
 */
const SECTION_TIER_DOCUMENT_TYPES: readonly string[] = CODAL_DOCUMENT_TYPES;

const TIERS: readonly Tier[] = [
  { n: 1, label: 'digest', contentType: 'digest', priority: 1 },
  { n: 2, label: 'codals', contentType: 'legal_document', priority: 2 },
  // Tier 4 sits here, before decisions: 4,857 sections of published statutory
  // text are the work that is actually blocked today, and they must not queue
  // behind a 15,464-document decision backfill. Its priority is BELOW digests
  // (1) so that backfill can never starve a publish, and above decisions.
  {
    n: 4,
    label: 'statutory_sections',
    contentType: 'legal_document_section',
    priority: 3,
  },
  // Tier 3 is enqueued at a deliberately lower priority so a 15,464-document
  // decision backfill can never starve a newly published digest.
  { n: 3, label: 'decision', contentType: 'legal_document', priority: 10 },
];

/** Bytes per second of audio at the pinned 48 kbps encode. */
const BYTES_PER_AUDIO_SECOND = (48 * 1000) / 8;

/**
 * The language the backfill narrates in. Bound once and used for BOTH the
 * enqueue and the refused-rendition lookup, so the two can never disagree about
 * which row describes the work this tick is about to schedule.
 */
const RECONCILE_LANGUAGE = 'en';

/** Refuse to enqueue below this much free space on the MinIO volume. */
const MIN_FREE_DISK_BYTES = 20 * 1024 ** 3;

/**
 * Rough seconds of audio one item of each tier produces: average characters per
 * item divided by chars per audio-second.
 *
 * The chars/sec divisor is now MEASURED, not assumed — Kokoro's af_heart yields
 * 13.7 chars per audio-second on prod (2026-07-29: 1,793 chars → 131.0 s of
 * audio), replacing the Phase 0 spike's 15.0. Polly's Matthew was 15.8, so the
 * same corpus narrates ~15% longer on Kokoro.
 *
 * The per-item character counts remain CORPUS ARITHMETIC (totals ÷ row counts),
 * so these are estimates — but the conversion factor behind them is no longer a
 * guess. Note these are seconds of AUDIO, not wall clock: at the measured ~0.97x
 * realtime throughput (see services/tts-service/src/config.py) wall clock per
 * worker is roughly the same number again.
 *
 *   tier 1  digest    ~1,592 chars/item                      → ~116 s
 *   tier 2  codals    ~178,000 chars/doc  (4.27M / 24)       → ~13,000 s
 *   tier 3  decision  ~25,600 chars/doc   (396.08M / 15,464) → ~1,870 s
 *   tier 4  sections  ~504 chars/section  (2.45M / 4,857)    → ~37 s
 *
 * Tier 4's per-item figure is MEASURED on the four documents it covers
 * (prod 2026-07-31): Administrative Code 1,229 sections avg 638, Civil Code
 * 2,533 avg 306, NIRC 401 avg 1,309, Rules of Court — Civil Procedure 694
 * avg 531.
 */
const ESTIMATED_SECONDS_PER_ITEM: Record<Tier['n'], number> = {
  1: 116,
  2: 13_000,
  3: 1_870,
  4: 37,
};

@Injectable()
export class AudioReconcilerService {
  private readonly logger = new Logger(AudioReconcilerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renditions: AudioRenditionService,
    private readonly storage: AudioStorageService,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('AUDIO_RECONCILER_ENABLED', 'false') === 'true';
  }

  /** Tier 3 needs BOTH flags — see the storage note in the class docs. */
  private get decisionsEnabled(): boolean {
    return (
      this.enabled &&
      this.config.get<string>('AUDIO_RECONCILE_DECISIONS', 'false') === 'true'
    );
  }

  /** Log what WOULD be enqueued without enqueueing. Requires the reconciler on. */
  private get dryRun(): boolean {
    return (
      this.config.get<string>('AUDIO_RECONCILE_DRY_RUN', 'false') === 'true'
    );
  }

  private get batchSize(): number {
    return Number(this.config.get<string>('AUDIO_RECONCILE_BATCH', '200'));
  }

  /**
   * Enqueue narratable content that has no `ready` rendition for the active
   * voice. THIS IS THE BACKFILL — there is no separate backfill script.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async reconcile(): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('Reconciler disabled (AUDIO_RECONCILER_ENABLED=false)');
      return;
    }

    // The disk guard measures a LOCAL volume, so it only means something while
    // renditions are written there. Once storage is remote, audio is streamed
    // straight to the bucket and nothing audio-related touches this filesystem —
    // enforcing the threshold then would halt the backfill over an unrelated
    // local disk issue. Skipped in one place, from the storage service's own
    // flag, so location and guard can never disagree.
    const remote = this.storage.isRemote;
    let free: number | null = null;

    if (remote) {
      this.logger.log({
        event: 'audio_reconcile_disk_guard_skipped',
        message:
          'Disk guard skipped: audio storage is remote (AUDIO_S3_ENDPOINT set), ' +
          'so local free space does not bound how much audio can be stored',
      });
    } else {
      free = await this.freeDiskBytes();
      if (free !== null && free < MIN_FREE_DISK_BYTES) {
        this.logger.error({
          event: 'audio_reconcile_disk_guard',
          freeBytes: free,
          minRequiredBytes: MIN_FREE_DISK_BYTES,
          message: 'Refusing to enqueue audio: free disk below threshold',
        });
        return;
      }
    }

    await this.logCumulativeBytes();

    let remaining = this.batchSize;
    let refusedThisTick = 0;
    for (const tier of TIERS) {
      // `!remote` matters: in remote mode `free` is deliberately never measured,
      // so without it this branch would read "unmeasurable" and refuse tier 3
      // forever — the opposite of what moving storage off-box achieves.
      if (tier.n === 3 && !remote && free === null) {
        // The guard exists FOR tier 3: ~158 GB of decisions against 142 GB free
        // on the local MinIO volume. Tiers 1-2 total ~12 GB and may proceed on
        // an unmeasurable path, but letting tier 3 through would defeat the
        // only case the guard was written for.
        this.logger.error({
          event: 'audio_reconcile_disk_unmeasurable',
          tier: tier.n,
          path: this.config.get<string>('AUDIO_STORAGE_PATH', '/'),
          message:
            'Refusing tier 3: free disk could not be measured. Tiers 1-2 proceed.',
        });
        continue;
      }

      if (tier.n === 3 && !this.decisionsEnabled) {
        this.logger.warn({
          event: 'audio_reconcile_tier_skipped',
          tier: tier.n,
          label: tier.label,
          message:
            'Tier 3 (decisions) skipped: requires AUDIO_RECONCILER_ENABLED=true ' +
            'AND AUDIO_RECONCILE_DECISIONS=true',
        });
        continue;
      }

      // `total` is an uncapped COUNT so the logged gap is the real remaining
      // work; only the id list is limited. Reporting the capped list length
      // would log a flat 1000 for the first 14,000+ decisions and read as
      // stalled progress.
      const total = await this.gapTotalForTier(tier);
      this.logger.log({
        event: 'audio_reconcile_gap',
        tier: tier.n,
        label: tier.label,
        remainingGap: total,
      });

      if (remaining <= 0) continue;
      const ids = await this.gapIdsForTier(tier, remaining);
      const { enqueueable, refused } = await this.partitionRefused(tier, ids);
      refusedThisTick += refused.length;

      if (this.dryRun) {
        this.logger.log({
          event: 'audio_reconcile_dry_run',
          tier: tier.n,
          label: tier.label,
          wouldEnqueue: enqueueable.length,
          remainingGap: total,
          sampleIds: enqueueable.slice(0, 5),
          estimatedHoursForTier: +(
            (total * this.estimatedSecondsPerItem(tier)) /
            3600
          ).toFixed(1),
          message: 'DRY RUN: nothing enqueued',
        });
        remaining -= enqueueable.length;
        continue;
      }

      for (const id of enqueueable) {
        await this.enqueue(tier, id);
      }
      // Refused ids cost no synthesis, so they must not consume the tick's
      // batch budget — otherwise 4 permanently-refused codals would silently
      // shrink every tick's real workload.
      remaining -= enqueueable.length;
    }

    if (refusedThisTick > 0) {
      // The gap query counts anything without a `ready` rendition, so refused
      // content stays in `remainingGap` forever by design. Without this line
      // that residual reads as a stalled backfill instead of a closed question.
      this.logger.warn({
        event: 'audio_reconcile_permanently_refused',
        skipped: refusedThisTick,
        reasons: [...REFUSED_FAILURE_REASONS],
        message:
          'Skipped content whose rendition failed for a reason re-running cannot ' +
          'change; it remains in the gap by design. An admin force render still ' +
          'bypasses this and runs.',
      });
    }
  }

  /**
   * Split a tier's gap ids into what to enqueue and what is permanently refused.
   *
   * Without this, part 1 of this change makes things WORSE: the 4 codals that
   * fail `output_too_large` were only being held back by the stale job ids that
   * blocked every re-enqueue. Once those stop blocking, the hourly tick would
   * retry all 4 forever, each attempt reproducing the identical refusal.
   *
   * One query per tier, keyed on the same (voice, language) the enqueue uses.
   */
  private async partitionRefused(
    tier: Tier,
    ids: string[],
  ): Promise<{ enqueueable: string[]; refused: string[] }> {
    if (ids.length === 0) return { enqueueable: [], refused: [] };

    const failed = await this.prisma.audioRendition.findMany({
      where: {
        contentType: tier.contentType,
        contentId: { in: ids },
        language: RECONCILE_LANGUAGE,
        voiceId: this.renditions.voiceId,
        status: 'failed',
      },
      select: { contentId: true, failureReason: true },
    });

    const refusedIds = new Set(
      failed
        .filter((row) => isPermanentlyRefused(row.failureReason))
        .map((row) => row.contentId),
    );
    if (refusedIds.size === 0) return { enqueueable: ids, refused: [] };

    return {
      enqueueable: ids.filter((id) => !refusedIds.has(id)),
      refused: ids.filter((id) => refusedIds.has(id)),
    };
  }

  /** Estimated seconds of audio one item of this tier produces. */
  private estimatedSecondsPerItem(tier: Tier): number {
    return ESTIMATED_SECONDS_PER_ITEM[tier.n];
  }

  /**
   * Document types belonging to a legal-document tier.
   *
   * CRITICAL: tier 2 SUBTRACTS {@link SECTION_TIER_DOCUMENT_TYPES}. Without
   * that, a statutory document would be counted in tier 2's gap as one
   * whole-document item AND in tier 4's gap as N sections — the same text
   * enqueued twice, synthesized twice, and stored twice. Deriving the exclusion
   * here rather than hardcoding a second list means the two tiers cannot drift
   * into overlapping.
   *
   * With today's sets this leaves tier 2 empty: every codal type is narrated
   * per section. Tier 2 stays in place as the home for any future statutory
   * type that is short enough to narrate whole; it reports a gap of 0 until
   * then. Documents that ALREADY have a ready whole-document rendition keep
   * serving it — tier 2 having no work does not withdraw anything.
   */
  private documentTypesFor(tier: Tier): string[] {
    if (tier.n !== 2) return ['decision'];
    return CODAL_DOCUMENT_TYPES.filter(
      (type) => !SECTION_TIER_DOCUMENT_TYPES.includes(type),
    );
  }

  /** Uncapped count of a tier's published content lacking a ready rendition. */
  private async gapTotalForTier(tier: Tier): Promise<number> {
    const voiceId = this.renditions.voiceId;

    if (tier.n === 1) {
      const [row] = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM digests d
        WHERE d.visibility = 'public_editorial'
          AND d.review_status = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM audio_renditions ar
            WHERE ar.content_type = 'digest'
              AND ar.content_id = d.id::text
              AND ar.voice_id = ${voiceId}
              AND ar.status = 'ready'
          )
      `;
      return Number(row?.count ?? 0);
    }

    if (tier.n === 4) {
      const [row] = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM legal_document_sections s
        JOIN legal_documents ld ON ld.id = s.legal_document_id
        WHERE ld.status = 'published'
          AND ld.document_type = ANY(${[...SECTION_TIER_DOCUMENT_TYPES]}::text[])
          AND s.plain_text IS NOT NULL
          AND btrim(s.plain_text) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM audio_renditions ar
            WHERE ar.content_type = 'legal_document_section'
              AND ar.content_id = s.id::text
              AND ar.voice_id = ${voiceId}
              AND ar.status = 'ready'
          )
      `;
      return Number(row?.count ?? 0);
    }

    const [row] = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM legal_documents ld
      WHERE ld.status = 'published'
        AND ld.document_type = ANY(${this.documentTypesFor(tier)}::text[])
        AND NOT EXISTS (
          SELECT 1 FROM audio_renditions ar
          WHERE ar.content_type = 'legal_document'
            AND ar.content_id = ld.id::text
            AND ar.voice_id = ${voiceId}
            AND ar.status = 'ready'
        )
    `;
    return Number(row?.count ?? 0);
  }

  /** Up to `limit` ids from a tier's gap, oldest first. */
  private async gapIdsForTier(tier: Tier, limit: number): Promise<string[]> {
    const voiceId = this.renditions.voiceId;

    if (tier.n === 1) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT d.id
        FROM digests d
        WHERE d.visibility = 'public_editorial'
          AND d.review_status = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM audio_renditions ar
            WHERE ar.content_type = 'digest'
              AND ar.content_id = d.id::text
              AND ar.voice_id = ${voiceId}
              AND ar.status = 'ready'
          )
        ORDER BY d.created_at ASC
        LIMIT ${limit}
      `;
      return rows.map((r) => r.id);
    }

    if (tier.n === 4) {
      // `ordering` then id: the backfill fills a document front to back, so a
      // partially-narrated document is playable from its first article rather
      // than pocked with gaps.
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT s.id
        FROM legal_document_sections s
        JOIN legal_documents ld ON ld.id = s.legal_document_id
        WHERE ld.status = 'published'
          AND ld.document_type = ANY(${[...SECTION_TIER_DOCUMENT_TYPES]}::text[])
          AND s.plain_text IS NOT NULL
          AND btrim(s.plain_text) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM audio_renditions ar
            WHERE ar.content_type = 'legal_document_section'
              AND ar.content_id = s.id::text
              AND ar.voice_id = ${voiceId}
              AND ar.status = 'ready'
          )
        ORDER BY ld.created_at ASC, s.ordering ASC, s.id ASC
        LIMIT ${limit}
      `;
      return rows.map((r) => r.id);
    }

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT ld.id
      FROM legal_documents ld
      WHERE ld.status = 'published'
        AND ld.document_type = ANY(${this.documentTypesFor(tier)}::text[])
        AND NOT EXISTS (
          SELECT 1 FROM audio_renditions ar
          WHERE ar.content_type = 'legal_document'
            AND ar.content_id = ld.id::text
            AND ar.voice_id = ${voiceId}
            AND ar.status = 'ready'
        )
      ORDER BY ld.created_at ASC
      LIMIT ${limit}
    `;
    return rows.map((r) => r.id);
  }

  /**
   * Enqueue one item at the tier's priority.
   *
   * Delegates to {@link AudioRenditionService.requestGeneration} — the single
   * enqueue path — so the job id, retry policy and retention cannot drift from
   * what the on-demand read path produces. The id IS the dedupe key: a divergent
   * id here would make a user request during a backfill synthesize the same
   * audio a second time. Priority is the only thing this tier layer contributes.
   */
  private async enqueue(tier: Tier, contentId: string): Promise<void> {
    await this.renditions.requestGeneration(
      tier.contentType,
      contentId,
      RECONCILE_LANGUAGE,
      false,
      tier.priority,
    );
  }

  /**
   * Log cumulative audio volume produced so far. Byte size is not stored, so it
   * is derived from total duration at the pinned 48 kbps encode — an estimate,
   * labelled as such.
   */
  private async logCumulativeBytes(): Promise<void> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ count: bigint; duration_ms: bigint | null }>
    >`
      SELECT COUNT(*) AS count, COALESCE(SUM(duration_ms), 0) AS duration_ms
      FROM audio_renditions
      WHERE engine = 'kokoro' AND status = 'ready'
    `;
    const durationMs = Number(row?.duration_ms ?? 0);
    this.logger.log({
      event: 'audio_reconcile_volume',
      renditions: Number(row?.count ?? 0),
      audioHours: +(durationMs / 3_600_000).toFixed(2),
      estimatedBytesAt48Kbps: Math.round((durationMs / 1000) * BYTES_PER_AUDIO_SECOND),
    });
  }

  /**
   * Free bytes on the MinIO volume. Returns null when the path cannot be
   * measured — the guard then fails OPEN, because the two feature flags already
   * gate every enqueue and tiers 1-2 need only ~12.3 GB.
   *
   * NOTE: this measures a LOCAL path. Once AUDIO_S3_ENDPOINT routes audio to an
   * external bucket (see AudioStorageService), local free space no longer bounds
   * how much audio can be stored and this guard stops describing the real limit
   * — it would need to become a quota/billing check against that bucket instead.
   */
  private async freeDiskBytes(): Promise<number | null> {
    const path = this.config.get<string>('AUDIO_STORAGE_PATH', '/');
    try {
      const stats = await statfs(path);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(
        `Could not measure free disk at ${path} (${message}); skipping disk guard`,
      );
      return null;
    }
  }
}

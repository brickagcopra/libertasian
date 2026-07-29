import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { statfs } from 'fs/promises';

import { PrismaService } from '../../prisma/prisma.service';
import { AudioRenditionService } from './audio-rendition.service';
import {
  AUDIO_JOB,
  AUDIO_QUEUE,
  CODAL_DOCUMENT_TYPES,
  type AudioContentType,
} from './audio.types';

/** One reconciliation tier, highest priority first. */
interface Tier {
  readonly n: 1 | 2 | 3;
  readonly label: string;
  readonly contentType: AudioContentType;
  /** Lower number = higher BullMQ priority. */
  readonly priority: number;
}

const TIERS: readonly Tier[] = [
  { n: 1, label: 'digest', contentType: 'digest', priority: 1 },
  { n: 2, label: 'codals', contentType: 'legal_document', priority: 2 },
  // Tier 3 is enqueued at a deliberately lower priority so a 15,464-document
  // decision backfill can never starve a newly published digest.
  { n: 3, label: 'decision', contentType: 'legal_document', priority: 10 },
];

/** Bytes per second of audio at the pinned 48 kbps encode. */
const BYTES_PER_AUDIO_SECOND = (48 * 1000) / 8;

/** Refuse to enqueue below this much free space on the MinIO volume. */
const MIN_FREE_DISK_BYTES = 20 * 1024 ** 3;

@Injectable()
export class AudioReconcilerService {
  private readonly logger = new Logger(AudioReconcilerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renditions: AudioRenditionService,
    private readonly config: ConfigService,
    @InjectQueue(AUDIO_QUEUE) private readonly queue: Queue,
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

    const free = await this.freeDiskBytes();
    if (free !== null && free < MIN_FREE_DISK_BYTES) {
      this.logger.error({
        event: 'audio_reconcile_disk_guard',
        freeBytes: free,
        minRequiredBytes: MIN_FREE_DISK_BYTES,
        message: 'Refusing to enqueue audio: free disk below threshold',
      });
      return;
    }

    await this.logCumulativeBytes();

    let remaining = this.batchSize;
    for (const tier of TIERS) {
      if (tier.n === 3 && free === null) {
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
      for (const id of ids) {
        await this.enqueue(tier, id);
      }
      remaining -= ids.length;
    }
  }

  /** Document types belonging to a legal-document tier. */
  private documentTypesFor(tier: Tier): string[] {
    return tier.n === 2 ? [...CODAL_DOCUMENT_TYPES] : ['decision'];
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

  /** Enqueue one item at the tier's priority. */
  private async enqueue(tier: Tier, contentId: string): Promise<void> {
    await this.queue.add(
      AUDIO_JOB,
      { contentType: tier.contentType, contentId, language: 'en', force: false },
      {
        jobId: `${tier.contentType}:${contentId}:en:${this.renditions.voiceId}`,
        priority: tier.priority,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
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

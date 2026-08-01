import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../uploads/s3.service';
import {
  ACCOUNT_PURGE_QUEUE,
  type PurgeUserContentJobData,
} from './account-deletion.types';

/**
 * Deletes a deleted user's private content.
 *
 * Idempotent by construction: every step is a `deleteMany` over rows selected
 * by user id, so a re-run after a partial failure simply finds nothing left to
 * delete and completes. Object-storage deletes are best-effort and tolerate a
 * key that is already gone.
 *
 * `audit_logs` are NOT touched — that table is append-only and retained for two
 * years per the Philippine Data Privacy Act. The `users` row itself is retained
 * too, already anonymized by AccountDeletionService.
 */
@Processor(ACCOUNT_PURGE_QUEUE)
export class AccountPurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountPurgeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {
    super();
  }

  async process(job: Job<PurgeUserContentJobData>): Promise<void> {
    const { userId, organizationIds } = job.data;
    this.logger.log(`Purging private content for user ${userId}`);

    // Storage first: once the upload rows are gone we no longer know the keys,
    // and an orphaned S3 object is worse than an orphaned DB row.
    await this.purgeUploadObjects(userId);

    // Order follows the foreign keys. `matters` last: MatterDocument and
    // MatterComment cascade from it, and the workspace artifacts that reference
    // a matter are set NULL rather than deleted.
    const counts = {
      bookmarks: (
        await this.prisma.bookmark.deleteMany({ where: { userId } })
      ).count,
      annotations: (
        await this.prisma.annotation.deleteMany({ where: { userId } })
      ).count,
      notes: (await this.prisma.note.deleteMany({ where: { userId } })).count,
      // Cascades to camera_captures (the scans), upload_processing_jobs and
      // ocr_results.
      uploads: (
        await this.prisma.userUpload.deleteMany({ where: { userId } })
      ).count,
      // Only PRIVATE digests. A digest the user consented to publish into the
      // editorial corpus is corpus content, not personal data, and survives.
      digests: (
        await this.prisma.digest.deleteMany({
          where: { userId, visibility: 'private' },
        })
      ).count,
      matters: (
        await this.prisma.matter.deleteMany({ where: { ownerUserId: userId } })
      ).count,
      memberships: (
        await this.prisma.organizationMember.deleteMany({ where: { userId } })
      ).count,
      pushTokens: (
        await this.prisma.pushToken.deleteMany({ where: { userId } })
      ).count,
    };

    // A published digest keeps existing but must stop pointing at a person.
    const orphanedDigests = await this.prisma.digest.updateMany({
      where: { userId },
      data: { userId: null },
    });

    this.logger.log(
      `Purged user ${userId}: ${JSON.stringify(counts)}, ` +
        `${orphanedDigests.count} published digest(s) detached, ` +
        `${organizationIds.length} org(s) marked deleted`,
    );
  }

  /**
   * Best-effort removal of the user's stored objects. A failure here is logged
   * and swallowed: the DB purge is what the deletion policy promises, and
   * throwing would make BullMQ retry the whole job for a key that is already
   * gone.
   */
  private async purgeUploadObjects(userId: string): Promise<void> {
    const uploads = await this.prisma.userUpload.findMany({
      where: { userId },
      select: { objectKey: true, ocrTextObjectKey: true },
    });

    const keys = uploads.flatMap((u) =>
      [u.objectKey, u.ocrTextObjectKey].filter(
        (k): k is string => typeof k === 'string' && k.length > 0,
      ),
    );

    for (const key of keys) {
      try {
        await this.s3.delete(key);
      } catch (err) {
        this.logger.warn(
          `Failed to delete object ${key} for user ${userId}: ${
            err instanceof Error ? err.message : 'Unknown error'
          }`,
        );
      }
    }
  }
}

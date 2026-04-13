import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
// file-type@16 uses fromBuffer (not fileTypeFromBuffer)
async function fileTypeFromBuffer(buffer: Uint8Array | ArrayBuffer) {
  const fileType = await import('file-type');
  return fileType.fromBuffer(buffer as Buffer);
}

import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../uploads/s3.service';

/** Allowed MIME types for feed images (no SVG per Addendum) */
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedMime = (typeof ALLOWED_MIMES)[number];

/** Extension mapping for S3 key generation */
const MIME_EXTENSIONS: Record<AllowedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Max file size: 20MB per CLAUDE.md */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

@Injectable()
export class FeedMediaService {
  private readonly logger = new Logger(FeedMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    @InjectQueue('feed-media') private readonly mediaQueue: Queue,
  ) {}

  /**
   * Initiate a media upload: validate, upload raw to S3 temp, create DB records,
   * enqueue BullMQ processing job. Returns 202 Accepted with mediaId.
   */
  async initiateUpload(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    userId: string,
    organizationId: string,
  ) {
    // 1. Size check
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds maximum 20MB`,
      );
    }

    // 2. Extension allowlist check
    if (!ALLOWED_MIMES.includes(file.mimetype as AllowedMime)) {
      throw new BadRequestException(
        `File type "${file.mimetype}" not allowed. Allowed: ${ALLOWED_MIMES.join(', ')}`,
      );
    }

    // 3. Magic byte validation (per CLAUDE.md: verify content matches declared MIME)
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !ALLOWED_MIMES.includes(detected.mime as AllowedMime)) {
      throw new BadRequestException(
        'File content does not match an allowed image type',
      );
    }
    if (detected.mime !== file.mimetype) {
      throw new BadRequestException(
        `Declared MIME "${file.mimetype}" does not match detected "${detected.mime}"`,
      );
    }

    // 4. Compute SHA-256 checksum
    const sha256Checksum = this.s3.computeChecksum(file.buffer);

    // 5. Generate UUID-based object key for raw temp storage
    const mediaId = crypto.randomUUID();
    const ext = MIME_EXTENSIONS[file.mimetype as AllowedMime];
    const rawObjectKey = `feed-temp/${organizationId}/${userId}/${mediaId}/raw.${ext}`;

    // 6. Upload raw file to S3 temp location
    await this.s3.upload(rawObjectKey, file.buffer, file.mimetype, `raw.${ext}`);

    // 7. Create FeedPostMedia record
    const media = await this.prisma.feedPostMedia.create({
      data: {
        id: mediaId,
        ownerUserId: userId,
        organizationId,
        originalObjectKey: rawObjectKey,
        mimeType: file.mimetype,
        originalFileSize: file.size,
        sha256Checksum,
        processingStatus: 'pending',
      },
    });

    // 8. Create processing job record
    const job = await this.prisma.feedMediaProcessingJob.create({
      data: {
        mediaId: media.id,
        jobType: 'process_image',
        status: 'pending',
      },
    });

    // 9. Enqueue BullMQ job
    await this.mediaQueue.add('process-feed-media', {
      mediaId: media.id,
      jobId: job.id,
    });

    this.logger.log(
      `Feed media upload initiated: mediaId=${media.id}, size=${file.size}, mime=${file.mimetype}`,
    );

    return {
      mediaId: media.id,
      processingStatus: media.processingStatus,
    };
  }

  /**
   * Get media processing status + URLs if ready.
   */
  async getMediaStatus(mediaId: string, userId: string) {
    const media = await this.prisma.feedPostMedia.findUnique({
      where: { id: mediaId },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }
    if (media.ownerUserId !== userId) {
      throw new ForbiddenException('Media does not belong to you');
    }

    return {
      mediaId: media.id,
      processingStatus: media.processingStatus,
      moderationStatus: media.moderationStatus,
      processedObjectKey: media.processedObjectKey,
      thumbnailObjectKey: media.thumbnailObjectKey,
      width: media.width,
      height: media.height,
      failureReason: media.failureReason,
    };
  }

  /**
   * Get the image buffer from S3 for a specific variant (feed or thumb).
   *
   * Non-owner access is gated by the parent post's tenant visibility: a
   * viewer in a different organization cannot fetch the image bytes of
   * an organization-scoped post even if they learn the mediaId. Prior to
   * this fix (BYPASS #1 in security-investigation.md) the guard only
   * checked status + deletedAt and ignored the visibility/organizationId
   * it selected — dead defensive code that allowed cross-tenant image
   * reads on org-scoped posts. Mirrors the getPost tenant-scoping fix
   * shape exactly. `viewerOrgId` is threaded from the authenticated
   * session at the controller boundary.
   */
  async getMediaImage(
    mediaId: string,
    variant: 'feed' | 'thumb',
    userId: string,
    viewerOrgId: string,
  ) {
    const media = await this.prisma.feedPostMedia.findUnique({
      where: { id: mediaId },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    // Allow access if user owns it OR the media is attached to a
    // published post the viewer is entitled to read (public, or
    // organization-scoped and the viewer is in that organization).
    if (media.ownerUserId !== userId) {
      const post = await this.prisma.feedPost.findFirst({
        where: {
          mediaId,
          status: 'published',
          deletedAt: null,
          OR: [
            { visibility: 'public' },
            { visibility: 'organization', organizationId: viewerOrgId },
          ],
        },
        select: { id: true },
      });
      if (!post) {
        throw new ForbiddenException('Access denied');
      }
    }

    if (media.processingStatus !== 'ready') {
      throw new BadRequestException('Media is not ready');
    }

    const objectKey = variant === 'thumb'
      ? media.thumbnailObjectKey
      : media.processedObjectKey;

    if (!objectKey) {
      throw new NotFoundException('Image variant not available');
    }

    const buffer = await this.s3.get(objectKey);
    return { buffer, mimeType: 'image/jpeg' };
  }

  /**
   * Delete unattached media (cleanup).
   */
  async deleteMedia(mediaId: string, userId: string) {
    const media = await this.prisma.feedPostMedia.findUnique({
      where: { id: mediaId },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }
    if (media.ownerUserId !== userId) {
      throw new ForbiddenException('Media does not belong to you');
    }

    // Check if attached to a post
    const post = await this.prisma.feedPost.findUnique({
      where: { mediaId },
    });
    if (post) {
      throw new BadRequestException('Cannot delete media attached to a post');
    }

    // Delete S3 objects
    try {
      await this.s3.delete(media.originalObjectKey);
      if (media.processedObjectKey) await this.s3.delete(media.processedObjectKey);
      if (media.thumbnailObjectKey) await this.s3.delete(media.thumbnailObjectKey);
    } catch (err) {
      this.logger.warn(`Failed to delete S3 objects for media ${mediaId}: ${err}`);
    }

    // Delete DB records (cascade deletes processing jobs)
    await this.prisma.feedPostMedia.delete({ where: { id: mediaId } });
  }
}

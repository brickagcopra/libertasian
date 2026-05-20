import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import sharp from 'sharp';

import { PrismaService } from '../../prisma/prisma.service';
import { ClamavService } from '../uploads/clamav.service';
import { S3Service } from '../uploads/s3.service';

interface FeedMediaJobData {
  mediaId: string;
  jobId: string;
}

// Sharp security per CLAUDE.md: prevent memory accumulation in workers
sharp.cache(false);

/** Max input pixels (100MP) to prevent decompression bombs per CLAUDE.md */
const SHARP_PIXEL_LIMIT = 100_000_000;

/** Max decoded dimensions before resize (extra safety check) */
const MAX_DECODED_DIMENSION = 4096;

/** Feed image: 1080px max width, JPEG quality 85 */
const FEED_MAX_WIDTH = 1080;
const FEED_JPEG_QUALITY = 85;

/** Thumbnail: 300px wide, JPEG quality 80 */
const THUMB_WIDTH = 300;
const THUMB_JPEG_QUALITY = 80;

@Processor('feed-media')
export class FeedMediaProcessor extends WorkerHost {
  private readonly logger = new Logger(FeedMediaProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly clamav: ClamavService,
  ) {
    super();
  }

  async process(job: Job<FeedMediaJobData>): Promise<void> {
    const { mediaId, jobId } = job.data;
    this.logger.log(`Processing feed media ${mediaId} (job ${jobId})`);

    try {
      // Mark as processing
      await this.updateJobStatus(jobId, 'processing');
      await this.updateMediaStatus(mediaId, 'processing');

      // Intentional bootstrap: no organizationId in scope yet. The row read provides media.organizationId for subsequent tenanted calls below.
      const media = await this.prisma.feedPostMedia.findUnique({
        where: { id: mediaId },
      });

      if (!media) {
        throw new Error(`Feed media ${mediaId} not found`);
      }

      // 1. Download raw from S3
      const buffer = await this.s3.get(media.originalObjectKey);

      // 2. ClamAV scan (per CLAUDE.md: scan every file before processing)
      const scanResult = await this.clamav.scanBuffer(buffer, `feed-media-${mediaId}`);

      if (!scanResult.clean) {
        this.logger.warn(
          `Feed media ${mediaId} quarantined: malware detected (${scanResult.virus})`,
        );

        // Move to quarantine location
        const quarantineKey = media.originalObjectKey.replace('feed-temp/', 'feed-quarantine/');
        await this.s3.upload(quarantineKey, buffer, media.mimeType, 'quarantined');
        await this.s3.delete(media.originalObjectKey);

        await this.prisma.forTenant(media.organizationId).feedPostMedia.update({
          where: { id: mediaId },
          data: {
            processingStatus: 'quarantined',
            failureReason: `Malware detected: ${scanResult.virus}`,
          },
        });

        await this.updateJobStatus(jobId, 'failed', `Malware detected: ${scanResult.virus}`);
        return;
      }

      this.logger.debug(`ClamAV scan passed for feed media ${mediaId}`);

      // 3. Validate decoded dimensions (extra safety before resize)
      const metadata = await sharp(buffer, { limitInputPixels: SHARP_PIXEL_LIMIT }).metadata();
      if (
        metadata.width &&
        metadata.height &&
        (metadata.width > MAX_DECODED_DIMENSION || metadata.height > MAX_DECODED_DIMENSION)
      ) {
        this.logger.warn(
          `Feed media ${mediaId}: dimensions ${metadata.width}x${metadata.height} exceed max ${MAX_DECODED_DIMENSION}px, will resize`,
        );
      }

      // 4. Process feed image: auto-orient, strip metadata, resize, JPEG output
      const feedImage = await sharp(buffer, { limitInputPixels: SHARP_PIXEL_LIMIT })
        .rotate() // auto-orient based on EXIF
        .withMetadata({}) // strip EXIF/GPS per CLAUDE.md
        .resize({ width: FEED_MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: FEED_JPEG_QUALITY })
        .toBuffer();

      // Get processed dimensions
      const feedMeta = await sharp(feedImage).metadata();

      // 5. Generate thumbnail
      const thumbnail = await sharp(buffer, { limitInputPixels: SHARP_PIXEL_LIMIT })
        .rotate()
        .withMetadata({})
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: THUMB_JPEG_QUALITY })
        .toBuffer();

      // 6. Upload processed + thumbnail to S3
      const processedKey = `feed/${media.organizationId}/${mediaId}/feed.jpg`;
      const thumbnailKey = `feed/${media.organizationId}/${mediaId}/thumb.jpg`;

      await Promise.all([
        this.s3.upload(processedKey, feedImage, 'image/jpeg', 'feed.jpg'),
        this.s3.upload(thumbnailKey, thumbnail, 'image/jpeg', 'thumb.jpg'),
      ]);

      // 7. Delete temp from S3
      await this.s3.delete(media.originalObjectKey);

      // 8. Update FeedPostMedia record
      await this.prisma.forTenant(media.organizationId).feedPostMedia.update({
        where: { id: mediaId },
        data: {
          processedObjectKey: processedKey,
          thumbnailObjectKey: thumbnailKey,
          width: feedMeta.width ?? null,
          height: feedMeta.height ?? null,
          processedFileSize: feedImage.length,
          processingStatus: 'ready',
        },
      });

      // 9. Mark job as completed
      await this.updateJobStatus(jobId, 'completed');

      this.logger.log(
        `Feed media ${mediaId} processed: feed=${feedImage.length}B, thumb=${thumbnail.length}B, ` +
          `dimensions=${feedMeta.width}x${feedMeta.height}`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown processing error';
      this.logger.error(`Feed media ${mediaId} processing failed: ${errorMessage}`);

      await this.updateJobStatus(jobId, 'failed', errorMessage);
      // Bootstrap path: the const `media` from the try block is out of scope
      // here, so we cannot know organizationId. Stays on direct prisma.
      await this.prisma.feedPostMedia.update({
        where: { id: mediaId },
        data: {
          processingStatus: 'failed',
          failureReason: errorMessage,
        },
      });

      throw err; // Let BullMQ handle retries
    }
  }

  private async updateJobStatus(jobId: string, status: string, errorMessage?: string) {
    await this.prisma.feedMediaProcessingJob.update({
      where: { id: jobId },
      data: {
        status,
        ...(errorMessage && { errorMessage }),
        ...(status === 'processing' && { startedAt: new Date(), attempts: { increment: 1 } }),
        ...(status === 'completed' && { finishedAt: new Date() }),
        ...(status === 'failed' && { finishedAt: new Date() }),
      },
    });
  }

  private async updateMediaStatus(
    mediaId: string,
    status: string,
    organizationId?: string,
  ) {
    if (organizationId) {
      await this.prisma.forTenant(organizationId).feedPostMedia.update({
        where: { id: mediaId },
        data: { processingStatus: status },
      });
    } else {
      // Bootstrap path: called before the row's organizationId has been read.
      await this.prisma.feedPostMedia.update({
        where: { id: mediaId },
        data: { processingStatus: status },
      });
    }
  }
}

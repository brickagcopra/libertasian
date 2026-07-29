import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { S3Service } from '../uploads/s3.service';

/**
 * Object storage for audio renditions only.
 *
 * Audio and user uploads shared a single {@link S3Service} pointed at MinIO.
 * Every rendition is `public_editorial` corpus output, while uploads and camera
 * scans are private per-org data, so the two are split here: audio can move to
 * an external bucket (Cloudflare R2) without relocating anything private.
 *
 * Two modes, chosen by whether AUDIO_S3_ENDPOINT is set:
 *
 *  - UNSET (the default in every environment today) — delegate straight to the
 *    injected S3Service. No second client is constructed and behaviour is
 *    byte-for-byte unchanged, including the S3_PUBLIC_ENDPOINT presign path.
 *  - SET — own S3Client against AUDIO_S3_* credentials and bucket.
 *
 * R2 presigns against the SAME endpoint it uploads to, so there is deliberately
 * no AUDIO_S3_PUBLIC_ENDPOINT: the upload host is already browser-reachable, and
 * a second signing origin would only reintroduce the Host-mismatch problem that
 * S3_PUBLIC_ENDPOINT exists to solve for MinIO-behind-nginx.
 *
 * The audio bucket must stay PRIVATE. Clients only ever receive short-TTL
 * presigned GET URLs (see AudioRenditionService), never a public object URL.
 *
 * SWITCHING IS NOT RETROACTIVE. Object keys are stored in `audio_renditions` and
 * signed against whichever backend is active NOW, so setting AUDIO_S3_ENDPOINT
 * makes every EXISTING rendition's key resolve against the new bucket. The 302
 * renditions already in MinIO must be copied across before the switch, or their
 * signed URLs will 404 — the rows still say `ready`. Unlike TTS_PROVIDER (where
 * a distinct voiceId makes Kokoro renditions land as new rows), nothing about
 * this switch is self-healing.
 */
@Injectable()
export class AudioStorageService {
  private readonly logger = new Logger(AudioStorageService.name);

  /** Null when AUDIO_S3_ENDPOINT is unset — the delegate-to-MinIO path. */
  private readonly client: S3Client | null;
  private readonly bucket: string | null;

  constructor(
    private readonly config: ConfigService,
    private readonly s3: S3Service,
  ) {
    const endpoint = this.config.get<string>('AUDIO_S3_ENDPOINT');
    if (!endpoint) {
      this.client = null;
      this.bucket = null;
      return;
    }

    this.bucket = this.config.get<string>('AUDIO_S3_BUCKET', 'libertasian-audio');
    this.client = new S3Client({
      endpoint,
      // R2 wants 'auto'; a real S3 region is accepted here too.
      region: this.config.get<string>('AUDIO_S3_REGION', 'auto'),
      credentials: {
        accessKeyId: this.config.get<string>('AUDIO_S3_ACCESS_KEY', ''),
        secretAccessKey: this.config.get<string>('AUDIO_S3_SECRET_KEY', ''),
      },
      forcePathStyle: true,
    });
    this.logger.log(
      `Audio objects routed to dedicated bucket ${this.bucket} at ${endpoint}`,
    );
  }

  /** True when audio has its own bucket rather than sharing the uploads one. */
  get isDedicated(): boolean {
    return this.client !== null;
  }

  async upload(
    objectKey: string,
    body: Buffer,
    contentType: string,
    originalFilename: string,
  ): Promise<void> {
    if (!this.client || !this.bucket) {
      return this.s3.upload(objectKey, body, contentType, originalFilename);
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
        // Renditions are fetched by <audio> and by fetch(), never navigated to,
        // but the attachment disposition is kept for parity with S3Service:
        // user-supplied text reaches the filename via the voice/language slug.
        ContentDisposition: `attachment; filename="${this.s3.sanitizeFilename(originalFilename)}"`,
      }),
    );

    this.logger.log(`Uploaded ${objectKey} (${body.length} bytes) to ${this.bucket}`);
  }

  /** Presigned GET URL. Signed against the upload endpoint — see class docs. */
  async getSignedUrl(objectKey: string, ttlSeconds = 300): Promise<string> {
    if (!this.client || !this.bucket) {
      return this.s3.getSignedUrl(objectKey, ttlSeconds);
    }

    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: ttlSeconds },
    );
  }
}

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  /**
   * Client used exclusively for presigning GET URLs handed to browsers.
   * When S3_PUBLIC_ENDPOINT is set it points at the browser-facing origin
   * (e.g. https://libertasian.com) so signed audio URLs resolve publicly;
   * otherwise it is the same internal client (dev/local unchanged).
   */
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>(
      'S3_BUCKET_UPLOADS',
      'libertasian-uploads',
    );

    // MinIO ignores the region but SigV4 still signs it, so it must match on
    // both clients. Configurable for S3-compatible backends that validate it;
    // leaving S3_REGION unset preserves the previous hardcoded value exactly.
    const region = this.config.get<string>('S3_REGION', 'us-east-1');
    const credentials = {
      accessKeyId: this.config.get<string>('S3_ACCESS_KEY', 'libertasian'),
      secretAccessKey: this.config.get<string>(
        'S3_SECRET_KEY',
        'libertasian_dev_secret',
      ),
    };

    this.client = new S3Client({
      endpoint: this.config.get<string>('S3_ENDPOINT', 'http://localhost:9000'),
      region,
      credentials,
      forcePathStyle: true, // Required for MinIO
    });

    // Presigned URLs must be signed against the public, browser-facing origin
    // so the SigV4 signature matches the Host nginx forwards to MinIO. The
    // path is NOT rewritten — MinIO validates the same path + Host + secret.
    const publicEndpoint = this.config.get<string>('S3_PUBLIC_ENDPOINT');
    this.presignClient = publicEndpoint
      ? new S3Client({
          endpoint: publicEndpoint,
          region,
          credentials,
          forcePathStyle: true,
        })
      : this.client;
  }

  /**
   * Generate a UUID-based object key for secure storage.
   * Path: uploads/{orgId}/{userId}/{uuid}/{sanitizedFilename}
   */
  generateObjectKey(
    organizationId: string,
    userId: string,
    originalFilename: string,
  ): string {
    const fileId = uuidv4();
    const sanitized = this.sanitizeFilename(originalFilename);
    return `uploads/${organizationId}/${userId}/${fileId}/${sanitized}`;
  }

  /**
   * Sanitize filename: strip path components, null bytes, special characters.
   * Preserves the file extension.
   */
  sanitizeFilename(filename: string): string {
    // Strip path components
    let name = filename.replace(/^.*[\\/]/, '');
    // Remove null bytes
    name = name.replace(/\0/g, '');
    // Replace special characters with underscores (keep alphanumeric, dots, hyphens)
    name = name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    // Prevent hidden files
    name = name.replace(/^\.+/, '');
    // Limit length
    if (name.length > 200) {
      const ext = name.lastIndexOf('.');
      if (ext > 0) {
        name = name.substring(0, 196) + name.substring(ext);
      } else {
        name = name.substring(0, 200);
      }
    }
    return name || 'unnamed';
  }

  async upload(
    objectKey: string,
    buffer: Buffer,
    mimeType: string,
    originalFilename: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
        ContentDisposition: `attachment; filename="${this.sanitizeFilename(originalFilename)}"`,
      }),
    );

    this.logger.log(`Uploaded ${objectKey} (${buffer.length} bytes)`);
  }

  async get(objectKey: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );

    const stream = response.Body;
    if (!stream) {
      throw new Error(`Empty response for ${objectKey}`);
    }

    // Collect stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );
    this.logger.log(`Deleted ${objectKey}`);
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Compute SHA-256 checksum of a buffer */
  computeChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Generate a presigned GET URL for an object with a short TTL.
   * Used to hand out time-limited download links (e.g. audio renditions)
   * without proxying bytes through the API or exposing bucket credentials.
   */
  async getSignedUrl(objectKey: string, ttlSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: ttlSeconds },
    );
  }
}

import { ConfigService } from '@nestjs/config';

import { S3Service } from '../uploads/s3.service';
import { AudioStorageService } from './audio-storage.service';

// Each constructed client records the config it was built with so the tests can
// assert WHICH client (and which credentials/region) an operation used.
const mockSend = jest.fn();
const s3ClientCtor = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation((config) => {
    s3ClientCtor(config);
    return { send: mockSend, __config: config };
  }),
  PutObjectCommand: jest
    .fn()
    .mockImplementation((params) => ({ ...params, _type: 'PutObject' })),
  GetObjectCommand: jest
    .fn()
    .mockImplementation((params) => ({ ...params, _type: 'GetObject' })),
}));

// Build the URL from the signing client's endpoint so the host is assertable
// without a real SigV4 round-trip.
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(
    async (client, command, opts) =>
      `${client.__config.endpoint}/${command.Bucket}/${command.Key}` +
      `?X-Amz-Expires=${opts.expiresIn}&X-Amz-Signature=test`,
  ),
}));

/** A stand-in for the shared MinIO client that audio used to talk to directly. */
function delegateStub() {
  return {
    upload: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue('https://minio.internal/signed'),
    sanitizeFilename: jest.fn((name: string) => name.replace(/[^a-zA-Z0-9.\-_]/g, '_')),
  };
}

function build(env: Record<string, string | undefined> = {}) {
  const delegate = delegateStub();
  const config: ConfigService = {
    get: (key: string, def?: string): string | undefined => env[key] ?? def,
  } as unknown as ConfigService;

  const service = new AudioStorageService(
    config,
    delegate as unknown as S3Service,
  );
  return { service, delegate };
}

const R2_ENV = {
  AUDIO_S3_ENDPOINT: 'https://acct123.r2.cloudflarestorage.com',
  AUDIO_S3_ACCESS_KEY: 'r2-key',
  AUDIO_S3_SECRET_KEY: 'r2-secret',
  AUDIO_S3_BUCKET: 'libertasian-audio',
};

describe('AudioStorageService', () => {
  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue({});
    s3ClientCtor.mockReset();
  });

  afterEach(() => jest.restoreAllMocks());

  // The default path in EVERY environment today. If these break, merging this
  // change alters live behaviour — which it must not.
  describe('AUDIO_S3_ENDPOINT unset (delegates to the shared MinIO client)', () => {
    it('constructs no client of its own', () => {
      const { service } = build();

      expect(s3ClientCtor).not.toHaveBeenCalled();
      expect(service.isDedicated).toBe(false);
    });

    it('delegates upload verbatim', async () => {
      const { service, delegate } = build();
      const body = Buffer.from('mp3 bytes');

      await service.upload('audio/digest/d1/af_heart-en.mp3', body, 'audio/mpeg', 'af_heart-en.mp3');

      expect(delegate.upload).toHaveBeenCalledWith(
        'audio/digest/d1/af_heart-en.mp3',
        body,
        'audio/mpeg',
        'af_heart-en.mp3',
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('delegates getSignedUrl verbatim, preserving the TTL', async () => {
      const { service, delegate } = build();

      const url = await service.getSignedUrl('audio/digest/d1/af_heart-en.mp3', 300);

      expect(delegate.getSignedUrl).toHaveBeenCalledWith(
        'audio/digest/d1/af_heart-en.mp3',
        300,
      );
      // The S3_PUBLIC_ENDPOINT presign path stays entirely inside S3Service.
      expect(url).toBe('https://minio.internal/signed');
    });
  });

  describe('AUDIO_S3_ENDPOINT set (dedicated bucket)', () => {
    it('builds its own client from the AUDIO_S3_* credentials', () => {
      const { service } = build(R2_ENV);

      expect(service.isDedicated).toBe(true);
      expect(s3ClientCtor).toHaveBeenCalledTimes(1);
      expect(s3ClientCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: R2_ENV.AUDIO_S3_ENDPOINT,
          region: 'auto',
          credentials: { accessKeyId: 'r2-key', secretAccessKey: 'r2-secret' },
          forcePathStyle: true,
        }),
      );
    });

    it('honours an explicit AUDIO_S3_REGION', () => {
      build({ ...R2_ENV, AUDIO_S3_REGION: 'apac' });

      expect(s3ClientCtor).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'apac' }),
      );
    });

    it('uploads to AUDIO_S3_BUCKET, not the uploads bucket', async () => {
      const { service, delegate } = build(R2_ENV);
      const body = Buffer.from('mp3 bytes');

      await service.upload('audio/digest/d1/af_heart-en.mp3', body, 'audio/mpeg', 'af_heart-en.mp3');

      expect(delegate.upload).not.toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'libertasian-audio',
          Key: 'audio/digest/d1/af_heart-en.mp3',
          Body: body,
          ContentType: 'audio/mpeg',
          ContentDisposition: 'attachment; filename="af_heart-en.mp3"',
        }),
      );
    });

    it('presigns against the R2 host and bucket', async () => {
      const { service, delegate } = build(R2_ENV);

      const url = await service.getSignedUrl('audio/digest/d1/af_heart-en.mp3', 300);

      expect(delegate.getSignedUrl).not.toHaveBeenCalled();
      expect(url).toMatch(/^https:\/\/acct123\.r2\.cloudflarestorage\.com\//);
      expect(url).toContain('/libertasian-audio/audio/digest/d1/af_heart-en.mp3');
      expect(url).toContain('X-Amz-Expires=300');
    });

    // R2 serves presigned GETs from the upload endpoint, so a second signing
    // origin must never appear — that is the S3_PUBLIC_ENDPOINT workaround for
    // MinIO-behind-nginx and it would break the SigV4 Host match here.
    it('signs against the same endpoint it uploads to', async () => {
      const { service } = build({
        ...R2_ENV,
        S3_PUBLIC_ENDPOINT: 'https://libertasian.com',
      });

      const url = await service.getSignedUrl('audio/digest/d1/af_heart-en.mp3');

      expect(s3ClientCtor).toHaveBeenCalledTimes(1);
      expect(url).toMatch(/^https:\/\/acct123\.r2\.cloudflarestorage\.com\//);
    });
  });
});

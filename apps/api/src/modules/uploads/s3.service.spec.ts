import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { S3Service } from './s3.service';

// Mock @aws-sdk/client-s3 — each client records the endpoint it was built
// with so presign tests can assert which origin the URL is signed against.
const mockSend = jest.fn();
const s3ClientCtor = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation((config) => {
    s3ClientCtor(config);
    return {
      send: mockSend,
      __endpoint: config?.endpoint,
    };
  }),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'PutObject' })),
  GetObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'GetObject' })),
  DeleteObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'DeleteObject' })),
  HeadObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'HeadObject' })),
}));

// Mock the presigner — build a URL from the client's endpoint + bucket/key so
// tests can assert the signing host without a real SigV4 round-trip.
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async (client, command) =>
    `${client.__endpoint}/${command.Bucket}/${command.Key}?X-Amz-Signature=test`,
  ),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-uuid-1234'),
}));

describe('S3Service', () => {
  let service: S3Service;

  beforeEach(async () => {
    mockSend.mockReset();
    s3ClientCtor.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'S3_BUCKET_UPLOADS') return 'test-bucket';
              if (key === 'S3_ENDPOINT') return 'http://localhost:9000';
              if (key === 'S3_ACCESS_KEY') return 'test-key';
              if (key === 'S3_SECRET_KEY') return 'test-secret';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
  });

  // ---- region ----

  describe('region', () => {
    it('defaults to us-east-1, the value it used before becoming configurable', () => {
      // Both clients must agree: SigV4 signs the region even though MinIO
      // ignores it, so a mismatch would break presigned URLs.
      for (const [config] of s3ClientCtor.mock.calls) {
        expect(config.region).toBe('us-east-1');
      }
      expect(s3ClientCtor).toHaveBeenCalled();
    });

    it('uses S3_REGION when set', async () => {
      s3ClientCtor.mockReset();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          S3Service,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: string) =>
                key === 'S3_REGION' ? 'apac' : defaultValue,
              ),
            },
          },
        ],
      }).compile();
      module.get<S3Service>(S3Service);

      expect(s3ClientCtor).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'apac' }),
      );
    });
  });

  // ---- sanitizeFilename ----

  describe('sanitizeFilename', () => {
    it('should strip path components', () => {
      expect(service.sanitizeFilename('C:\\Users\\docs\\file.pdf')).toBe('file.pdf');
      expect(service.sanitizeFilename('/var/uploads/file.pdf')).toBe('file.pdf');
    });

    it('should remove null bytes', () => {
      expect(service.sanitizeFilename('file\0name.pdf')).toBe('filename.pdf');
    });

    it('should replace special characters with underscores', () => {
      expect(service.sanitizeFilename('file (1) [copy].pdf')).toBe('file__1___copy_.pdf');
    });

    it('should prevent hidden files', () => {
      expect(service.sanitizeFilename('.hidden')).toBe('hidden');
      expect(service.sanitizeFilename('...hidden')).toBe('hidden');
    });

    it('should limit length preserving extension', () => {
      const longName = 'a'.repeat(250) + '.pdf';
      const result = service.sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(200);
      expect(result).toMatch(/\.pdf$/);
    });

    it('should limit length without extension', () => {
      const longName = 'a'.repeat(250);
      const result = service.sanitizeFilename(longName);
      expect(result.length).toBe(200);
    });

    it('should return "unnamed" for empty result', () => {
      expect(service.sanitizeFilename('...')).toBe('unnamed');
    });
  });

  // ---- generateObjectKey ----

  describe('generateObjectKey', () => {
    it('should generate UUID-based object key', () => {
      const key = service.generateObjectKey('org-1', 'user-1', 'document.pdf');
      expect(key).toBe('uploads/org-1/user-1/test-uuid-1234/document.pdf');
    });

    it('should sanitize the filename in the key', () => {
      const key = service.generateObjectKey('org-1', 'user-1', '../../../etc/passwd');
      expect(key).not.toContain('..');
      expect(key).toMatch(/^uploads\/org-1\/user-1\/test-uuid-1234\//);
    });
  });

  // ---- upload ----

  describe('upload', () => {
    it('should send PutObjectCommand with correct parameters', async () => {
      mockSend.mockResolvedValue({});
      const buffer = Buffer.from('test content');

      await service.upload('uploads/org-1/file.pdf', buffer, 'application/pdf', 'file.pdf');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'uploads/org-1/file.pdf',
          Body: buffer,
          ContentType: 'application/pdf',
        }),
      );
    });

    it('should set Content-Disposition with sanitized filename', async () => {
      mockSend.mockResolvedValue({});
      const buffer = Buffer.from('test');

      await service.upload('key', buffer, 'application/pdf', 'my file (1).pdf');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentDisposition: 'attachment; filename="my_file__1_.pdf"',
        }),
      );
    });
  });

  // ---- get ----

  describe('get', () => {
    it('should retrieve object and return buffer', async () => {
      const chunks = [Buffer.from('hello '), Buffer.from('world')];
      const mockStream = (async function* () {
        for (const chunk of chunks) yield chunk;
      })();

      mockSend.mockResolvedValue({ Body: mockStream });

      const result = await service.get('uploads/org-1/file.pdf');
      expect(result.toString()).toBe('hello world');
    });

    it('should throw for empty response body', async () => {
      mockSend.mockResolvedValue({ Body: null });

      await expect(service.get('missing-key')).rejects.toThrow('Empty response');
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('should send DeleteObjectCommand', async () => {
      mockSend.mockResolvedValue({});

      await service.delete('uploads/org-1/file.pdf');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'uploads/org-1/file.pdf',
        }),
      );
    });
  });

  // ---- exists ----

  describe('exists', () => {
    it('should return true when object exists', async () => {
      mockSend.mockResolvedValue({});

      const result = await service.exists('uploads/org-1/file.pdf');
      expect(result).toBe(true);
    });

    it('should return false when object does not exist', async () => {
      mockSend.mockRejectedValue(new Error('Not found'));

      const result = await service.exists('missing-key');
      expect(result).toBe(false);
    });
  });

  // ---- computeChecksum ----

  describe('computeChecksum', () => {
    it('should return SHA-256 hex digest', () => {
      const buffer = Buffer.from('test content');
      const checksum = service.computeChecksum(buffer);

      expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return consistent checksum for same content', () => {
      const buffer = Buffer.from('same content');
      expect(service.computeChecksum(buffer)).toBe(service.computeChecksum(buffer));
    });

    it('should return different checksums for different content', () => {
      const a = service.computeChecksum(Buffer.from('content a'));
      const b = service.computeChecksum(Buffer.from('content b'));
      expect(a).not.toBe(b);
    });
  });

  // ---- getSignedUrl ----

  describe('getSignedUrl', () => {
    const buildService = async (publicEndpoint?: string) => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          S3Service,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: string) => {
                if (key === 'S3_BUCKET_UPLOADS') return 'test-bucket';
                if (key === 'S3_ENDPOINT') return 'http://minio:9000';
                if (key === 'S3_PUBLIC_ENDPOINT') return publicEndpoint;
                if (key === 'S3_ACCESS_KEY') return 'test-key';
                if (key === 'S3_SECRET_KEY') return 'test-secret';
                return defaultValue;
              }),
            },
          },
        ],
      }).compile();
      return module.get<S3Service>(S3Service);
    };

    it('signs against S3_PUBLIC_ENDPOINT when set', async () => {
      const svc = await buildService('https://libertasian.com');
      const url = await svc.getSignedUrl('audio/track.mp3');

      expect(url).toMatch(/^https:\/\/libertasian\.com\//);
      expect(url).toContain('/test-bucket/audio/track.mp3');
      expect(url).toContain('X-Amz-Signature');
    });

    it('falls back to the internal endpoint when S3_PUBLIC_ENDPOINT is unset', async () => {
      const svc = await buildService(undefined);
      const url = await svc.getSignedUrl('audio/track.mp3');

      expect(url).toMatch(/^http:\/\/minio:9000\//);
      expect(url).toContain('/test-bucket/audio/track.mp3');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});

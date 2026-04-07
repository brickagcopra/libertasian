import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';

// Mock ESM modules before any imports that depend on them
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-uuid-1234'),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  HeadObjectCommand: jest.fn(),
}));

import { FeedMediaProcessor } from './feed-media.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { ClamavService } from '../uploads/clamav.service';
import { S3Service } from '../uploads/s3.service';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MEDIA_ID = 'media-1';
const JOB_ID = 'job-1';
const ORG_ID = 'org-1';
const USER_ID = 'user-1';

const mockMedia = {
  id: MEDIA_ID,
  ownerUserId: USER_ID,
  organizationId: ORG_ID,
  originalObjectKey: `feed-temp/${ORG_ID}/${USER_ID}/${MEDIA_ID}/raw.jpg`,
  mimeType: 'image/jpeg',
  originalFileSize: 500000,
  processingStatus: 'pending',
};

// Minimal valid JPEG buffer (1x1 pixel)
const VALID_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP///////////////////' +
    '//////////////////////////////////////2wBDAf////////' +
    '//////////////////////////////////////////////////////' +
    'wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf' +
    '/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgA//Z',
  'base64',
);

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  feedPostMedia: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  feedMediaProcessingJob: {
    update: jest.fn(),
  },
};

const mockS3 = {
  get: jest.fn(),
  upload: jest.fn(),
  delete: jest.fn(),
};

const mockClamav = {
  scanBuffer: jest.fn(),
};

// Mock sharp module
jest.mock('sharp', () => {
  const sharpInstance = {
    metadata: jest.fn().mockResolvedValue({ width: 800, height: 600 }),
    rotate: jest.fn().mockReturnThis(),
    withMetadata: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.alloc(100)),
  };
  const sharpFn = jest.fn().mockReturnValue(sharpInstance);
  (sharpFn as unknown as Record<string, unknown>)['cache'] = jest.fn();
  return { default: sharpFn, __esModule: true };
});

function createMockJob(): Job<{ mediaId: string; jobId: string }> {
  return {
    data: { mediaId: MEDIA_ID, jobId: JOB_ID },
  } as Job<{ mediaId: string; jobId: string }>;
}

describe('FeedMediaProcessor', () => {
  let processor: FeedMediaProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedMediaProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: S3Service, useValue: mockS3 },
        { provide: ClamavService, useValue: mockClamav },
      ],
    }).compile();

    processor = module.get<FeedMediaProcessor>(FeedMediaProcessor);
    jest.clearAllMocks();
  });

  it('should process a clean image successfully', async () => {
    mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);
    mockS3.get.mockResolvedValue(VALID_JPEG);
    mockClamav.scanBuffer.mockResolvedValue({ clean: true });
    mockPrisma.feedPostMedia.update.mockResolvedValue({});
    mockPrisma.feedMediaProcessingJob.update.mockResolvedValue({});

    await processor.process(createMockJob());

    // Verify ClamAV was called
    expect(mockClamav.scanBuffer).toHaveBeenCalledWith(VALID_JPEG, `feed-media-${MEDIA_ID}`);

    // Verify processed + thumbnail uploaded
    expect(mockS3.upload).toHaveBeenCalledTimes(2);
    expect(mockS3.upload).toHaveBeenCalledWith(
      `feed/${ORG_ID}/${MEDIA_ID}/feed.jpg`,
      expect.any(Buffer),
      'image/jpeg',
      'feed.jpg',
    );
    expect(mockS3.upload).toHaveBeenCalledWith(
      `feed/${ORG_ID}/${MEDIA_ID}/thumb.jpg`,
      expect.any(Buffer),
      'image/jpeg',
      'thumb.jpg',
    );

    // Verify temp deleted
    expect(mockS3.delete).toHaveBeenCalledWith(mockMedia.originalObjectKey);

    // Verify DB updated to ready
    expect(mockPrisma.feedPostMedia.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MEDIA_ID },
        data: expect.objectContaining({
          processingStatus: 'ready',
          processedObjectKey: `feed/${ORG_ID}/${MEDIA_ID}/feed.jpg`,
          thumbnailObjectKey: `feed/${ORG_ID}/${MEDIA_ID}/thumb.jpg`,
        }),
      }),
    );
  });

  it('should quarantine malware-infected files', async () => {
    mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);
    mockS3.get.mockResolvedValue(VALID_JPEG);
    mockClamav.scanBuffer.mockResolvedValue({ clean: false, virus: 'Eicar-Test-Signature' });
    mockPrisma.feedPostMedia.update.mockResolvedValue({});
    mockPrisma.feedMediaProcessingJob.update.mockResolvedValue({});

    await processor.process(createMockJob());

    // Should move to quarantine
    expect(mockS3.upload).toHaveBeenCalledWith(
      expect.stringContaining('feed-quarantine/'),
      VALID_JPEG,
      'image/jpeg',
      'quarantined',
    );

    // Should delete original
    expect(mockS3.delete).toHaveBeenCalledWith(mockMedia.originalObjectKey);

    // Should mark as quarantined
    expect(mockPrisma.feedPostMedia.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MEDIA_ID },
        data: expect.objectContaining({
          processingStatus: 'quarantined',
          failureReason: expect.stringContaining('Eicar-Test-Signature'),
        }),
      }),
    );
  });

  it('should handle processing failure gracefully', async () => {
    mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);
    mockS3.get.mockRejectedValue(new Error('S3 connection failed'));
    mockPrisma.feedPostMedia.update.mockResolvedValue({});
    mockPrisma.feedMediaProcessingJob.update.mockResolvedValue({});

    await expect(processor.process(createMockJob())).rejects.toThrow('S3 connection failed');

    // Should mark as failed
    expect(mockPrisma.feedPostMedia.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MEDIA_ID },
        data: expect.objectContaining({
          processingStatus: 'failed',
          failureReason: 'S3 connection failed',
        }),
      }),
    );
  });
});

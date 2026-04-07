import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

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

import { FeedMediaService } from './feed-media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../uploads/s3.service';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const ORG_ID = 'org-1';
const MEDIA_ID = 'media-1';

const mockMedia = {
  id: MEDIA_ID,
  ownerUserId: USER_ID,
  organizationId: ORG_ID,
  originalObjectKey: `feed-temp/${ORG_ID}/${USER_ID}/${MEDIA_ID}/raw.jpg`,
  processedObjectKey: `feed/${ORG_ID}/${MEDIA_ID}/feed.jpg`,
  thumbnailObjectKey: `feed/${ORG_ID}/${MEDIA_ID}/thumb.jpg`,
  mimeType: 'image/jpeg',
  originalFileSize: 500000,
  processedFileSize: 200000,
  width: 1080,
  height: 720,
  sha256Checksum: 'abc123',
  processingStatus: 'ready',
  moderationStatus: 'unreviewed',
  failureReason: null,
};

// 1x1 pixel JPEG for magic byte validation
const JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockPrisma = {
  feedPostMedia: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  feedMediaProcessingJob: {
    create: jest.fn(),
  },
  feedPost: {
    findUnique: jest.fn(),
  },
};

const mockS3 = {
  upload: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
  computeChecksum: jest.fn().mockReturnValue('abc123def456'),
};

const mockQueue = {
  add: jest.fn(),
};

// Mock file-type module
jest.mock('file-type', () => ({
  fromBuffer: jest.fn(),
}));

import { fromBuffer } from 'file-type';
const mockFileType = fromBuffer as jest.Mock;

describe('FeedMediaService', () => {
  let service: FeedMediaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedMediaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: S3Service, useValue: mockS3 },
        { provide: getQueueToken('feed-media'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<FeedMediaService>(FeedMediaService);
    jest.clearAllMocks();
  });

  // ─── Upload ───────────────────────────────────────────────────────────────

  describe('initiateUpload', () => {
    const validFile = {
      buffer: JPEG_HEADER,
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 500000,
    };

    it('should reject files exceeding 20MB', async () => {
      await expect(
        service.initiateUpload(
          { ...validFile, size: 25 * 1024 * 1024 },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject disallowed MIME types', async () => {
      await expect(
        service.initiateUpload(
          { ...validFile, mimetype: 'image/svg+xml' },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when magic bytes do not match an allowed type', async () => {
      mockFileType.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' });

      await expect(
        service.initiateUpload(validFile, USER_ID, ORG_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when declared MIME does not match detected MIME', async () => {
      mockFileType.mockResolvedValue({ mime: 'image/png', ext: 'png' });

      await expect(
        service.initiateUpload(validFile, USER_ID, ORG_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully upload and enqueue processing job', async () => {
      mockFileType.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
      mockPrisma.feedPostMedia.create.mockResolvedValue({
        id: MEDIA_ID,
        processingStatus: 'pending',
      });
      mockPrisma.feedMediaProcessingJob.create.mockResolvedValue({
        id: 'job-1',
      });

      const result = await service.initiateUpload(validFile, USER_ID, ORG_ID);

      expect(result.mediaId).toBe(MEDIA_ID);
      expect(result.processingStatus).toBe('pending');
      expect(mockS3.upload).toHaveBeenCalledTimes(1);
      expect(mockS3.computeChecksum).toHaveBeenCalledWith(JPEG_HEADER);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-feed-media',
        { mediaId: MEDIA_ID, jobId: 'job-1' },
      );
    });
  });

  // ─── Get Status ───────────────────────────────────────────────────────────

  describe('getMediaStatus', () => {
    it('should return status for owned media', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);

      const result = await service.getMediaStatus(MEDIA_ID, USER_ID);

      expect(result.processingStatus).toBe('ready');
      expect(result.processedObjectKey).toBe(mockMedia.processedObjectKey);
    });

    it('should reject access to other user\'s media', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);

      await expect(
        service.getMediaStatus(MEDIA_ID, OTHER_USER_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Delete Media ─────────────────────────────────────────────────────────

  describe('deleteMedia', () => {
    it('should delete unattached media', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);
      mockPrisma.feedPost.findUnique.mockResolvedValue(null); // not attached

      await service.deleteMedia(MEDIA_ID, USER_ID);

      expect(mockS3.delete).toHaveBeenCalledTimes(3); // original + processed + thumb
      expect(mockPrisma.feedPostMedia.delete).toHaveBeenCalledWith({ where: { id: MEDIA_ID } });
    });

    it('should reject deleting media attached to a post', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);
      mockPrisma.feedPost.findUnique.mockResolvedValue({ id: 'post-1' });

      await expect(
        service.deleteMedia(MEDIA_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject deleting other user\'s media', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);

      await expect(
        service.deleteMedia(MEDIA_ID, OTHER_USER_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { DigestsService } from '../digests/digests.service';
import { S3Service } from './s3.service';
import { UploadsService } from './uploads.service';

// Mock uuid (ESM-only package, cannot be transformed by ts-jest)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

// Mock file-type (CJS require)
jest.mock('file-type', () => ({
  fromBuffer: jest.fn(),
}));

describe('UploadsService', () => {
  let service: UploadsService;
  let prisma: jest.Mocked<PrismaService>;
  let s3: jest.Mocked<S3Service>;
  let digestsService: jest.Mocked<DigestsService>;
  let queue: { add: jest.Mock };

  const orgId = 'org-1';
  const userId = 'user-1';

  const mockUpload = {
    id: 'upload-1',
    organizationId: orgId,
    userId,
    uploadType: 'document',
    originalFilename: 'test.pdf',
    mimeType: 'application/pdf',
    objectKey: 'uploads/org-1/user-1/uuid/test.pdf',
    checksum: 'abc123',
    pageCount: null,
    ocrStatus: 'pending',
    processingStatus: 'pending',
    privacyLevel: 'private',
    ocrTextObjectKey: null,
    classifiedDocumentType: null,
    extractedCitationsJson: null,
    digestId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockJob = {
    id: 'job-1',
    userUploadId: 'upload-1',
    jobType: 'process_upload',
    status: 'pending',
    attempts: 0,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Reset file-type mock before each test
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fileType = require('file-type');
    fileType.fromBuffer.mockReset();

    queue = { add: jest.fn().mockResolvedValue({ id: 'bull-job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        {
          provide: PrismaService,
          useValue: {
            userUpload: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            uploadProcessingJob: {
              create: jest.fn(),
            },
            cameraCapture: {
              create: jest.fn(),
            },
            matter: {
              findFirst: jest.fn(),
            },
            matterDocument: {
              findFirst: jest.fn(),
              create: jest.fn(),
            },
            flashcardSet: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            flashcard: {
              create: jest.fn(),
              aggregate: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: S3Service,
          useValue: {
            generateObjectKey: jest.fn().mockReturnValue('uploads/org-1/user-1/uuid/test.pdf'),
            computeChecksum: jest.fn().mockReturnValue('abc123'),
            upload: jest.fn().mockResolvedValue(undefined),
            delete: jest.fn().mockResolvedValue(undefined),
            get: jest.fn(),
          },
        },
        {
          provide: DigestsService,
          useValue: {
            create: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:8000'),
          },
        },
        {
          provide: getQueueToken('uploads'),
          useValue: queue,
        },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
    prisma = module.get(PrismaService);
    s3 = module.get(S3Service);
    digestsService = module.get(DigestsService);
  });

  // Helper: create a mock multer file
  function makeMockFile(
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File {
    return {
      buffer: Buffer.from('fake-content'),
      originalname: 'test.pdf',
      mimetype: 'application/pdf',
      size: 1024,
      fieldname: 'file',
      encoding: '7bit',
      stream: null as unknown as import('stream').Readable,
      destination: '',
      filename: '',
      path: '',
      ...overrides,
    };
  }

  function mockFileType(mime: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fileType = require('file-type');
    fileType.fromBuffer.mockResolvedValue({ mime, ext: mime.split('/')[1] });
  }

  function mockFileTypeNull() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fileType = require('file-type');
    fileType.fromBuffer.mockResolvedValue(undefined);
  }

  // ---- uploadFile ----

  describe('uploadFile', () => {
    it('should upload file and return pending status', async () => {
      mockFileType('application/pdf');
      (prisma.userUpload.create as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.uploadProcessingJob.create as jest.Mock).mockResolvedValue(mockJob);

      const result = await service.uploadFile(makeMockFile(), orgId, userId);

      expect(result).toEqual({
        id: 'upload-1',
        jobId: 'job-1',
        status: 'pending',
      });
      expect(s3.upload).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith(
        'process-upload',
        { uploadId: 'upload-1', jobId: 'job-1' },
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('should reject when MIME type cannot be detected', async () => {
      mockFileTypeNull();

      await expect(
        service.uploadFile(makeMockFile(), orgId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject disallowed MIME types', async () => {
      mockFileType('application/zip');

      await expect(
        service.uploadFile(makeMockFile(), orgId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject files exceeding size limit', async () => {
      mockFileType('image/jpeg');
      const oversized = Buffer.alloc(21 * 1024 * 1024); // 21MB > 20MB limit

      await expect(
        service.uploadFile(
          makeMockFile({ buffer: oversized }),
          orgId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject null-byte filenames', async () => {
      mockFileType('application/pdf');

      await expect(
        service.uploadFile(
          makeMockFile({ originalname: 'file\0.pdf' }),
          orgId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject empty filenames', async () => {
      mockFileType('application/pdf');

      await expect(
        service.uploadFile(
          makeMockFile({ originalname: '' }),
          orgId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should default privacy level to private', async () => {
      mockFileType('application/pdf');
      (prisma.userUpload.create as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.uploadProcessingJob.create as jest.Mock).mockResolvedValue(mockJob);

      await service.uploadFile(makeMockFile(), orgId, userId);

      expect(prisma.userUpload.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ privacyLevel: 'private' }),
        }),
      );
    });

    it('should accept custom privacy level', async () => {
      mockFileType('application/pdf');
      (prisma.userUpload.create as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.uploadProcessingJob.create as jest.Mock).mockResolvedValue(mockJob);

      await service.uploadFile(makeMockFile(), orgId, userId, 'editorial_candidate');

      expect(prisma.userUpload.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ privacyLevel: 'editorial_candidate' }),
        }),
      );
    });
  });

  // ---- uploadCameraScan ----

  describe('uploadCameraScan', () => {
    it('should upload multi-page camera scan', async () => {
      mockFileType('image/jpeg');
      (prisma.userUpload.create as jest.Mock).mockResolvedValue({
        ...mockUpload,
        uploadType: 'camera_scan',
        pageCount: 3,
      });
      (prisma.cameraCapture.create as jest.Mock).mockResolvedValue({ id: 'cap-1' });
      (prisma.uploadProcessingJob.create as jest.Mock).mockResolvedValue(mockJob);

      const files = [
        makeMockFile({ originalname: 'page1.jpg' }),
        makeMockFile({ originalname: 'page2.jpg' }),
        makeMockFile({ originalname: 'page3.jpg' }),
      ];

      const result = await service.uploadCameraScan(files, orgId, userId, {
        devicePlatform: 'android',
        captureMode: 'multi_page',
      });

      expect(result.status).toBe('pending');
      expect(s3.upload).toHaveBeenCalledTimes(3); // all 3 pages
      expect(prisma.cameraCapture.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            imageCount: 3,
            captureMode: 'multi_page',
            devicePlatform: 'android',
          }),
        }),
      );
    });

    it('should reject empty file array', async () => {
      mockFileType('image/jpeg');

      await expect(
        service.uploadCameraScan([], orgId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject non-image files for camera scan', async () => {
      mockFileType('application/pdf');

      await expect(
        service.uploadCameraScan(
          [makeMockFile({ originalname: 'scan.pdf' })],
          orgId,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should default privacy to private (per CLAUDE.md)', async () => {
      mockFileType('image/jpeg');
      (prisma.userUpload.create as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.cameraCapture.create as jest.Mock).mockResolvedValue({ id: 'cap-1' });
      (prisma.uploadProcessingJob.create as jest.Mock).mockResolvedValue(mockJob);

      await service.uploadCameraScan(
        [makeMockFile({ originalname: 'scan.jpg' })],
        orgId,
        userId,
      );

      expect(prisma.userUpload.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ privacyLevel: 'private' }),
        }),
      );
    });

    it('should default captureMode to single_page', async () => {
      mockFileType('image/jpeg');
      (prisma.userUpload.create as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.cameraCapture.create as jest.Mock).mockResolvedValue({ id: 'cap-1' });
      (prisma.uploadProcessingJob.create as jest.Mock).mockResolvedValue(mockJob);

      await service.uploadCameraScan(
        [makeMockFile({ originalname: 'scan.jpg' })],
        orgId,
        userId,
      );

      expect(prisma.cameraCapture.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ captureMode: 'single_page' }),
        }),
      );
    });
  });

  // ---- list ----

  describe('list', () => {
    it('should return paginated uploads', async () => {
      const uploads = Array.from({ length: 21 }, (_, i) => ({
        id: `upload-${i}`,
        uploadType: 'document',
        originalFilename: `file${i}.pdf`,
        mimeType: 'application/pdf',
        processingStatus: 'completed',
        privacyLevel: 'private',
        pageCount: null,
        createdAt: new Date(),
      }));
      (prisma.userUpload.findMany as jest.Mock).mockResolvedValue(uploads);

      const result = await service.list(orgId);

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('upload-19');
    });

    it('should apply uploadType filter', async () => {
      (prisma.userUpload.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(orgId, { uploadType: 'camera_scan' });

      expect(prisma.userUpload.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ uploadType: 'camera_scan' }),
        }),
      );
    });

    it('should apply processingStatus filter', async () => {
      (prisma.userUpload.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(orgId, { processingStatus: 'completed' });

      expect(prisma.userUpload.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ processingStatus: 'completed' }),
        }),
      );
    });

    it('should scope to organization', async () => {
      (prisma.userUpload.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(orgId);

      expect(prisma.userUpload.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: orgId }),
        }),
      );
    });
  });

  // ---- findById ----

  describe('findById', () => {
    it('should return upload with related data', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        ...mockUpload,
        cameraCaptures: [],
        processingJobs: [],
      });

      const result = await service.findById('upload-1', orgId);

      expect(result.id).toBe('upload-1');
      expect(prisma.userUpload.findFirst).toHaveBeenCalledWith({
        where: { id: 'upload-1', organizationId: orgId },
        include: expect.objectContaining({
          cameraCaptures: true,
          processingJobs: expect.any(Object),
        }),
      });
    });

    it('should throw NotFoundException when upload not found', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('nonexistent', orgId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- getStatus ----

  describe('getStatus', () => {
    it('should return processing status', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        id: 'upload-1',
        processingStatus: 'completed',
        ocrStatus: 'completed',
        processingJobs: [{ ...mockJob, status: 'completed' }],
      });

      const result = await service.getStatus('upload-1', orgId);

      expect(result.processingStatus).toBe('completed');
      expect(result.ocrStatus).toBe('completed');
    });

    it('should throw NotFoundException when not found', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getStatus('missing', orgId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('should delete from S3 and DB', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.userUpload.delete as jest.Mock).mockResolvedValue(mockUpload);

      await service.delete('upload-1', orgId);

      expect(s3.delete).toHaveBeenCalledWith(mockUpload.objectKey);
      expect(prisma.userUpload.delete).toHaveBeenCalledWith({
        where: { id: 'upload-1' },
      });
    });

    it('should still delete from DB if S3 fails', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(mockUpload);
      s3.delete.mockRejectedValue(new Error('S3 error'));
      (prisma.userUpload.delete as jest.Mock).mockResolvedValue(mockUpload);

      // Should not throw even though S3 failed
      await expect(service.delete('upload-1', orgId)).resolves.toBeUndefined();
      expect(prisma.userUpload.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException when upload not found', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.delete('missing', orgId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- updatePrivacy ----

  describe('updatePrivacy', () => {
    it('should update privacy level when user is uploader', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.userUpload.update as jest.Mock).mockResolvedValue({
        id: 'upload-1',
        privacyLevel: 'editorial_candidate',
        createdAt: new Date(),
      });

      const result = await service.updatePrivacy(
        'upload-1',
        orgId,
        userId,
        'editorial_candidate',
      );

      expect(result.privacyLevel).toBe('editorial_candidate');
    });

    it('should throw ForbiddenException when non-uploader tries to change', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(mockUpload);

      await expect(
        service.updatePrivacy('upload-1', orgId, 'other-user', 'editorial_candidate'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when upload not found', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updatePrivacy('missing', orgId, userId, 'private'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- generateDigestFromUpload ----

  describe('generateDigestFromUpload', () => {
    const ocrCompleteUpload = {
      ...mockUpload,
      ocrStatus: 'completed',
      ocrTextObjectKey: 'ocr/upload-1/text.txt',
      digestId: null,
      ocrResults: [],
    };

    it('should create digest and enqueue job', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(ocrCompleteUpload);
      s3.get.mockResolvedValue(Buffer.from('A'.repeat(100)));
      digestsService.create.mockResolvedValue({
        id: 'digest-1',
        title: 'Scan Digest: test.pdf',
      } as never);
      (prisma.userUpload.update as jest.Mock).mockResolvedValue({});

      const result = await service.generateDigestFromUpload(
        'upload-1',
        orgId,
        userId,
      );

      expect(result.digestId).toBe('digest-1');
      expect(result.status).toBe('draft');
      expect(digestsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceOrigin: 'camera_capture',
          visibility: 'private', // Per CLAUDE.md
        }),
        userId,
        orgId,
      );
      expect(queue.add).toHaveBeenCalledWith(
        'generate-upload-digest',
        expect.objectContaining({ digestId: 'digest-1' }),
      );
    });

    it('should reject when OCR not completed', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        ...ocrCompleteUpload,
        ocrStatus: 'pending',
      });

      await expect(
        service.generateDigestFromUpload('upload-1', orgId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when digest already exists', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        ...ocrCompleteUpload,
        digestId: 'existing-digest',
      });

      await expect(
        service.generateDigestFromUpload('upload-1', orgId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when no OCR text key', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        ...ocrCompleteUpload,
        ocrTextObjectKey: null,
      });

      await expect(
        service.generateDigestFromUpload('upload-1', orgId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when OCR text is too short', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(ocrCompleteUpload);
      s3.get.mockResolvedValue(Buffer.from('Short'));

      await expect(
        service.generateDigestFromUpload('upload-1', orgId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for missing upload', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.generateDigestFromUpload('missing', orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- attachToMatter ----

  describe('attachToMatter', () => {
    it('should create matter document junction record', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue({
        id: 'matter-1',
        organizationId: orgId,
      });
      (prisma.matterDocument.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.matterDocument.create as jest.Mock).mockResolvedValue({
        id: 'md-1',
        matterId: 'matter-1',
        userUploadId: 'upload-1',
        title: 'test.pdf',
        role: 'reference',
        createdAt: new Date(),
      });

      const result = await service.attachToMatter(
        'upload-1',
        orgId,
        userId,
        'matter-1',
      );

      expect(result.matterId).toBe('matter-1');
      expect(result.role).toBe('reference');
    });

    it('should use upload filename as default title', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue({
        id: 'matter-1',
        organizationId: orgId,
      });
      (prisma.matterDocument.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.matterDocument.create as jest.Mock).mockResolvedValue({
        id: 'md-1',
        title: 'test.pdf',
      });

      await service.attachToMatter('upload-1', orgId, userId, 'matter-1');

      expect(prisma.matterDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'test.pdf' }),
        }),
      );
    });

    it('should throw NotFoundException when upload not found', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.attachToMatter('missing', orgId, userId, 'matter-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when matter not found', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.attachToMatter('upload-1', orgId, userId, 'missing-matter'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when already attached', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(mockUpload);
      (prisma.matter.findFirst as jest.Mock).mockResolvedValue({
        id: 'matter-1',
        organizationId: orgId,
      });
      (prisma.matterDocument.findFirst as jest.Mock).mockResolvedValue({
        id: 'md-existing',
      });

      await expect(
        service.attachToMatter('upload-1', orgId, userId, 'matter-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---- getOcrResults ----

  describe('getOcrResults', () => {
    it('should return OCR results with text', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        id: 'upload-1',
        ocrStatus: 'completed',
        ocrTextObjectKey: 'ocr/text.txt',
        classifiedDocumentType: 'supreme_court',
        extractedCitationsJson: [{ text: 'G.R. No. 123456' }],
        ocrResults: [
          { id: 'ocr-1', pageNumber: 1, qualityScore: 0.85, ocrConfidence: 0.92 },
        ],
      });
      s3.get.mockResolvedValue(Buffer.from('Sample OCR text'));

      const result = await service.getOcrResults('upload-1', orgId);

      expect(result.uploadId).toBe('upload-1');
      expect(result.ocrText).toBe('Sample OCR text');
      expect(result.classifiedDocumentType).toBe('supreme_court');
      expect(result.pages).toHaveLength(1);
    });

    it('should return null ocrText when no key', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        id: 'upload-1',
        ocrStatus: 'pending',
        ocrTextObjectKey: null,
        classifiedDocumentType: null,
        extractedCitationsJson: null,
        ocrResults: [],
      });

      const result = await service.getOcrResults('upload-1', orgId);

      expect(result.ocrText).toBeNull();
    });

    it('should handle S3 fetch failure gracefully', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        id: 'upload-1',
        ocrStatus: 'completed',
        ocrTextObjectKey: 'ocr/text.txt',
        classifiedDocumentType: null,
        extractedCitationsJson: null,
        ocrResults: [],
      });
      s3.get.mockRejectedValue(new Error('S3 error'));

      const result = await service.getOcrResults('upload-1', orgId);

      expect(result.ocrText).toBeNull();
    });

    it('should throw NotFoundException when upload not found', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getOcrResults('missing', orgId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- generateFlashcardsFromUpload ----

  describe('generateFlashcardsFromUpload', () => {
    const ocrUpload = {
      ...mockUpload,
      ocrStatus: 'completed',
      ocrTextObjectKey: 'ocr/text.txt',
    };

    const mockFlashcardSet = {
      id: 'set-1',
      userId,
      cardCount: 5,
    };

    beforeEach(() => {
      // Mock global fetch for RAG service calls
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          flashcards: [
            { front: 'Q1', back: 'A1', source_document_id: null, source_section_id: null, difficulty: 'medium' },
            { front: 'Q2', back: 'A2', source_document_id: null, source_section_id: null, difficulty: 'easy' },
          ],
          total_generated: 2,
          topic: 'Test',
          card_type: 'mixed',
          confidence_score: 0.8,
          model_name: 'test-model',
          prompt_template_version: 'v1',
        }),
      }) as jest.Mock;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should reject when OCR not completed', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        ...ocrUpload,
        ocrStatus: 'pending',
      });

      await expect(
        service.generateFlashcardsFromUpload('upload-1', orgId, userId, 'set-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when flashcard set not found', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(ocrUpload);
      s3.get.mockResolvedValue(Buffer.from('A'.repeat(100)));
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.generateFlashcardsFromUpload('upload-1', orgId, userId, 'set-missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject when user does not own flashcard set', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(ocrUpload);
      s3.get.mockResolvedValue(Buffer.from('A'.repeat(100)));
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlashcardSet,
        userId: 'other-user',
      });

      await expect(
        service.generateFlashcardsFromUpload('upload-1', orgId, userId, 'set-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject insufficient OCR text', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(ocrUpload);
      s3.get.mockResolvedValue(Buffer.from('Short'));
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValue(mockFlashcardSet);

      await expect(
        service.generateFlashcardsFromUpload('upload-1', orgId, userId, 'set-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---- generateOutlineFromUpload ----

  describe('generateOutlineFromUpload', () => {
    const ocrUpload = {
      ...mockUpload,
      ocrStatus: 'completed',
      ocrTextObjectKey: 'ocr/text.txt',
    };

    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          outline: {
            title: 'Test Outline',
            sections: [
              { heading: 'Section 1', key_points: ['Point A'] },
            ],
          },
          confidence_score: 0.9,
          model_name: 'test-model',
          prompt_template_version: 'v1',
        }),
      }) as jest.Mock;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should reject when OCR not completed', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        ...ocrUpload,
        ocrStatus: 'processing',
      });

      await expect(
        service.generateOutlineFromUpload('upload-1', orgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when no OCR text key', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue({
        ...ocrUpload,
        ocrTextObjectKey: null,
      });

      await expect(
        service.generateOutlineFromUpload('upload-1', orgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject insufficient text', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(ocrUpload);
      s3.get.mockResolvedValue(Buffer.from('Hi'));

      await expect(
        service.generateOutlineFromUpload('upload-1', orgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for missing upload', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.generateOutlineFromUpload('missing', orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return outline result on success', async () => {
      (prisma.userUpload.findFirst as jest.Mock).mockResolvedValue(ocrUpload);
      s3.get.mockResolvedValue(Buffer.from('A'.repeat(100)));

      const result = await service.generateOutlineFromUpload('upload-1', orgId);

      expect(result.uploadId).toBe('upload-1');
      expect(result.outline).toBeDefined();
      expect(result.outline.title).toBe('Test Outline');
      expect(result.confidenceScore).toBe(0.9);
    });
  });
});

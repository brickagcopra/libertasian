import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import sharp from 'sharp';
import { AppModule } from '../../src/app.module';
import { AppThrottlerGuard } from '../../src/common/guards/app-throttler.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UploadsProcessor } from '../../src/modules/uploads/uploads.processor';
import { OcrClientService } from '../../src/modules/uploads/ocr-client.service';
import { ClamavService } from '../../src/modules/uploads/clamav.service';
import { S3Service } from '../../src/modules/uploads/s3.service';
import { UserUploadSearchService } from '../../src/modules/uploads/user-upload-search.service';
import {
  mockQualityScore,
  mockQualityScoreReject,
  mockQualityScoreWarn,
  mockOcrExtract,
  mockClassification,
  mockCitationExtraction,
  mockClamavClean,
  mockClamavInfected,
} from './helpers/mock-services';
import { createUploadJob } from './helpers/job-factory';

/**
 * Ingestion Pipeline — Integration Tests (Phase 3)
 *
 * Tests the full upload processing pipeline via UploadsProcessor:
 * Upload -> ClamAV -> Quality Score -> OCR -> Classification -> Citations -> DB + Search Index
 *
 * Mocks at service boundary: OcrClientService, ClamavService, S3Service, UserUploadSearchService
 * Real: PrismaService (PostgreSQL)
 */
describe('Ingestion Pipeline — Integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: UploadsProcessor;
  let ocrClient: OcrClientService;
  let clamav: ClamavService;
  let s3: S3Service;
  let uploadSearch: UserUploadSearchService;
  // uploads.processor.ts:375 runs sharp(buffer).toBuffer() on every
  // camera_scan upload to strip EXIF. Sharp rejects arbitrary strings
  // like Buffer.from('fake-image-data') with "Input buffer contains
  // unsupported image format". Generate a real tiny JPEG once and
  // reuse it across all success-path tests.
  let jpegBuffer: Buffer;

  beforeAll(async () => {
    jest.spyOn(AppThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);

    // Generate a real 1×1 JPEG once so sharp(buffer).toBuffer() in
    // uploads.processor.ts:375 (processImage) does not reject with
    // "Input buffer contains unsupported image format".
    jpegBuffer = await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    processor = app.get(UploadsProcessor);
    ocrClient = app.get(OcrClientService);
    clamav = app.get(ClamavService);
    s3 = app.get(S3Service);
    uploadSearch = app.get(UserUploadSearchService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  async function createTestUpload(
    overrides?: Partial<{
      uploadType: string;
      mimeType: string;
      organizationId: string;
      userId: string;
    }>,
  ) {
    // Create test org + user first
    const org = await prisma.organization.create({
      data: { name: `Test Org ${Date.now()}`, slug: `test-org-${Date.now()}` },
    });
    const user = await prisma.user.create({
      data: {
        email: `pipeline-test-${Date.now()}@test.com`,
        passwordHash: '$2b$12$placeholder',
        fullName: 'Pipeline Test User',
      },
    });
    await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: 'owner' },
    });

    const upload = await prisma.userUpload.create({
      data: {
        organizationId: overrides?.organizationId ?? org.id,
        userId: overrides?.userId ?? user.id,
        uploadType: overrides?.uploadType ?? 'camera_scan',
        originalFilename: 'test-scan.jpg',
        mimeType: overrides?.mimeType ?? 'image/jpeg',
        objectKey: `uploads/${org.id}/${user.id}/test-${Date.now()}.jpg`,
        processingStatus: 'pending',
        ocrStatus: 'pending',
        privacyLevel: 'private',
      },
    });

    const job = await prisma.uploadProcessingJob.create({
      data: {
        userUploadId: upload.id,
        jobType: 'process',
        status: 'pending',
      },
    });

    return { org, user, upload, job };
  }

  function setupMocksForSuccess() {
    // Use the real JPEG so processImage() in uploads.processor.ts:375
    // can actually run sharp(buffer).toBuffer() without throwing.
    jest.spyOn(s3, 'get').mockResolvedValue(jpegBuffer);
    jest.spyOn(s3, 'upload').mockResolvedValue(undefined);
    jest.spyOn(s3, 'delete').mockResolvedValue(undefined);
    jest.spyOn(clamav, 'scanBuffer').mockResolvedValue(mockClamavClean());
    jest.spyOn(ocrClient, 'scoreQuality').mockResolvedValue(mockQualityScore());
    jest.spyOn(ocrClient, 'extractText').mockResolvedValue(mockOcrExtract());
    jest.spyOn(ocrClient, 'classifyDocument').mockResolvedValue(mockClassification());
    jest.spyOn(ocrClient, 'extractCitations').mockResolvedValue(mockCitationExtraction());
    jest.spyOn(uploadSearch, 'indexUpload').mockResolvedValue(undefined);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Successful Processing ──────────────────────────────────────────────

  describe('Successful camera scan processing', () => {
    it('should process upload through full pipeline: ClamAV -> Quality -> OCR -> Classify -> Citations -> DB', async () => {
      const { upload, job } = await createTestUpload();
      setupMocksForSuccess();

      const mockJob = createUploadJob(upload.id, job.id);
      await processor.process(mockJob);

      // Verify upload status
      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.processingStatus).toBe('completed');
      expect(updatedUpload?.ocrStatus).toBe('completed');
      expect(updatedUpload?.classifiedDocumentType).toBe('case_decision');
      expect(updatedUpload?.ocrTextObjectKey).toBeTruthy();

      // Verify citations stored
      expect(updatedUpload?.extractedCitationsJson).toEqual({
        citations: ['G.R. No. 123456', 'G.R. No. 789012'],
        normalized: ['G.R. No. 123456', 'G.R. No. 789012'],
      });

      // Verify OCR result record created
      const ocrResults = await prisma.ocrResult.findMany({ where: { userUploadId: upload.id } });
      expect(ocrResults.length).toBeGreaterThanOrEqual(1);
      expect(ocrResults[0]?.qualityScore).toBe(0.85);
      expect(ocrResults[0]?.ocrConfidence).toBe(0.92);

      // Verify job status
      const updatedJob = await prisma.uploadProcessingJob.findUnique({ where: { id: job.id } });
      expect(updatedJob?.status).toBe('completed');

      // Verify search indexing was called
      expect(uploadSearch.indexUpload).toHaveBeenCalledWith(upload.id);
    });

    it('should call services in correct order', async () => {
      const { upload, job } = await createTestUpload();
      const callOrder: string[] = [];

      jest.spyOn(s3, 'get').mockImplementation(async () => {
        callOrder.push('s3.get');
        // Real JPEG — sharp rejects arbitrary strings (uploads.processor.ts:375).
        return jpegBuffer;
      });
      jest.spyOn(s3, 'upload').mockImplementation(async () => {
        callOrder.push('s3.upload');
      });
      jest.spyOn(clamav, 'scanBuffer').mockImplementation(async () => {
        callOrder.push('clamav.scan');
        return mockClamavClean();
      });
      jest.spyOn(ocrClient, 'scoreQuality').mockImplementation(async () => {
        callOrder.push('ocr.quality');
        return mockQualityScore();
      });
      jest.spyOn(ocrClient, 'extractText').mockImplementation(async () => {
        callOrder.push('ocr.extract');
        return mockOcrExtract();
      });
      jest.spyOn(ocrClient, 'classifyDocument').mockImplementation(async () => {
        callOrder.push('ocr.classify');
        return mockClassification();
      });
      jest.spyOn(ocrClient, 'extractCitations').mockImplementation(async () => {
        callOrder.push('ocr.citations');
        return mockCitationExtraction();
      });
      jest.spyOn(uploadSearch, 'indexUpload').mockImplementation(async () => {
        callOrder.push('search.index');
      });

      await processor.process(createUploadJob(upload.id, job.id));

      // ClamAV must come before OCR
      expect(callOrder.indexOf('clamav.scan')).toBeLessThan(callOrder.indexOf('ocr.quality'));
      // Quality must come before extraction
      expect(callOrder.indexOf('ocr.quality')).toBeLessThan(callOrder.indexOf('ocr.extract'));
      // Search indexing comes last
      expect(callOrder.indexOf('search.index')).toBe(callOrder.length - 1);
    });
  });

  // ── ClamAV Failure ─────────────────────────────────────────────────────

  describe('ClamAV malware detection', () => {
    it('should quarantine upload when malware is detected', async () => {
      const { upload, job } = await createTestUpload();

      // Real JPEG so the processor gets past the sharp EXIF-strip step
      // in uploads.processor.ts:375 and actually reaches clamav.scanBuffer.
      jest.spyOn(s3, 'get').mockResolvedValue(jpegBuffer);
      jest.spyOn(s3, 'delete').mockResolvedValue(undefined);
      jest.spyOn(clamav, 'scanBuffer').mockResolvedValue(mockClamavInfected('EICAR-Test'));
      // Spy on extractText so the `not.toHaveBeenCalled()` assertion
      // below has a spy/mock to interrogate. Without this, Jest raises
      // "received value must be a mock or spy function" before the
      // quarantine short-circuit can be verified.
      const extractTextSpy = jest.spyOn(ocrClient, 'extractText');

      await processor.process(createUploadJob(upload.id, job.id));

      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.processingStatus).toBe('quarantined');

      const updatedJob = await prisma.uploadProcessingJob.findUnique({ where: { id: job.id } });
      expect(updatedJob?.status).toBe('failed');
      expect(updatedJob?.errorMessage).toContain('Malware detected');

      // Infected file should be deleted from S3
      expect(s3.delete).toHaveBeenCalledWith(upload.objectKey);

      // OCR should NOT have been called
      expect(extractTextSpy).not.toHaveBeenCalled();
    });
  });

  // ── Quality Rejection ──────────────────────────────────────────────────

  describe('Quality score thresholds', () => {
    it('should reject upload when quality < 0.2', async () => {
      const { upload, job } = await createTestUpload();

      // Real JPEG — processImage() (uploads.processor.ts:375) runs sharp
      // before the quality score, so arbitrary strings throw.
      jest.spyOn(s3, 'get').mockResolvedValue(jpegBuffer);
      jest.spyOn(s3, 'upload').mockResolvedValue(undefined);
      jest.spyOn(clamav, 'scanBuffer').mockResolvedValue(mockClamavClean());
      jest.spyOn(ocrClient, 'scoreQuality').mockResolvedValue(mockQualityScoreReject());
      // Spied (but never called) so the `.not.toHaveBeenCalled()`
      // short-circuit assertion below has a real mock to introspect.
      const extractTextSpy = jest.spyOn(ocrClient, 'extractText');
      jest.spyOn(uploadSearch, 'indexUpload').mockResolvedValue(undefined);

      // Quality reject is terminal: the processor throws
      // `UnrecoverableError` from the inner reject branch so the outer
      // process() catch finalises job/upload records as 'failed'
      // instead of the 'completed' cleanup path overwriting them.
      // BullMQ recognises UnrecoverableError as non-retryable.
      await expect(
        processor.process(createUploadJob(upload.id, job.id)),
      ).rejects.toThrow(/quality too low/i);

      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.ocrStatus).toBe('failed');
      expect(updatedUpload?.processingStatus).toBe('failed');

      // OCR extraction should NOT have been called (short-circuited)
      expect(extractTextSpy).not.toHaveBeenCalled();

      // Quality failure job should be recorded
      const qualityJobs = await prisma.uploadProcessingJob.findMany({
        where: { userUploadId: upload.id, jobType: 'quality_check' },
      });
      expect(qualityJobs.length).toBe(1);
      expect(qualityJobs[0]?.errorMessage).toContain('quality too low');
    });

    it('should process but log warning when quality between 0.2-0.4', async () => {
      const { upload, job } = await createTestUpload();
      setupMocksForSuccess();
      jest.spyOn(ocrClient, 'scoreQuality').mockResolvedValue(mockQualityScoreWarn());

      await processor.process(createUploadJob(upload.id, job.id));

      // Should still complete processing despite warning
      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.processingStatus).toBe('completed');
      expect(updatedUpload?.ocrStatus).toBe('completed');

      // Quality score should be the warn value
      const ocrResults = await prisma.ocrResult.findMany({ where: { userUploadId: upload.id } });
      expect(ocrResults[0]?.qualityScore).toBe(0.35);
    });
  });

  // ── OCR Service Failure ────────────────────────────────────────────────

  describe('OCR service failure handling', () => {
    it('should mark upload as failed when OCR extraction throws', async () => {
      const { upload, job } = await createTestUpload();

      // Real JPEG — sharp rejects the old 'fake-image' string at
      // uploads.processor.ts:375 before OCR extraction is reached.
      jest.spyOn(s3, 'get').mockResolvedValue(jpegBuffer);
      jest.spyOn(s3, 'upload').mockResolvedValue(undefined);
      jest.spyOn(clamav, 'scanBuffer').mockResolvedValue(mockClamavClean());
      jest.spyOn(ocrClient, 'scoreQuality').mockResolvedValue(mockQualityScore());
      jest.spyOn(ocrClient, 'extractText').mockRejectedValue(
        new Error('OCR service returned 500: Internal Server Error'),
      );

      await expect(
        processor.process(createUploadJob(upload.id, job.id)),
      ).rejects.toThrow('OCR service returned 500');

      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.ocrStatus).toBe('failed');

      const updatedJob = await prisma.uploadProcessingJob.findUnique({ where: { id: job.id } });
      expect(updatedJob?.status).toBe('failed');
    });

    it('should continue with default quality score if quality scoring fails', async () => {
      const { upload, job } = await createTestUpload();
      setupMocksForSuccess();
      jest.spyOn(ocrClient, 'scoreQuality').mockRejectedValue(
        new Error('Quality service timeout'),
      );

      await processor.process(createUploadJob(upload.id, job.id));

      // Should still complete with default quality score (0.5)
      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.processingStatus).toBe('completed');

      const ocrResults = await prisma.ocrResult.findMany({ where: { userUploadId: upload.id } });
      expect(ocrResults[0]?.qualityScore).toBe(0.5); // Default fallback
    });

    it('should continue if classification fails (non-blocking)', async () => {
      const { upload, job } = await createTestUpload();
      setupMocksForSuccess();
      jest.spyOn(ocrClient, 'classifyDocument').mockRejectedValue(
        new Error('Classification service unavailable'),
      );

      await processor.process(createUploadJob(upload.id, job.id));

      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.processingStatus).toBe('completed');
      expect(updatedUpload?.classifiedDocumentType).toBeNull();
    });

    it('should continue if citation extraction fails (non-blocking)', async () => {
      const { upload, job } = await createTestUpload();
      setupMocksForSuccess();
      jest.spyOn(ocrClient, 'extractCitations').mockRejectedValue(
        new Error('Citation service error'),
      );

      await processor.process(createUploadJob(upload.id, job.id));

      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.processingStatus).toBe('completed');
      // No citations stored since extraction failed
    });
  });

  // ── Search Indexing ────────────────────────────────────────────────────

  describe('Search indexing', () => {
    it('should attempt search indexing after successful processing', async () => {
      const { upload, job } = await createTestUpload();
      setupMocksForSuccess();

      await processor.process(createUploadJob(upload.id, job.id));

      expect(uploadSearch.indexUpload).toHaveBeenCalledWith(upload.id);
    });

    it('should not fail processing if search indexing fails (non-blocking)', async () => {
      const { upload, job } = await createTestUpload();
      setupMocksForSuccess();
      jest.spyOn(uploadSearch, 'indexUpload').mockRejectedValue(
        new Error('OpenSearch cluster unavailable'),
      );

      await processor.process(createUploadJob(upload.id, job.id));

      // Processing should still be marked as completed
      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.processingStatus).toBe('completed');
    });
  });

  // ── Privacy Defaults ───────────────────────────────────────────────────

  describe('Privacy defaults', () => {
    it('should preserve private privacy level for camera scans', async () => {
      const { upload, job } = await createTestUpload({ uploadType: 'camera_scan' });
      setupMocksForSuccess();

      await processor.process(createUploadJob(upload.id, job.id));

      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.privacyLevel).toBe('private');
    });
  });

  // ── PDF Processing ─────────────────────────────────────────────────────

  describe('PDF upload processing', () => {
    it('should process PDF through extraction pipeline', async () => {
      const { upload, job } = await createTestUpload({
        uploadType: 'document',
        mimeType: 'application/pdf',
      });

      jest.spyOn(s3, 'get').mockResolvedValue(Buffer.from('fake-pdf-data'));
      jest.spyOn(s3, 'upload').mockResolvedValue(undefined);
      jest.spyOn(clamav, 'scanBuffer').mockResolvedValue(mockClamavClean());
      jest.spyOn(ocrClient, 'extractPdfText').mockResolvedValue({
        pages: [
          { pageNumber: 1, text: 'Legal case content page 1...', wordCount: 100, isOcr: false },
          { pageNumber: 2, text: 'Legal case content page 2...', wordCount: 150, isOcr: false },
        ],
        totalText: 'Legal case content page 1...\nLegal case content page 2...',
        totalWordCount: 250,
        totalPages: 2,
        confidence: 0.95,
        languageDetected: 'eng',
        hasTextLayer: true,
      });
      jest.spyOn(ocrClient, 'classifyDocument').mockResolvedValue(mockClassification());
      jest.spyOn(ocrClient, 'extractCitations').mockResolvedValue(mockCitationExtraction());
      jest.spyOn(uploadSearch, 'indexUpload').mockResolvedValue(undefined);

      await processor.process(createUploadJob(upload.id, job.id));

      const updatedUpload = await prisma.userUpload.findUnique({ where: { id: upload.id } });
      expect(updatedUpload?.processingStatus).toBe('completed');
      expect(updatedUpload?.ocrStatus).toBe('completed');

      // Should create one OcrResult per page
      const ocrResults = await prisma.ocrResult.findMany({
        where: { userUploadId: upload.id },
        orderBy: { pageNumber: 'asc' },
      });
      expect(ocrResults.length).toBe(2);
      expect(ocrResults[0]?.pageNumber).toBe(1);
      expect(ocrResults[1]?.pageNumber).toBe(2);
    });
  });
});

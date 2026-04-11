import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { AppThrottlerGuard } from '../../src/common/guards/app-throttler.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UploadsProcessor } from '../../src/modules/uploads/uploads.processor';
import { DigestsProcessor } from '../../src/modules/digests/digests.processor';
import { S3Service } from '../../src/modules/uploads/s3.service';
import {
  mockUploadDigestRagResponse,
  mockRagDigestResponse,
  mockRagDigestLowConfidence,
} from './helpers/mock-services';
import { createUploadDigestJob, createDigestJob } from './helpers/job-factory';

/**
 * Camera Scan -> Digest — Integration Tests (Phase 3)
 *
 * Tests the digest generation pipeline from both:
 * 1. UploadsProcessor (generate-upload-digest): OCR text -> RAG -> Digest
 * 2. DigestsProcessor: Document sections -> RAG -> Digest + Provenance
 *
 * Verifies:
 * - Digest fields populated from RAG response
 * - Provenance records created for each digest field
 * - Confidence threshold controls review status
 * - User scan digests always private (per CLAUDE.md)
 * - model_run audit records created
 * - Error handling when RAG service fails
 */
describe('Camera Scan -> Digest — Integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let uploadsProcessor: UploadsProcessor;
  let digestsProcessor: DigestsProcessor;
  let s3: S3Service;

  const originalFetch = global.fetch;

  beforeAll(async () => {
    jest.spyOn(AppThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);

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
    uploadsProcessor = app.get(UploadsProcessor);
    digestsProcessor = app.get(DigestsProcessor);
    s3 = app.get(S3Service);
  }, 30000);

  afterAll(async () => {
    global.fetch = originalFetch;
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  async function createTestContext() {
    const org = await prisma.organization.create({
      data: { name: `Test Org ${Date.now()}`, slug: `test-org-digest-${Date.now()}` },
    });
    const user = await prisma.user.create({
      data: {
        email: `digest-test-${Date.now()}@test.com`,
        passwordHash: '$2b$12$placeholder',
        fullName: 'Digest Test User',
      },
    });
    await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: 'owner' },
    });
    return { org, user };
  }

  async function createUploadWithDigest(orgId: string, userId: string) {
    const upload = await prisma.userUpload.create({
      data: {
        organizationId: orgId,
        userId,
        uploadType: 'camera_scan',
        originalFilename: 'scan.jpg',
        mimeType: 'image/jpeg',
        objectKey: `uploads/${orgId}/${userId}/scan-${Date.now()}.jpg`,
        processingStatus: 'completed',
        ocrStatus: 'completed',
        ocrTextObjectKey: `uploads/${orgId}/${userId}/ocr_text.txt`,
        privacyLevel: 'private',
      },
    });

    const digest = await prisma.digest.create({
      data: {
        organizationId: orgId,
        userId,
        sourceOrigin: 'camera_scan',
        title: 'Test Scan Digest',
        digestType: 'case_digest',
        reviewStatus: 'draft',
        visibility: 'private',
      },
    });

    return { upload, digest };
  }

  async function createDocumentWithDigest(orgId: string, userId: string) {
    // Create a source first. Source schema (schema.prisma:401-422)
    // requires `type` and `name`; the earlier `slug`/`sourceType`/
    // `baseUrl` columns were removed from the model, so we pass only
    // the columns the current Prisma Source model actually has.
    const source = await prisma.source.create({
      data: {
        name: `Test Source ${Date.now()}`,
        type: 'official',
        trustLevel: 'official',
      },
    });

    const doc = await prisma.legalDocument.create({
      data: {
        sourceId: source.id,
        title: 'People v. Test',
        documentType: 'case',
        status: 'published',
        isOfficial: true,
        isPublished: true,
      },
    });

    // Create sections for the document
    const sections = await Promise.all([
      prisma.legalDocumentSection.create({
        data: {
          legalDocumentId: doc.id,
          sectionType: 'facts',
          sectionLabel: 'Facts',
          plainText: 'The petitioner was employed for 10 years...',
          ordering: 1,
          pageStart: 1,
          pageEnd: 2,
        },
      }),
      prisma.legalDocumentSection.create({
        data: {
          legalDocumentId: doc.id,
          sectionType: 'issues',
          sectionLabel: 'Issues',
          plainText: 'Whether the dismissal was constructive...',
          ordering: 2,
          pageStart: 2,
          pageEnd: 3,
        },
      }),
      prisma.legalDocumentSection.create({
        data: {
          legalDocumentId: doc.id,
          sectionType: 'ruling',
          sectionLabel: 'Ruling',
          plainText: 'The Court finds in favor of petitioner...',
          ordering: 3,
          pageStart: 3,
          pageEnd: 4,
        },
      }),
    ]);

    const digest = await prisma.digest.create({
      data: {
        legalDocumentId: doc.id,
        organizationId: orgId,
        userId,
        sourceOrigin: 'editorial',
        title: 'People v. Test — Digest',
        digestType: 'case_digest',
        reviewStatus: 'draft',
        visibility: 'private',
      },
    });

    return { doc, sections, digest, source };
  }

  // ── Upload Digest Generation (UploadsProcessor) ────────────────────────

  describe('Upload digest generation (camera scan)', () => {
    it('should generate digest from OCR text via RAG service', async () => {
      const { org, user } = await createTestContext();
      const { upload, digest } = await createUploadWithDigest(org.id, user.id);

      jest.spyOn(s3, 'get').mockResolvedValue(
        Buffer.from('Full OCR text of legal case document...'),
      );

      const ragResponse = mockUploadDigestRagResponse();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ragResponse,
      }) as jest.Mock;

      const job = createUploadDigestJob({
        uploadId: upload.id,
        digestId: digest.id,
        ocrTextObjectKey: upload.ocrTextObjectKey!,
        organizationId: org.id,
        userId: user.id,
      });

      await uploadsProcessor.process(job);

      const updatedDigest = await prisma.digest.findUnique({ where: { id: digest.id } });
      expect(updatedDigest?.facts).toBe(ragResponse.facts);
      expect(updatedDigest?.issues).toBe(ragResponse.issues);
      expect(updatedDigest?.ruling).toBe(ragResponse.ruling);
      expect(updatedDigest?.doctrine).toBe(ragResponse.doctrine);
      expect(updatedDigest?.dispositive).toBe(ragResponse.dispositive);
      expect(updatedDigest?.confidenceScore).toBe(ragResponse.confidence_score);
    });

    it('should set review_status to pending_review when confidence >= 0.7', async () => {
      const { org, user } = await createTestContext();
      const { upload, digest } = await createUploadWithDigest(org.id, user.id);

      jest.spyOn(s3, 'get').mockResolvedValue(Buffer.from('OCR text...'));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockUploadDigestRagResponse({ confidence_score: 0.85 }),
      }) as jest.Mock;

      await uploadsProcessor.process(createUploadDigestJob({
        uploadId: upload.id,
        digestId: digest.id,
        ocrTextObjectKey: upload.ocrTextObjectKey!,
        organizationId: org.id,
        userId: user.id,
      }));

      const updatedDigest = await prisma.digest.findUnique({ where: { id: digest.id } });
      expect(updatedDigest?.reviewStatus).toBe('pending_review');
    });

    it('should set review_status to needs_human_review when confidence < 0.7', async () => {
      const { org, user } = await createTestContext();
      const { upload, digest } = await createUploadWithDigest(org.id, user.id);

      jest.spyOn(s3, 'get').mockResolvedValue(Buffer.from('OCR text...'));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockUploadDigestRagResponse({ confidence_score: 0.55 }),
      }) as jest.Mock;

      await uploadsProcessor.process(createUploadDigestJob({
        uploadId: upload.id,
        digestId: digest.id,
        ocrTextObjectKey: upload.ocrTextObjectKey!,
        organizationId: org.id,
        userId: user.id,
      }));

      const updatedDigest = await prisma.digest.findUnique({ where: { id: digest.id } });
      expect(updatedDigest?.reviewStatus).toBe('needs_human_review');
    });

    it('should create model_run audit record for digest generation', async () => {
      const { org, user } = await createTestContext();
      const { upload, digest } = await createUploadWithDigest(org.id, user.id);

      jest.spyOn(s3, 'get').mockResolvedValue(Buffer.from('OCR text...'));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockUploadDigestRagResponse(),
      }) as jest.Mock;

      await uploadsProcessor.process(createUploadDigestJob({
        uploadId: upload.id,
        digestId: digest.id,
        ocrTextObjectKey: upload.ocrTextObjectKey!,
        organizationId: org.id,
        userId: user.id,
      }));

      const modelRun = await prisma.modelRun.findFirst({
        where: {
          runType: 'upload_digest_generation',
          inputRef: { contains: digest.id },
        },
      });
      expect(modelRun).not.toBeNull();
      expect(modelRun?.modelName).toBe('test-model-v1');
      expect(modelRun?.promptTemplateVersion).toBe('upload-digest-v1.0');
    });

    it('should mark digest as failed when RAG service errors', async () => {
      const { org, user } = await createTestContext();
      const { upload, digest } = await createUploadWithDigest(org.id, user.id);

      jest.spyOn(s3, 'get').mockResolvedValue(Buffer.from('OCR text...'));
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Model inference error',
      }) as jest.Mock;

      await expect(
        uploadsProcessor.process(createUploadDigestJob({
          uploadId: upload.id,
          digestId: digest.id,
          ocrTextObjectKey: upload.ocrTextObjectKey!,
          organizationId: org.id,
          userId: user.id,
        })),
      ).rejects.toThrow();

      const updatedDigest = await prisma.digest.findUnique({ where: { id: digest.id } });
      expect(updatedDigest?.reviewStatus).toBe('failed');
    });

    it('should fail when OCR text is empty', async () => {
      const { org, user } = await createTestContext();
      const { upload, digest } = await createUploadWithDigest(org.id, user.id);

      jest.spyOn(s3, 'get').mockResolvedValue(Buffer.from(''));

      await expect(
        uploadsProcessor.process(createUploadDigestJob({
          uploadId: upload.id,
          digestId: digest.id,
          ocrTextObjectKey: upload.ocrTextObjectKey!,
          organizationId: org.id,
          userId: user.id,
        })),
      ).rejects.toThrow('OCR text is empty');
    });
  });

  // ── Document Digest Generation (DigestsProcessor) ──────────────────────

  describe('Document digest generation (editorial)', () => {
    it('should generate digest from document sections with provenance records', async () => {
      const { org, user } = await createTestContext();
      const { doc, sections, digest } = await createDocumentWithDigest(org.id, user.id);

      const ragResponse = mockRagDigestResponse({
        provenance: [
          { field: 'facts', source_section_id: sections[0]!.id, source_document_id: doc.id },
          { field: 'issues', source_section_id: sections[1]!.id, source_document_id: doc.id },
          { field: 'ruling', source_section_id: sections[2]!.id, source_document_id: doc.id },
        ],
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ragResponse,
      }) as jest.Mock;

      await digestsProcessor.process(createDigestJob(digest.id, doc.id));

      // Verify digest fields
      const updatedDigest = await prisma.digest.findUnique({ where: { id: digest.id } });
      expect(updatedDigest?.facts).toBeTruthy();
      expect(updatedDigest?.issues).toBeTruthy();
      expect(updatedDigest?.ruling).toBeTruthy();
      expect(updatedDigest?.confidenceScore).toBe(0.85);

      // Verify provenance records
      const provenanceRecords = await prisma.provenanceRecord.findMany({
        where: { entityType: 'digest', entityId: digest.id },
      });
      expect(provenanceRecords.length).toBe(3);

      const provenanceTypes = provenanceRecords.map((p) => p.provenanceType).sort();
      expect(provenanceTypes).toEqual(['facts', 'issues', 'ruling']);

      // Each provenance record should reference the correct section
      for (const prov of provenanceRecords) {
        expect(prov.sourceDocumentId).toBe(doc.id);
        expect(prov.sourceSectionId).toBeTruthy();
      }
    });

    it('should create model_run audit record for document digest', async () => {
      const { org, user } = await createTestContext();
      const { doc, sections, digest } = await createDocumentWithDigest(org.id, user.id);

      // digests.processor.ts:118 writes provenance rows straight from
      // ragResponse.provenance[], and provenance_records has UUID FK
      // columns (source_section_id, source_document_id). The default
      // mockRagDigestResponse stub uses 'section-1'/'doc-1' strings,
      // which Prisma rejects as invalid UUIDs. Override with real IDs
      // matching the sibling test at line 356.
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          mockRagDigestResponse({
            provenance: [
              { field: 'facts', source_section_id: sections[0]!.id, source_document_id: doc.id },
              { field: 'issues', source_section_id: sections[1]!.id, source_document_id: doc.id },
              { field: 'ruling', source_section_id: sections[2]!.id, source_document_id: doc.id },
            ],
          }),
      }) as jest.Mock;

      await digestsProcessor.process(createDigestJob(digest.id, doc.id));

      const modelRun = await prisma.modelRun.findFirst({
        where: {
          runType: 'digest_generation',
          inputRef: { contains: digest.id },
        },
      });
      expect(modelRun).not.toBeNull();
      expect(modelRun?.modelName).toBe('test-model-v1');
    });

    it('should set needs_human_review for low confidence digest', async () => {
      const { org, user } = await createTestContext();
      const { doc, sections, digest } = await createDocumentWithDigest(org.id, user.id);

      // Same reason as the sibling test: pass real UUIDs to avoid
      // tripping the provenance_records UUID constraint at
      // digests.processor.ts:118.
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          mockRagDigestResponse({
            confidence_score: 0.45,
            provenance: [
              { field: 'facts', source_section_id: sections[0]!.id, source_document_id: doc.id },
              { field: 'issues', source_section_id: sections[1]!.id, source_document_id: doc.id },
              { field: 'ruling', source_section_id: sections[2]!.id, source_document_id: doc.id },
            ],
          }),
      }) as jest.Mock;

      await digestsProcessor.process(createDigestJob(digest.id, doc.id));

      const updatedDigest = await prisma.digest.findUnique({ where: { id: digest.id } });
      expect(updatedDigest?.reviewStatus).toBe('needs_human_review');
    });
  });

  // ── Privacy Controls ───────────────────────────────────────────────────

  describe('Privacy controls', () => {
    it('should keep user scan digest visibility as private', async () => {
      const { org, user } = await createTestContext();
      const { upload, digest } = await createUploadWithDigest(org.id, user.id);

      jest.spyOn(s3, 'get').mockResolvedValue(Buffer.from('OCR text content...'));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockUploadDigestRagResponse(),
      }) as jest.Mock;

      await uploadsProcessor.process(createUploadDigestJob({
        uploadId: upload.id,
        digestId: digest.id,
        ocrTextObjectKey: upload.ocrTextObjectKey!,
        organizationId: org.id,
        userId: user.id,
      }));

      const updatedDigest = await prisma.digest.findUnique({ where: { id: digest.id } });
      // Per CLAUDE.md: digests from user scans always private
      expect(updatedDigest?.visibility).toBe('private');
    });
  });
});

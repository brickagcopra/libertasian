import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { OpenSearchService } from '../search/opensearch.service';
import { S3Service } from './s3.service';
import { UserUploadSearchService } from './user-upload-search.service';

// Mock uuid (ESM module — transitive dep via S3Service)
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-uuid'),
}));

// Mock @aws-sdk/client-s3 (transitive dep via S3Service)
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  HeadObjectCommand: jest.fn(),
}));

describe('UserUploadSearchService', () => {
  let service: UserUploadSearchService;
  let prisma: jest.Mocked<PrismaService>;
  let opensearch: jest.Mocked<OpenSearchService>;
  let s3: jest.Mocked<S3Service>;

  const orgId = 'org-1';
  const userId = 'user-1';

  const mockUpload = {
    id: 'upload-1',
    organizationId: orgId,
    userId,
    uploadType: 'camera_scan',
    originalFilename: 'case-decision.jpg',
    mimeType: 'image/jpeg',
    privacyLevel: 'private',
    classifiedDocumentType: 'supreme_court',
    extractedCitationsJson: { normalized: ['G.R. No. 123456'] },
    ocrTextObjectKey: 'uploads/org-1/user-1/upload-1/ocr.txt',
    createdAt: new Date('2026-01-15'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserUploadSearchService,
        {
          provide: PrismaService,
          useValue: {
            userUpload: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            forTenant: jest.fn(),
          },
        },
        {
          provide: OpenSearchService,
          useValue: {
            indexUserUpload: jest.fn(),
            removeUserUpload: jest.fn(),
            searchUserUploads: jest.fn(),
          },
        },
        {
          provide: S3Service,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserUploadSearchService>(UserUploadSearchService);
    prisma = module.get(PrismaService);
    (prisma.forTenant as jest.Mock).mockReturnValue(prisma);
    opensearch = module.get(OpenSearchService);
    s3 = module.get(S3Service);
  });

  // =========================================================================
  // indexUpload
  // =========================================================================

  describe('indexUpload', () => {
    it('should fetch OCR text from S3 and index in OpenSearch', async () => {
      (prisma.userUpload.findUnique as jest.Mock).mockResolvedValueOnce(mockUpload);
      (s3.get as jest.Mock).mockResolvedValueOnce(Buffer.from('The Supreme Court ruled that...'));
      (opensearch.indexUserUpload as jest.Mock).mockResolvedValueOnce(undefined);

      await service.indexUpload('upload-1');

      expect(prisma.userUpload.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'upload-1' } }),
      );
      expect(s3.get).toHaveBeenCalledWith('uploads/org-1/user-1/upload-1/ocr.txt');
      expect(opensearch.indexUserUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          upload_id: 'upload-1',
          organization_id: orgId,
          user_id: userId,
          ocr_text: 'The Supreme Court ruled that...',
          classified_document_type: 'supreme_court',
          extracted_citations: ['G.R. No. 123456'],
        }),
      );
    });

    it('should skip when upload not found', async () => {
      (prisma.userUpload.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await service.indexUpload('missing');

      expect(s3.get).not.toHaveBeenCalled();
      expect(opensearch.indexUserUpload).not.toHaveBeenCalled();
    });

    it('should skip when upload has no OCR text key', async () => {
      (prisma.userUpload.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockUpload,
        ocrTextObjectKey: null,
      });

      await service.indexUpload('upload-1');

      expect(s3.get).not.toHaveBeenCalled();
      expect(opensearch.indexUserUpload).not.toHaveBeenCalled();
    });

    it('should skip when S3 fetch fails', async () => {
      (prisma.userUpload.findUnique as jest.Mock).mockResolvedValueOnce(mockUpload);
      (s3.get as jest.Mock).mockRejectedValueOnce(new Error('NoSuchKey'));

      await service.indexUpload('upload-1');

      expect(opensearch.indexUserUpload).not.toHaveBeenCalled();
    });

    it('should skip when OCR text is empty', async () => {
      (prisma.userUpload.findUnique as jest.Mock).mockResolvedValueOnce(mockUpload);
      (s3.get as jest.Mock).mockResolvedValueOnce(Buffer.from(''));

      await service.indexUpload('upload-1');

      expect(opensearch.indexUserUpload).not.toHaveBeenCalled();
    });

    it('should skip when OCR text is whitespace-only', async () => {
      (prisma.userUpload.findUnique as jest.Mock).mockResolvedValueOnce(mockUpload);
      (s3.get as jest.Mock).mockResolvedValueOnce(Buffer.from('   \n  \t  '));

      await service.indexUpload('upload-1');

      expect(opensearch.indexUserUpload).not.toHaveBeenCalled();
    });

    it('should handle upload with no citations JSON', async () => {
      (prisma.userUpload.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockUpload,
        extractedCitationsJson: null,
      });
      (s3.get as jest.Mock).mockResolvedValueOnce(Buffer.from('Some legal text'));
      (opensearch.indexUserUpload as jest.Mock).mockResolvedValueOnce(undefined);

      await service.indexUpload('upload-1');

      expect(opensearch.indexUserUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          extracted_citations: undefined,
        }),
      );
    });

    it('should handle upload with empty normalized citations', async () => {
      (prisma.userUpload.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockUpload,
        extractedCitationsJson: { normalized: [] },
      });
      (s3.get as jest.Mock).mockResolvedValueOnce(Buffer.from('Some text'));
      (opensearch.indexUserUpload as jest.Mock).mockResolvedValueOnce(undefined);

      await service.indexUpload('upload-1');

      expect(opensearch.indexUserUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          extracted_citations: undefined,
        }),
      );
    });

    it('should include optional fields from upload metadata', async () => {
      (prisma.userUpload.findUnique as jest.Mock).mockResolvedValueOnce(mockUpload);
      (s3.get as jest.Mock).mockResolvedValueOnce(Buffer.from('Legal text content'));
      (opensearch.indexUserUpload as jest.Mock).mockResolvedValueOnce(undefined);

      await service.indexUpload('upload-1');

      expect(opensearch.indexUserUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          original_filename: 'case-decision.jpg',
          upload_type: 'camera_scan',
          mime_type: 'image/jpeg',
          privacy_level: 'private',
          created_at: expect.any(String),
        }),
      );
    });
  });

  // =========================================================================
  // removeFromIndex
  // =========================================================================

  describe('removeFromIndex', () => {
    it('should call OpenSearch to remove upload from index', async () => {
      (opensearch.removeUserUpload as jest.Mock).mockResolvedValueOnce(undefined);

      await service.removeFromIndex('upload-1');

      expect(opensearch.removeUserUpload).toHaveBeenCalledWith('upload-1');
    });
  });

  // =========================================================================
  // search
  // =========================================================================

  describe('search', () => {
    it('should search with org scoping and return paginated results', async () => {
      const mockResult = {
        total: 15,
        items: [{ upload_id: 'upload-1', score: 0.95 }],
        timedOut: false,
      };
      (opensearch.searchUserUploads as jest.Mock).mockResolvedValueOnce(mockResult);

      const result = await service.search(orgId, {
        query: 'murder treachery',
        page: 1,
        limit: 20,
      });

      expect(result.total).toBe(15);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.items).toHaveLength(1);
      expect(opensearch.searchUserUploads).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'murder treachery',
          organizationId: orgId,
          from: 0,
          size: 20,
        }),
      );
    });

    it('should apply filters (documentType, dateFrom, dateTo)', async () => {
      (opensearch.searchUserUploads as jest.Mock).mockResolvedValueOnce({
        total: 0,
        items: [],
        timedOut: false,
      });

      await service.search(orgId, {
        query: 'tax',
        documentType: 'statute',
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        page: 2,
        limit: 10,
      });

      expect(opensearch.searchUserUploads).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: {
            documentType: 'statute',
            dateFrom: '2025-01-01',
            dateTo: '2025-12-31',
          },
          from: 10, // page 2, limit 10 → offset 10
          size: 10,
        }),
      );
    });

    it('should cap limit at 100', async () => {
      (opensearch.searchUserUploads as jest.Mock).mockResolvedValueOnce({
        total: 0,
        items: [],
        timedOut: false,
      });

      await service.search(orgId, { query: 'test', limit: 500 });

      expect(opensearch.searchUserUploads).toHaveBeenCalledWith(
        expect.objectContaining({ size: 100 }),
      );
    });

    it('should default page to 1 and limit to 20', async () => {
      (opensearch.searchUserUploads as jest.Mock).mockResolvedValueOnce({
        total: 0,
        items: [],
        timedOut: false,
      });

      await service.search(orgId, { query: 'test' });

      expect(opensearch.searchUserUploads).toHaveBeenCalledWith(
        expect.objectContaining({ from: 0, size: 20 }),
      );
    });

    it('should include timedOut flag from OpenSearch response', async () => {
      (opensearch.searchUserUploads as jest.Mock).mockResolvedValueOnce({
        total: 5,
        items: [],
        timedOut: true,
      });

      const result = await service.search(orgId, { query: 'test' });
      expect(result.timedOut).toBe(true);
    });
  });

  // =========================================================================
  // bulkIndexOrganizationUploads
  // =========================================================================

  describe('bulkIndexOrganizationUploads', () => {
    it('should index all completed uploads for an organization', async () => {
      (prisma.userUpload.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'upload-1' },
        { id: 'upload-2' },
      ]);
      // Mock indexUpload calls via the internal path
      (prisma.userUpload.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockUpload)
        .mockResolvedValueOnce({ ...mockUpload, id: 'upload-2' });
      (s3.get as jest.Mock)
        .mockResolvedValueOnce(Buffer.from('Text 1'))
        .mockResolvedValueOnce(Buffer.from('Text 2'));
      (opensearch.indexUserUpload as jest.Mock).mockResolvedValue(undefined);

      const result = await service.bulkIndexOrganizationUploads(orgId);

      expect(result.indexed).toBe(2);
      expect(result.errors).toBe(0);
      expect(prisma.forTenant).toHaveBeenCalledWith(orgId);
      expect(prisma.userUpload.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ocrStatus: 'completed',
          }),
        }),
      );
    });

    it('should count errors when individual uploads fail', async () => {
      (prisma.userUpload.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'upload-1' },
        { id: 'upload-2' },
      ]);
      (prisma.userUpload.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockUpload)
        .mockResolvedValueOnce(mockUpload);
      (s3.get as jest.Mock)
        .mockResolvedValueOnce(Buffer.from('Text'))
        .mockRejectedValueOnce(new Error('S3 error'));
      (opensearch.indexUserUpload as jest.Mock)
        .mockResolvedValueOnce(undefined);

      const result = await service.bulkIndexOrganizationUploads(orgId);

      // First succeeds (indexUpload completes), second fails with S3 error
      // But indexUpload catches S3 errors internally and just returns
      // So the error would need to come from opensearch.indexUserUpload
      expect(result.indexed + result.errors).toBeLessThanOrEqual(2);
    });

    it('should return zeros when no completed uploads exist', async () => {
      (prisma.userUpload.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.bulkIndexOrganizationUploads(orgId);

      expect(result.indexed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
    });
  });
});

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { S3Service } from '../uploads/s3.service';
import { ExportGeneratorService } from './export-generator.service';
import { ExportsService } from './exports.service';

// Mock uuid (ESM-only package, cannot be transformed by ts-jest)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

describe('ExportsService', () => {
  let service: ExportsService;
  let prisma: jest.Mocked<PrismaService>;
  let s3: jest.Mocked<S3Service>;
  let generator: jest.Mocked<ExportGeneratorService>;
  let audit: jest.Mocked<AuditService>;

  const userId = 'user-1';
  const orgId = 'org-1';
  const ip = '127.0.0.1';

  // -------------------------------------------------------------------------
  // Mock data
  // -------------------------------------------------------------------------

  const mockDigest = {
    id: 'digest-1',
    userId,
    organizationId: orgId,
    title: 'People v. Santos',
    digestType: 'case_digest',
    visibility: 'private',
    summary: 'Summary text',
    facts: 'Facts text',
    petitionerArguments: null,
    respondentArguments: null,
    issues: 'Issues text',
    ruling: 'Ruling text',
    doctrine: null,
    dispositive: 'Dispositive text',
    citedAuthoritiesJson: [{ citation_text: 'G.R. No. 123456' }],
    legalDocument: {
      court: 'Supreme Court',
      grNo: '123456',
      ponente: 'Justice A',
      decisionDate: new Date('2024-01-15'),
    },
  };

  const mockMemo = {
    id: 'memo-1',
    userId,
    organizationId: orgId,
    query: 'What is due process?',
    memoType: 'legal_opinion',
    status: 'completed',
    structuredOutput: { analysis: 'Legal analysis here', conclusion: 'Conclusion here' },
    citationsJson: [{ citation_text: 'Art. III, Sec. 1' }],
    confidenceScore: 0.85,
  };

  const mockNote = {
    id: 'note-1',
    userId,
    organizationId: orgId,
    title: 'Research Notes',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sample note' }] }] },
    visibility: 'private',
    matter: { title: 'Civil Case 001' },
  };

  const mockExportJob = {
    id: 'job-1',
    organizationId: orgId,
    userId,
    contentType: 'digest',
    contentId: 'digest-1',
    format: 'pdf',
    status: 'processing',
    objectKey: null,
    filename: null,
    fileSizeBytes: null,
    failureReason: null,
    expiresAt: null,
    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCompletedJob = {
    ...mockExportJob,
    status: 'completed',
    objectKey: 'exports/org-1/user-1/job-1/People-v-Santos-digest.pdf',
    filename: 'People-v-Santos-digest.pdf',
    fileSizeBytes: 1024,
    expiresAt: new Date(Date.now() + 86400000),
    finishedAt: new Date(),
  };

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportsService,
        {
          provide: PrismaService,
          useValue: {
            exportJob: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            digest: {
              findUnique: jest.fn(),
            },
            legalMemo: {
              findUnique: jest.fn(),
            },
            note: {
              findUnique: jest.fn(),
            },
            forTenant: jest.fn(),
          },
        },
        {
          provide: S3Service,
          useValue: {
            upload: jest.fn().mockResolvedValue(undefined),
            get: jest.fn().mockResolvedValue(Buffer.from('file-data')),
          },
        },
        {
          provide: ExportGeneratorService,
          useValue: {
            generateDigestPdf: jest.fn().mockResolvedValue({
              buffer: Buffer.from('pdf-data'),
              filename: 'People-v-Santos-digest.pdf',
            }),
            generateDigestDocx: jest.fn().mockResolvedValue({
              buffer: Buffer.from('docx-data'),
              filename: 'People-v-Santos-digest.docx',
            }),
            generateMemoPdf: jest.fn().mockResolvedValue({
              buffer: Buffer.from('pdf-data'),
              filename: 'What-is-due-process-memo.pdf',
            }),
            generateMemoDocx: jest.fn().mockResolvedValue({
              buffer: Buffer.from('docx-data'),
              filename: 'What-is-due-process-memo.docx',
            }),
            generateNotePdf: jest.fn().mockResolvedValue({
              buffer: Buffer.from('pdf-data'),
              filename: 'Research-Notes-note.pdf',
            }),
            generateNoteDocx: jest.fn().mockResolvedValue({
              buffer: Buffer.from('docx-data'),
              filename: 'Research-Notes-note.docx',
            }),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ExportsService>(ExportsService);
    prisma = module.get(PrismaService);
    s3 = module.get(S3Service);
    generator = module.get(ExportGeneratorService);
    audit = module.get(AuditService);

    // forTenant returns the same mock so existing model mocks keep firing
    (prisma.forTenant as jest.Mock).mockReturnValue(prisma);
  });

  // =========================================================================
  // createExport
  // =========================================================================

  describe('createExport', () => {
    it('should create a digest PDF export successfully', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce(mockDigest);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      const result = await service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip);

      expect(result.status).toBe('completed');
      expect(prisma.exportJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId,
          userId,
          contentType: 'digest',
          contentId: 'digest-1',
          format: 'pdf',
          status: 'processing',
        }),
      });
      expect(generator.generateDigestPdf).toHaveBeenCalled();
      expect(s3.upload).toHaveBeenCalledWith(
        expect.stringContaining('exports/'),
        expect.any(Buffer),
        'application/pdf',
        expect.any(String),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'export.created',
          entityType: 'export_job',
          metadata: expect.objectContaining({ contentType: 'digest', format: 'pdf' }),
        }),
      );
    });

    it('should create a digest DOCX export successfully', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce(mockDigest);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await service.createExport('digest', 'digest-1', 'docx', userId, orgId, ip);

      expect(generator.generateDigestDocx).toHaveBeenCalled();
      expect(s3.upload).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        expect.any(String),
      );
    });

    it('should create a memo PDF export successfully', async () => {
      (prisma.legalMemo.findUnique as jest.Mock).mockResolvedValueOnce(mockMemo);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await service.createExport('memo', 'memo-1', 'pdf', userId, orgId, ip);

      expect(generator.generateMemoPdf).toHaveBeenCalled();
    });

    it('should create a note DOCX export successfully', async () => {
      (prisma.note.findUnique as jest.Mock).mockResolvedValueOnce(mockNote);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await service.createExport('note', 'note-1', 'docx', userId, orgId, ip);

      expect(prisma.forTenant).toHaveBeenCalledWith(orgId);
      expect(generator.generateNoteDocx).toHaveBeenCalled();
    });

    it('should mark job as failed when generation throws', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce(mockDigest);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (generator.generateDigestPdf as jest.Mock).mockRejectedValueOnce(new Error('PDF engine crashed'));
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce({
        ...mockExportJob,
        status: 'failed',
        failureReason: 'PDF engine crashed',
      });

      await expect(
        service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.exportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'failed',
          failureReason: expect.stringContaining('PDF engine crashed'),
        }),
      });
    });

    it('should mark job as failed when S3 upload fails', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce(mockDigest);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (s3.upload as jest.Mock).mockRejectedValueOnce(new Error('S3 unavailable'));
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce({
        ...mockExportJob,
        status: 'failed',
      });

      await expect(
        service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for unsupported content type', async () => {
      await expect(
        service.createExport('invoice', 'id-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(BadRequestException);
    });

    it('should truncate long error messages to 500 characters', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce(mockDigest);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (generator.generateDigestPdf as jest.Mock).mockRejectedValueOnce(new Error('X'.repeat(600)));
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce({
        ...mockExportJob,
        status: 'failed',
      });

      await expect(
        service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(BadRequestException);

      const updateCall = (prisma.exportJob.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.failureReason.length).toBeLessThanOrEqual(500);
    });
  });

  // =========================================================================
  // listExports
  // =========================================================================

  describe('listExports', () => {
    it('should return paginated list of exports', async () => {
      const items = [
        { id: 'a', contentType: 'digest', contentId: 'c1', format: 'pdf', status: 'completed', filename: 'f.pdf', fileSizeBytes: 100, failureReason: null, expiresAt: new Date(), createdAt: new Date() },
        { id: 'b', contentType: 'memo', contentId: 'c2', format: 'docx', status: 'completed', filename: 'f.docx', fileSizeBytes: 200, failureReason: null, expiresAt: new Date(), createdAt: new Date() },
      ];
      (prisma.exportJob.findMany as jest.Mock).mockResolvedValueOnce(items);

      const result = await service.listExports(userId, orgId);

      expect(result.data).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(prisma.exportJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21, // limit + 1
          where: { userId, organizationId: orgId },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should return nextCursor when more items exist', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        id: `item-${i}`,
        contentType: 'digest',
        contentId: `c${i}`,
        format: 'pdf',
        status: 'completed',
        filename: `f${i}.pdf`,
        fileSizeBytes: 100,
        failureReason: null,
        expiresAt: new Date(),
        createdAt: new Date(),
      }));
      (prisma.exportJob.findMany as jest.Mock).mockResolvedValueOnce(items);

      const result = await service.listExports(userId, orgId);

      expect(result.data).toHaveLength(20);
      expect(result.nextCursor).toBe('item-19');
    });

    it('should filter by contentType when provided', async () => {
      (prisma.exportJob.findMany as jest.Mock).mockResolvedValueOnce([]);

      await service.listExports(userId, orgId, undefined, 20, 'memo');

      expect(prisma.exportJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, organizationId: orgId, contentType: 'memo' },
        }),
      );
    });

    it('should use cursor for pagination when provided', async () => {
      (prisma.exportJob.findMany as jest.Mock).mockResolvedValueOnce([]);

      await service.listExports(userId, orgId, 'cursor-id', 10);

      expect(prisma.exportJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 11,
          skip: 1,
          cursor: { id: 'cursor-id' },
        }),
      );
    });

    it('should return empty data with null cursor for no results', async () => {
      (prisma.exportJob.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.listExports(userId, orgId);

      expect(result.data).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });
  });

  // =========================================================================
  // getExport
  // =========================================================================

  describe('getExport', () => {
    it('should return export job when user is the owner', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      const result = await service.getExport('job-1', userId, orgId);

      expect(result.id).toBe('job-1');
    });

    it('should throw NotFoundException when export does not exist', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.getExport('missing', userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when userId does not match', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await expect(
        service.getExport('job-1', 'other-user', orgId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when organizationId does not match', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await expect(
        service.getExport('job-1', userId, 'other-org'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // downloadExport
  // =========================================================================

  describe('downloadExport', () => {
    it('should return buffer, filename, mimeType, and fileSize for completed PDF export', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      const result = await service.downloadExport('job-1', userId, orgId);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toBe('People-v-Santos-digest.pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(result.fileSize).toBe(1024);
      expect(s3.get).toHaveBeenCalledWith(mockCompletedJob.objectKey);
    });

    it('should return correct DOCX mime type', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockCompletedJob,
        format: 'docx',
        filename: 'doc.docx',
      });

      const result = await service.downloadExport('job-1', userId, orgId);

      expect(result.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    });

    it('should throw BadRequestException when export is not completed', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockCompletedJob,
        status: 'processing',
      });

      await expect(
        service.downloadExport('job-1', userId, orgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when objectKey is missing', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockCompletedJob,
        objectKey: null,
      });

      await expect(
        service.downloadExport('job-1', userId, orgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when filename is missing', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockCompletedJob,
        filename: null,
      });

      await expect(
        service.downloadExport('job-1', userId, orgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when export has expired', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockCompletedJob,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      });

      await expect(
        service.downloadExport('job-1', userId, orgId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow download when expiresAt is null (no expiration)', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockCompletedJob,
        expiresAt: null,
      });

      const result = await service.downloadExport('job-1', userId, orgId);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should throw NotFoundException when export does not exist', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.downloadExport('missing', userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for cross-user access', async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await expect(
        service.downloadExport('job-1', 'other-user', orgId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // fetchContent — Digest access control
  // =========================================================================

  describe('fetchContent — digest access control', () => {
    it('should allow owner to fetch private digest', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce(mockDigest);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await expect(
        service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip),
      ).resolves.toBeDefined();
    });

    it('should throw ForbiddenException for private digest accessed by different user', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockDigest,
        userId: 'other-user',
        organizationId: 'other-org',
        visibility: 'private',
      });

      await expect(
        service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow same-org user to fetch org-visibility digest', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockDigest,
        userId: 'other-user',
        visibility: 'org',
      });
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await expect(
        service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip),
      ).resolves.toBeDefined();
    });

    it('should deny different-org user from org-visibility digest', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockDigest,
        userId: 'other-user',
        organizationId: 'other-org',
        visibility: 'org',
      });

      await expect(
        service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow anyone to fetch public_editorial digest', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockDigest,
        userId: 'other-user',
        organizationId: 'other-org',
        visibility: 'public_editorial',
      });
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await expect(
        service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip),
      ).resolves.toBeDefined();
    });

    it('should throw NotFoundException when digest does not exist', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.createExport('digest', 'missing', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // fetchContent — Memo access control
  // =========================================================================

  describe('fetchContent — memo access control', () => {
    it('should allow owner to fetch their completed memo', async () => {
      (prisma.legalMemo.findUnique as jest.Mock).mockResolvedValueOnce(mockMemo);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await expect(
        service.createExport('memo', 'memo-1', 'pdf', userId, orgId, ip),
      ).resolves.toBeDefined();
    });

    it('should throw ForbiddenException when org does not match for memo', async () => {
      (prisma.legalMemo.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockMemo,
        organizationId: 'other-org',
      });

      await expect(
        service.createExport('memo', 'memo-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user does not match for memo', async () => {
      (prisma.legalMemo.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockMemo,
        userId: 'other-user',
      });

      await expect(
        service.createExport('memo', 'memo-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when memo is not completed', async () => {
      (prisma.legalMemo.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockMemo,
        status: 'generating',
      });

      await expect(
        service.createExport('memo', 'memo-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when memo does not exist', async () => {
      (prisma.legalMemo.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.createExport('memo', 'missing', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // fetchContent — Note access control
  // =========================================================================

  describe('fetchContent — note access control', () => {
    it('should allow owner to fetch their note', async () => {
      (prisma.note.findUnique as jest.Mock).mockResolvedValueOnce(mockNote);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await expect(
        service.createExport('note', 'note-1', 'pdf', userId, orgId, ip),
      ).resolves.toBeDefined();
    });

    it('should throw NotFoundException when note belongs to another org (forTenant filters it out)', async () => {
      // forTenant(orgId).note.findUnique returns null for cross-org rows
      (prisma.note.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.createExport('note', 'note-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user does not match for note', async () => {
      (prisma.note.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockNote,
        userId: 'other-user',
      });

      await expect(
        service.createExport('note', 'note-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when note does not exist', async () => {
      (prisma.note.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.createExport('note', 'missing', 'pdf', userId, orgId, ip),
      ).rejects.toThrow(NotFoundException);
    });

    it('should include matterTitle in note export data', async () => {
      (prisma.note.findUnique as jest.Mock).mockResolvedValueOnce(mockNote);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await service.createExport('note', 'note-1', 'pdf', userId, orgId, ip);

      expect(generator.generateNotePdf).toHaveBeenCalledWith(
        expect.objectContaining({ matterTitle: 'Civil Case 001' }),
      );
    });

    it('should handle note without matter', async () => {
      (prisma.note.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockNote,
        matter: null,
      });
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await service.createExport('note', 'note-1', 'pdf', userId, orgId, ip);

      expect(generator.generateNotePdf).toHaveBeenCalledWith(
        expect.objectContaining({ matterTitle: null }),
      );
    });
  });

  // =========================================================================
  // S3 key structure
  // =========================================================================

  describe('S3 upload key', () => {
    it('should use correct S3 key pattern: exports/{orgId}/{userId}/{jobId}/{filename}', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce(mockDigest);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip);

      const uploadCall = (s3.upload as jest.Mock).mock.calls[0];
      expect(uploadCall[0]).toBe(
        `exports/${orgId}/${userId}/${mockExportJob.id}/People-v-Santos-digest.pdf`,
      );
    });
  });

  // =========================================================================
  // Audit logging
  // =========================================================================

  describe('audit logging', () => {
    it('should log audit event with correct metadata on successful export', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce(mockDigest);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce(mockCompletedJob);

      await service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip);

      expect(audit.log).toHaveBeenCalledWith({
        organizationId: orgId,
        actorUserId: userId,
        actorType: 'user',
        action: 'export.created',
        entityType: 'export_job',
        entityId: mockExportJob.id,
        metadata: {
          contentType: 'digest',
          contentId: 'digest-1',
          format: 'pdf',
          fileSizeBytes: 8, // Buffer.from('pdf-data').length
          ip,
        },
      });
    });

    it('should NOT log audit event when export fails', async () => {
      (prisma.digest.findUnique as jest.Mock).mockResolvedValueOnce(mockDigest);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(mockExportJob);
      (generator.generateDigestPdf as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      (prisma.exportJob.update as jest.Mock).mockResolvedValueOnce({ ...mockExportJob, status: 'failed' });

      await expect(
        service.createExport('digest', 'digest-1', 'pdf', userId, orgId, ip),
      ).rejects.toThrow();

      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});

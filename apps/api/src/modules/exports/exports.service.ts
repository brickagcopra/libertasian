import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { S3Service } from '../uploads/s3.service';
import {
  ExportGeneratorService,
  DigestExportData,
  MemoExportData,
  NoteExportData,
} from './export-generator.service';

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// Export files expire after 24 hours
const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly generator: ExportGeneratorService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  // Create export
  // =========================================================================

  async createExport(
    contentType: string,
    contentId: string,
    format: string,
    userId: string,
    organizationId: string,
    ip: string,
  ) {
    // 1. Fetch content & verify access
    const contentData = await this.fetchContent(contentType, contentId, userId, organizationId);

    // 2. Create job record
    const job = await this.prisma.exportJob.create({
      data: {
        organizationId,
        userId,
        contentType,
        contentId,
        format,
        status: 'processing',
        startedAt: new Date(),
      },
    });

    try {
      // 3. Generate file
      const { buffer, filename } = await this.generate(contentType, format, contentData);

      // 4. Upload to S3
      const objectKey = `exports/${organizationId}/${userId}/${job.id}/${filename}`;
      await this.s3.upload(objectKey, buffer, MIME_TYPES[format] ?? 'application/octet-stream', filename);

      // 5. Update job as completed
      const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
      const updated = await this.prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          objectKey,
          filename,
          fileSizeBytes: buffer.length,
          expiresAt,
          finishedAt: new Date(),
        },
      });

      // 6. Audit log
      await this.audit.log({
        organizationId,
        actorUserId: userId,
        actorType: 'user',
        action: 'export.created',
        entityType: 'export_job',
        entityId: job.id,
        metadata: { contentType, contentId, format, fileSizeBytes: buffer.length, ip },
      });

      return updated;
    } catch (err) {
      // Mark job as failed
      const reason = err instanceof Error ? err.message : 'Unknown error';
      await this.prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          failureReason: reason.slice(0, 500),
          finishedAt: new Date(),
        },
      });
      this.logger.error(`Export job ${job.id} failed: ${reason}`, (err as Error)?.stack);
      throw new BadRequestException('Export generation failed. Please try again.');
    }
  }

  // =========================================================================
  // List exports
  // =========================================================================

  async listExports(
    userId: string,
    organizationId: string,
    cursor?: string,
    limit = 20,
    contentType?: string,
  ) {
    const where: Record<string, unknown> = {
      userId,
      organizationId,
    };
    if (contentType) {
      where['contentType'] = contentType;
    }

    const items = await this.prisma.exportJob.findMany({
      take: limit + 1,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        contentType: true,
        contentId: true,
        format: true,
        status: true,
        filename: true,
        fileSizeBytes: true,
        failureReason: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    const hasNext = items.length > limit;
    if (hasNext) items.pop();

    return {
      data: items,
      nextCursor: hasNext && items.length > 0 ? items[items.length - 1]!.id : null,
    };
  }

  // =========================================================================
  // Get export detail
  // =========================================================================

  async getExport(id: string, userId: string, organizationId: string) {
    const job = await this.prisma.exportJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Export not found');
    if (job.userId !== userId || job.organizationId !== organizationId) {
      throw new ForbiddenException('You do not have access to this export');
    }
    return job;
  }

  // =========================================================================
  // Download export
  // =========================================================================

  async downloadExport(id: string, userId: string, organizationId: string) {
    const job = await this.getExport(id, userId, organizationId);

    if (job.status !== 'completed') {
      throw new BadRequestException('Export is not ready for download');
    }
    if (!job.objectKey || !job.filename) {
      throw new BadRequestException('Export file is missing');
    }
    if (job.expiresAt && new Date(job.expiresAt) < new Date()) {
      throw new BadRequestException('Export has expired. Please create a new export.');
    }

    const buffer = await this.s3.get(job.objectKey);
    return {
      buffer,
      filename: job.filename,
      mimeType: MIME_TYPES[job.format] ?? 'application/octet-stream',
      fileSize: job.fileSizeBytes,
    };
  }

  // =========================================================================
  // Private: fetch content with access check
  // =========================================================================

  private async fetchContent(
    contentType: string,
    contentId: string,
    userId: string,
    organizationId: string,
  ): Promise<DigestExportData | MemoExportData | NoteExportData> {
    switch (contentType) {
      case 'digest':
        return this.fetchDigest(contentId, userId, organizationId);
      case 'memo':
        return this.fetchMemo(contentId, userId, organizationId);
      case 'note':
        return this.fetchNote(contentId, userId, organizationId);
      default:
        throw new BadRequestException(`Unsupported content type: ${contentType}`);
    }
  }

  private async fetchDigest(
    id: string,
    userId: string,
    organizationId: string,
  ): Promise<DigestExportData> {
    // CARVE-OUT: assertAccess permits visibility='public_editorial' (line 328); forTenant() would 404 cross-org public digests
    const digest = await this.prisma.digest.findUnique({
      where: { id },
      include: {
        legalDocument: {
          select: { court: true, grNo: true, ponente: true, decisionDate: true },
        },
      },
    });

    if (!digest) throw new NotFoundException('Digest not found');
    this.assertAccess(
      { userId: digest.userId, organizationId: digest.organizationId, visibility: digest.visibility },
      userId,
      organizationId,
    );

    return {
      title: digest.title,
      court: digest.legalDocument?.court,
      grNo: digest.legalDocument?.grNo,
      ponente: digest.legalDocument?.ponente,
      decisionDate: digest.legalDocument?.decisionDate,
      digestType: digest.digestType,
      summary: digest.summary,
      facts: digest.facts,
      petitionerArguments: digest.petitionerArguments,
      respondentArguments: digest.respondentArguments,
      issues: digest.issues,
      ruling: digest.ruling,
      doctrine: digest.doctrine,
      dispositive: digest.dispositive,
      citedAuthoritiesJson: digest.citedAuthoritiesJson as unknown[],
    };
  }

  private async fetchMemo(
    id: string,
    userId: string,
    organizationId: string,
  ): Promise<MemoExportData> {
    const memo = await this.prisma.legalMemo.findUnique({ where: { id } });
    if (!memo) throw new NotFoundException('Memo not found');

    if (memo.organizationId !== organizationId) {
      throw new ForbiddenException('You do not have access to this memo');
    }
    if (memo.userId !== userId) {
      throw new ForbiddenException('You do not have access to this memo');
    }

    if (memo.status !== 'completed') {
      throw new BadRequestException('Memo is not ready for export (still generating)');
    }

    return {
      query: memo.query,
      memoType: memo.memoType,
      structuredOutput: memo.structuredOutput as Record<string, unknown> | null,
      citationsJson: memo.citationsJson as unknown[],
      confidenceScore: memo.confidenceScore,
    };
  }

  private async fetchNote(
    id: string,
    userId: string,
    organizationId: string,
  ): Promise<NoteExportData> {
    const note = await this.prisma.forTenant(organizationId).note.findUnique({
      where: { id },
      include: {
        matter: { select: { title: true } },
      },
    });
    if (!note) throw new NotFoundException('Note not found');

    if (note.userId !== userId) {
      throw new ForbiddenException('You do not have access to this note');
    }

    return {
      title: note.title,
      body: note.body,
      matterTitle: note.matter?.title ?? null,
    };
  }

  // =========================================================================
  // Private: access check (mirrors study-export pattern)
  // =========================================================================

  private assertAccess(
    entity: { userId: string | null; organizationId: string | null; visibility: string },
    userId: string,
    organizationId: string,
  ) {
    if (entity.visibility === 'public_editorial') return;
    if (entity.visibility === 'private' && entity.userId === userId) return;
    if (entity.visibility === 'org' && entity.organizationId === organizationId) return;
    if (entity.userId === userId) return;
    throw new ForbiddenException('You do not have access to this resource');
  }

  // =========================================================================
  // Private: generate
  // =========================================================================

  private async generate(
    contentType: string,
    format: string,
    data: DigestExportData | MemoExportData | NoteExportData,
  ): Promise<{ buffer: Buffer; filename: string }> {
    switch (contentType) {
      case 'digest':
        return format === 'docx'
          ? this.generator.generateDigestDocx(data as DigestExportData)
          : this.generator.generateDigestPdf(data as DigestExportData);
      case 'memo':
        return format === 'docx'
          ? this.generator.generateMemoDocx(data as MemoExportData)
          : this.generator.generateMemoPdf(data as MemoExportData);
      case 'note':
        return format === 'docx'
          ? this.generator.generateNoteDocx(data as NoteExportData)
          : this.generator.generateNotePdf(data as NoteExportData);
      default:
        throw new BadRequestException(`Unsupported content type: ${contentType}`);
    }
  }
}

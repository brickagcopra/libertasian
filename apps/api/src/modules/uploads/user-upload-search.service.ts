import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { OpenSearchService } from '../search/opensearch.service';
import type { UserUploadIndexPayload, UserUploadSearchOptions } from '../search/opensearch.service';
import { S3Service } from './s3.service';

@Injectable()
export class UserUploadSearchService {
  private readonly logger = new Logger(UserUploadSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly opensearch: OpenSearchService,
    private readonly s3: S3Service,
  ) {}

  /**
   * Index a single upload's OCR text into OpenSearch.
   * Fetches OCR text from S3, builds payload, calls OpenSearch indexer.
   */
  async indexUpload(uploadId: string): Promise<void> {
    // Intentional system-level: bootstrap lookup called from worker without org context (uploads.processor.ts:148). Tenant boundary is enforced upstream when the upload row was created.
    const upload = await this.prisma.userUpload.findUnique({
      where: { id: uploadId },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        uploadType: true,
        originalFilename: true,
        mimeType: true,
        privacyLevel: true,
        classifiedDocumentType: true,
        extractedCitationsJson: true,
        ocrTextObjectKey: true,
        createdAt: true,
      },
    });

    if (!upload) {
      this.logger.warn(`Upload ${uploadId} not found — skipping search indexing`);
      return;
    }

    if (!upload.ocrTextObjectKey) {
      this.logger.debug(`Upload ${uploadId} has no OCR text — skipping search indexing`);
      return;
    }

    let ocrText: string;
    try {
      const buffer = await this.s3.get(upload.ocrTextObjectKey);
      ocrText = buffer.toString('utf-8');
    } catch (error) {
      this.logger.warn(`Failed to fetch OCR text for upload ${uploadId}`, error);
      return;
    }

    if (!ocrText || ocrText.trim().length === 0) {
      this.logger.debug(`Upload ${uploadId} has empty OCR text — skipping search indexing`);
      return;
    }

    // Extract citation strings from JSON
    let citations: string[] = [];
    if (upload.extractedCitationsJson) {
      const json = upload.extractedCitationsJson as { normalized?: string[] };
      citations = json.normalized ?? [];
    }

    const payload: UserUploadIndexPayload = {
      upload_id: upload.id,
      organization_id: upload.organizationId,
      user_id: upload.userId,
      ocr_text: ocrText,
      original_filename: upload.originalFilename ?? undefined,
      classified_document_type: upload.classifiedDocumentType ?? undefined,
      upload_type: upload.uploadType,
      mime_type: upload.mimeType ?? undefined,
      privacy_level: upload.privacyLevel,
      extracted_citations: citations.length > 0 ? citations : undefined,
      created_at: upload.createdAt.toISOString(),
    };

    await this.opensearch.indexUserUpload(payload);
    this.logger.log(`Indexed upload ${uploadId} for full-text search`);
  }

  /**
   * Remove a single upload from the search index.
   */
  async removeFromIndex(uploadId: string): Promise<void> {
    await this.opensearch.removeUserUpload(uploadId);
    this.logger.log(`Removed upload ${uploadId} from search index`);
  }

  /**
   * Tenant-scoped search across user uploads.
   * organizationId is always extracted from JWT, never from client.
   */
  async search(organizationId: string, dto: {
    query: string;
    documentType?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 20, 100);
    const from = (page - 1) * limit;

    const options: UserUploadSearchOptions = {
      query: dto.query,
      organizationId,
      filters: {
        documentType: dto.documentType,
        dateFrom: dto.dateFrom,
        dateTo: dto.dateTo,
      },
      from,
      size: limit,
    };

    const result = await this.opensearch.searchUserUploads(options);

    return {
      total: result.total,
      page,
      limit,
      items: result.items,
      timedOut: result.timedOut,
    };
  }

  /**
   * Admin backfill: index all completed uploads for an organization.
   * Processes in batches to avoid overwhelming OpenSearch.
   */
  async bulkIndexOrganizationUploads(organizationId: string): Promise<{ indexed: number; skipped: number; errors: number }> {
    const uploads = await this.prisma.forTenant(organizationId).userUpload.findMany({
      where: {
        ocrStatus: 'completed',
        ocrTextObjectKey: { not: null },
      },
      select: { id: true },
    });

    let indexed = 0;
    let skipped = 0;
    let errors = 0;

    for (const upload of uploads) {
      try {
        await this.indexUpload(upload.id);
        indexed++;
      } catch {
        errors++;
        this.logger.warn(`Failed to index upload ${upload.id} during backfill`);
      }
    }

    skipped = uploads.length - indexed - errors;
    this.logger.log(
      `Backfill complete for org ${organizationId}: ${indexed} indexed, ${skipped} skipped, ${errors} errors`,
    );

    return { indexed, skipped, errors };
  }
}

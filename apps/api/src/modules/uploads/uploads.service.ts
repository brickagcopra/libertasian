import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { DigestsService } from '../digests/digests.service';
import { S3Service } from './s3.service';

interface RagFlashcardResponse {
  flashcards: {
    front: string;
    back: string;
    source_document_id: string | null;
    source_section_id: string | null;
    difficulty: string;
  }[];
  total_generated: number;
  topic: string;
  card_type: string;
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

interface RagOutlineResponse {
  outline: {
    title: string;
    sections: {
      heading: string;
      key_points: string[];
      subsections?: {
        heading: string;
        key_points: string[];
      }[];
    }[];
  };
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

const ALLOWED_MIMES: Record<string, number> = {
  'image/jpeg': 20 * 1024 * 1024, // 20MB
  'image/png': 20 * 1024 * 1024,
  'image/webp': 20 * 1024 * 1024,
  'application/pdf': 50 * 1024 * 1024, // 50MB
};

const ALLOWED_MIME_SET = new Set(Object.keys(ALLOWED_MIMES));

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly ragServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly digestsService: DigestsService,
    private readonly config: ConfigService,
    @InjectQueue('uploads') private readonly uploadsQueue: Queue,
  ) {
    this.ragServiceUrl = this.config.get<string>('RAG_SERVICE_URL', 'http://localhost:8000');
  }

  /**
   * Validate and upload a document file.
   * Returns 202-style response with upload ID and job ID.
   */
  async uploadFile(
    file: Express.Multer.File,
    organizationId: string,
    userId: string,
    privacyLevel: string = 'private',
  ) {
    await this.validateFile(file.buffer, file.originalname);

    const detectedMime = await this.detectMimeType(file.buffer);
    const objectKey = this.s3.generateObjectKey(
      organizationId,
      userId,
      file.originalname,
    );
    const checksum = this.s3.computeChecksum(file.buffer);

    // Upload to S3
    await this.s3.upload(objectKey, file.buffer, detectedMime, file.originalname);

    // Create DB record
    const upload = await this.prisma.userUpload.create({
      data: {
        organizationId,
        userId,
        uploadType: 'document',
        originalFilename: file.originalname,
        mimeType: detectedMime,
        objectKey,
        checksum,
        processingStatus: 'pending',
        privacyLevel,
      },
    });

    // Create processing job record
    const job = await this.prisma.uploadProcessingJob.create({
      data: {
        userUploadId: upload.id,
        jobType: 'process_upload',
        status: 'pending',
      },
    });

    // Enqueue processing
    await this.uploadsQueue.add(
      'process-upload',
      { uploadId: upload.id, jobId: job.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    return { id: upload.id, jobId: job.id, status: 'pending' };
  }

  /**
   * Validate and upload camera scan images.
   */
  async uploadCameraScan(
    files: Express.Multer.File[],
    organizationId: string,
    userId: string,
    options: {
      devicePlatform?: string;
      captureMode?: string;
      privacyLevel?: string;
    } = {},
  ) {
    // Validate each file
    for (const file of files) {
      await this.validateFile(file.buffer, file.originalname, true);
    }

    // Upload first file and create parent record
    const firstFile = files[0];
    if (!firstFile) {
      throw new BadRequestException('At least one file is required');
    }

    const detectedMime = await this.detectMimeType(firstFile.buffer);
    const objectKey = this.s3.generateObjectKey(
      organizationId,
      userId,
      firstFile.originalname,
    );
    const checksum = this.s3.computeChecksum(firstFile.buffer);

    await this.s3.upload(
      objectKey,
      firstFile.buffer,
      detectedMime,
      firstFile.originalname,
    );

    // Upload remaining files
    for (let i = 1; i < files.length; i++) {
      const f = files[i]!;
      const fMime = await this.detectMimeType(f.buffer);
      const fKey = this.s3.generateObjectKey(
        organizationId,
        userId,
        f.originalname,
      );
      await this.s3.upload(fKey, f.buffer, fMime, f.originalname);
    }

    // Per CLAUDE.md: all scans default to private
    const privacyLevel = options.privacyLevel ?? 'private';

    const upload = await this.prisma.userUpload.create({
      data: {
        organizationId,
        userId,
        uploadType: 'camera_scan',
        originalFilename: firstFile.originalname,
        mimeType: detectedMime,
        objectKey,
        checksum,
        pageCount: files.length,
        ocrStatus: 'pending',
        processingStatus: 'pending',
        privacyLevel,
      },
    });

    // Create camera capture record
    await this.prisma.cameraCapture.create({
      data: {
        userUploadId: upload.id,
        devicePlatform: options.devicePlatform,
        captureMode: options.captureMode ?? 'single_page',
        imageCount: files.length,
      },
    });

    // Create processing job
    const job = await this.prisma.uploadProcessingJob.create({
      data: {
        userUploadId: upload.id,
        jobType: 'process_camera_scan',
        status: 'pending',
      },
    });

    // Enqueue processing
    await this.uploadsQueue.add(
      'process-upload',
      { uploadId: upload.id, jobId: job.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    return { id: upload.id, jobId: job.id, status: 'pending' };
  }

  /**
   * List uploads with cursor pagination, org-scoped.
   */
  async list(
    organizationId: string,
    options: {
      cursor?: string;
      limit?: number;
      uploadType?: string;
      processingStatus?: string;
    } = {},
  ) {
    const limit = options.limit ?? 20;
    const where: Record<string, unknown> = { organizationId };

    if (options.uploadType) {
      where['uploadType'] = options.uploadType;
    }
    if (options.processingStatus) {
      where['processingStatus'] = options.processingStatus;
    }

    const uploads = await this.prisma.userUpload.findMany({
      where,
      take: limit + 1,
      ...(options.cursor && { skip: 1, cursor: { id: options.cursor } }),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        uploadType: true,
        originalFilename: true,
        mimeType: true,
        processingStatus: true,
        privacyLevel: true,
        pageCount: true,
        createdAt: true,
      },
    });

    const hasNext = uploads.length > limit;
    const items = hasNext ? uploads.slice(0, limit) : uploads;
    const lastItem = items[items.length - 1];

    return {
      items,
      meta: {
        hasNext,
        nextCursor: hasNext && lastItem ? lastItem.id : undefined,
      },
    };
  }

  /**
   * Get upload details by ID, org-scoped.
   */
  async findById(id: string, organizationId: string) {
    const upload = await this.prisma.userUpload.findFirst({
      where: { id, organizationId },
      include: {
        cameraCaptures: true,
        processingJobs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    return upload;
  }

  /**
   * Get processing status for an upload, org-scoped.
   */
  async getStatus(id: string, organizationId: string) {
    const upload = await this.prisma.userUpload.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        processingStatus: true,
        ocrStatus: true,
        processingJobs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            jobType: true,
            status: true,
            attempts: true,
            errorMessage: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    return upload;
  }

  /**
   * Delete upload (S3 + DB), org-scoped.
   */
  async delete(id: string, organizationId: string): Promise<void> {
    const upload = await this.prisma.userUpload.findFirst({
      where: { id, organizationId },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    // Delete from S3
    try {
      await this.s3.delete(upload.objectKey);
    } catch (err) {
      this.logger.warn(
        `Failed to delete S3 object ${upload.objectKey}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    // Delete from DB (cascade deletes processing jobs and camera captures)
    await this.prisma.userUpload.delete({
      where: { id: upload.id },
    });
  }

  // ---- OCR Results ----

  /**
   * Get OCR results for an upload, org-scoped.
   * Returns per-page OCR data (quality, confidence, word count, text preview).
   */
  async getOcrResults(id: string, organizationId: string) {
    const upload = await this.prisma.userUpload.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        ocrStatus: true,
        ocrTextObjectKey: true,
        classifiedDocumentType: true,
        extractedCitationsJson: true,
        ocrResults: {
          orderBy: { pageNumber: 'asc' },
          select: {
            id: true,
            pageNumber: true,
            qualityScore: true,
            ocrConfidence: true,
            languageDetected: true,
            wordCount: true,
            createdAt: true,
          },
        },
      },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    // Fetch OCR text from S3 if available
    let ocrText: string | null = null;
    if (upload.ocrTextObjectKey) {
      try {
        const textBuffer = await this.s3.get(upload.ocrTextObjectKey);
        ocrText = textBuffer.toString('utf-8');
      } catch (err) {
        this.logger.warn(
          `Failed to fetch OCR text for upload ${id}: ${err instanceof Error ? err.message : 'Unknown'}`,
        );
      }
    }

    return {
      uploadId: upload.id,
      ocrStatus: upload.ocrStatus,
      classifiedDocumentType: upload.classifiedDocumentType,
      extractedCitations: upload.extractedCitationsJson,
      ocrText,
      pages: upload.ocrResults,
    };
  }

  /**
   * Update the privacy level of an upload, org-scoped.
   * Per CLAUDE.md: UI must show explicit toggle for 'editorial_candidate'
   * with a confirmation dialog explaining that editors may review the content.
   */
  async updatePrivacy(
    id: string,
    organizationId: string,
    userId: string,
    privacyLevel: string,
  ) {
    const upload = await this.prisma.userUpload.findFirst({
      where: { id, organizationId },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    // Only the uploader can change privacy level
    if (upload.userId !== userId) {
      throw new ForbiddenException('Only the uploader can change privacy level');
    }

    return this.prisma.userUpload.update({
      where: { id },
      data: { privacyLevel },
      select: {
        id: true,
        privacyLevel: true,
        createdAt: true,
      },
    });
  }

  /**
   * Trigger digest generation from an uploaded/scanned document.
   * Per CLAUDE.md: free users get OCR text only; digest generation requires paid plan.
   * Enforced at API level (controller guard), not just UI.
   */
  async generateDigestFromUpload(
    id: string,
    organizationId: string,
    userId: string,
    digestType: string = 'case_digest',
  ) {
    const upload = await this.prisma.userUpload.findFirst({
      where: { id, organizationId },
      include: { ocrResults: true },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    // OCR must be completed before digest generation
    if (upload.ocrStatus !== 'completed') {
      throw new BadRequestException(
        'OCR processing must complete before digest generation. Current status: ' +
          upload.ocrStatus,
      );
    }

    // Check if digest already exists for this upload
    if (upload.digestId) {
      throw new BadRequestException(
        'A digest has already been generated for this upload',
      );
    }

    // Fetch OCR text from S3
    if (!upload.ocrTextObjectKey) {
      throw new BadRequestException('No OCR text available for this upload');
    }

    const textBuffer = await this.s3.get(upload.ocrTextObjectKey);
    const ocrText = textBuffer.toString('utf-8');

    if (ocrText.trim().length < 50) {
      throw new BadRequestException(
        'Insufficient text extracted from scan for digest generation',
      );
    }

    // Create digest via DigestsService
    // Per CLAUDE.md: digests from user scans are always 'private' visibility
    const digest = await this.digestsService.create(
      {
        title: `Scan Digest: ${upload.originalFilename ?? 'Untitled'}`,
        sourceOrigin: 'camera_capture',
        digestType: digestType as 'case_digest' | 'statute_summary' | 'reviewer_note' | 'study_digest',
        // Placeholder fields — actual AI content will be filled by RAG service
        facts: undefined,
        issues: undefined,
        ruling: undefined,
        doctrine: undefined,
        dispositive: undefined,
        visibility: 'private',
      },
      userId,
      organizationId,
    );

    // Link digest to upload
    await this.prisma.userUpload.update({
      where: { id },
      data: { digestId: digest.id },
    });

    this.logger.log(
      `Digest generation triggered for upload ${id}: digestId=${digest.id}`,
    );

    // Enqueue BullMQ job to trigger AI digest generation via RAG service
    await this.uploadsQueue.add('generate-upload-digest', {
      uploadId: id,
      digestId: digest.id,
      ocrTextObjectKey: upload.ocrTextObjectKey,
      organizationId,
      userId,
    });

    return {
      uploadId: id,
      digestId: digest.id,
      status: 'draft',
      message: 'Digest creation initiated. AI content generation pending.',
    };
  }

  // ---- Matter Attachment ----

  /**
   * Attach an upload to a workspace matter via MatterDocument.
   * Creates a junction record linking the UserUpload to the Matter.
   */
  async attachToMatter(
    uploadId: string,
    organizationId: string,
    userId: string,
    matterId: string,
    title?: string,
    role: string = 'reference',
  ) {
    // Verify upload exists and belongs to org
    const upload = await this.prisma.userUpload.findFirst({
      where: { id: uploadId, organizationId },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    // Verify matter exists and belongs to the same org
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId },
    });

    if (!matter) {
      throw new NotFoundException('Matter not found');
    }

    // Check if already attached
    const existing = await this.prisma.matterDocument.findFirst({
      where: { matterId, userUploadId: uploadId },
    });

    if (existing) {
      throw new BadRequestException('Upload is already attached to this matter');
    }

    const matterDocument = await this.prisma.matterDocument.create({
      data: {
        matterId,
        userUploadId: uploadId,
        title: title ?? upload.originalFilename,
        role,
      },
      select: {
        id: true,
        matterId: true,
        userUploadId: true,
        title: true,
        role: true,
        createdAt: true,
      },
    });

    this.logger.log(
      `Upload ${uploadId} attached to matter ${matterId} as ${role}`,
    );

    return matterDocument;
  }

  // ---- Scan-to-Flashcards ----

  /**
   * Generate AI flashcards from upload OCR text.
   * Calls the RAG flashcard generation service with extracted text as topic context.
   * Per CLAUDE.md: free users get OCR text only; flashcard generation requires paid plan.
   */
  async generateFlashcardsFromUpload(
    uploadId: string,
    organizationId: string,
    userId: string,
    flashcardSetId: string,
    options: { cardType?: string; count?: number; barSubject?: string } = {},
  ) {
    // Verify upload exists, org-scoped, and OCR is complete
    const upload = await this.prisma.userUpload.findFirst({
      where: { id: uploadId, organizationId },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    if (upload.ocrStatus !== 'completed') {
      throw new BadRequestException(
        'OCR processing must complete before flashcard generation. Current status: ' +
          upload.ocrStatus,
      );
    }

    if (!upload.ocrTextObjectKey) {
      throw new BadRequestException('No OCR text available for this upload');
    }

    // Verify flashcard set exists and belongs to user
    const set = await this.prisma.flashcardSet.findUnique({
      where: { id: flashcardSetId },
    });

    if (!set) {
      throw new NotFoundException('Flashcard set not found');
    }

    if (set.userId !== userId) {
      throw new ForbiddenException('Only the set creator can add AI flashcards');
    }

    // Fetch OCR text from S3
    const textBuffer = await this.s3.get(upload.ocrTextObjectKey);
    const ocrText = textBuffer.toString('utf-8');

    if (ocrText.trim().length < 50) {
      throw new BadRequestException(
        'Insufficient text extracted from scan for flashcard generation',
      );
    }

    // Truncate to first ~4000 chars for the topic field (RAG service handles context)
    const topicText = ocrText.length > 4000
      ? ocrText.substring(0, 4000) + '...'
      : ocrText;

    // Call RAG flashcard service
    const ragResponse = await this.callRagFlashcardService({
      topic: topicText,
      cardType: options.cardType ?? 'mixed',
      count: options.count ?? 10,
      barSubject: options.barSubject,
    });

    if (ragResponse.flashcards.length === 0) {
      return {
        uploadId,
        flashcardSetId,
        generatedCount: 0,
        flashcards: [],
        confidenceScore: ragResponse.confidence_score,
        modelName: ragResponse.model_name,
      };
    }

    // Get current max ordering in the set
    const currentMaxOrder = await this.prisma.flashcard.aggregate({
      where: { flashcardSetId },
      _max: { ordering: true },
    });
    const startOrder = (currentMaxOrder._max.ordering ?? -1) + 1;

    // Save generated flashcards in a transaction
    const createdCards = await this.prisma.$transaction(
      ragResponse.flashcards.map((card, index) =>
        this.prisma.flashcard.create({
          data: {
            flashcardSetId,
            front: card.front,
            back: card.back,
            sourceType: 'ai_generated',
            ordering: startOrder + index,
          },
        }),
      ),
    );

    // Update card count
    await this.prisma.flashcardSet.update({
      where: { id: flashcardSetId },
      data: { cardCount: { increment: createdCards.length } },
    });

    this.logger.log(
      `Generated ${createdCards.length} flashcards from upload ${uploadId} into set ${flashcardSetId}`,
    );

    return {
      uploadId,
      flashcardSetId,
      generatedCount: createdCards.length,
      flashcards: createdCards,
      confidenceScore: ragResponse.confidence_score,
      modelName: ragResponse.model_name,
    };
  }

  private async callRagFlashcardService(params: {
    topic: string;
    cardType: string;
    count: number;
    barSubject?: string;
  }): Promise<RagFlashcardResponse> {
    const url = `${this.ragServiceUrl}/flashcards/generate`;

    const body = {
      topic: params.topic,
      card_type: params.cardType,
      count: params.count,
      bar_subject: params.barSubject ?? null,
      context_document_ids: [],
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.logger.error(`RAG flashcard service error: ${response.status} — ${errorText}`);
        throw new BadRequestException(
          `AI flashcard generation failed (status ${response.status}). Please try again.`,
        );
      }

      return (await response.json()) as RagFlashcardResponse;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`RAG flashcard service unreachable: ${String(error)}`);
      throw new BadRequestException(
        'AI flashcard generation service is currently unavailable. Please try again later.',
      );
    }
  }

  // ---- Scan-to-Outline ----

  /**
   * Generate a study outline from upload OCR text.
   * Calls the RAG service to produce a structured outline (sections, key points).
   * Per CLAUDE.md: free users get OCR text only; outline generation requires paid plan.
   */
  async generateOutlineFromUpload(
    uploadId: string,
    organizationId: string,
    outlineType: string = 'topic_outline',
  ) {
    // Verify upload exists, org-scoped, and OCR is complete
    const upload = await this.prisma.userUpload.findFirst({
      where: { id: uploadId, organizationId },
    });

    if (!upload) {
      throw new NotFoundException('Upload not found');
    }

    if (upload.ocrStatus !== 'completed') {
      throw new BadRequestException(
        'OCR processing must complete before outline generation. Current status: ' +
          upload.ocrStatus,
      );
    }

    if (!upload.ocrTextObjectKey) {
      throw new BadRequestException('No OCR text available for this upload');
    }

    // Fetch OCR text from S3
    const textBuffer = await this.s3.get(upload.ocrTextObjectKey);
    const ocrText = textBuffer.toString('utf-8');

    if (ocrText.trim().length < 50) {
      throw new BadRequestException(
        'Insufficient text extracted from scan for outline generation',
      );
    }

    // Call RAG service for outline generation
    const ragResponse = await this.callRagOutlineService(uploadId, ocrText, outlineType);

    this.logger.log(
      `Generated study outline from upload ${uploadId} (type: ${outlineType})`,
    );

    return {
      uploadId,
      outlineType,
      outline: ragResponse.outline,
      confidenceScore: ragResponse.confidence_score,
      modelName: ragResponse.model_name,
    };
  }

  private async callRagOutlineService(
    uploadId: string,
    ocrText: string,
    outlineType: string,
  ): Promise<RagOutlineResponse> {
    const url = `${this.ragServiceUrl}/memos/generate`;

    const body = {
      upload_id: uploadId,
      raw_text: ocrText,
      output_type: 'outline',
      outline_type: outlineType,
      source_type: 'camera_scan',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000), // 2 min timeout for outline gen
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.logger.error(`RAG outline service error: ${response.status} — ${errorText}`);
        throw new BadRequestException(
          `Outline generation failed (status ${response.status}). Please try again.`,
        );
      }

      return (await response.json()) as RagOutlineResponse;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`RAG outline service unreachable: ${String(error)}`);
      throw new BadRequestException(
        'Outline generation service is currently unavailable. Please try again later.',
      );
    }
  }

  // ---- Validation ----

  /**
   * Validate file: magic bytes, MIME type, size limits.
   */
  private async validateFile(
    buffer: Buffer,
    filename: string,
    imageOnly = false,
  ): Promise<void> {
    const detectedMime = await this.detectMimeType(buffer);

    if (imageOnly) {
      const imageTypes = new Set([
        'image/jpeg',
        'image/png',
        'image/webp',
      ]);
      if (!imageTypes.has(detectedMime)) {
        throw new BadRequestException(
          `Invalid file type for camera scan. Expected image, got: ${detectedMime}`,
        );
      }
    }

    if (!ALLOWED_MIME_SET.has(detectedMime)) {
      throw new BadRequestException(
        `File type not allowed: ${detectedMime}. Allowed: ${Array.from(ALLOWED_MIME_SET).join(', ')}`,
      );
    }

    const maxSize = ALLOWED_MIMES[detectedMime]!;
    if (buffer.length > maxSize) {
      const maxMb = Math.round(maxSize / (1024 * 1024));
      throw new BadRequestException(
        `File too large. Maximum size for ${detectedMime}: ${maxMb}MB`,
      );
    }

    // Filename sanity check
    if (!filename || filename.includes('\0')) {
      throw new BadRequestException('Invalid filename');
    }
  }

  /**
   * Detect MIME type from file buffer using magic bytes.
   * Uses file-type@16 (CommonJS compatible).
   */
  private async detectMimeType(buffer: Buffer): Promise<string> {
    // file-type@16 is CommonJS, safe to require
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fromBuffer } = require('file-type') as {
      fromBuffer: (buf: Buffer) => Promise<{ mime: string; ext: string } | undefined>;
    };
    const result = await fromBuffer(buffer);
    if (!result) {
      throw new BadRequestException(
        'Could not determine file type. Ensure the file is a valid image or PDF.',
      );
    }
    return result.mime;
  }
}

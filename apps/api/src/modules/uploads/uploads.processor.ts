import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import sharp from 'sharp';

import { PrismaService } from '../../prisma/prisma.service';
import { ClamavService } from './clamav.service';
import { OcrClientService } from './ocr-client.service';
import { S3Service } from './s3.service';
import { UserUploadSearchService } from './user-upload-search.service';

interface UploadJobData {
  uploadId: string;
  jobId: string;
}

interface UploadDigestJobData {
  uploadId: string;
  digestId: string;
  ocrTextObjectKey: string;
  organizationId: string;
  userId: string;
}

interface RagDigestResponse {
  facts: string;
  issues: string;
  ruling: string;
  doctrine: string;
  dispositive: string;
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

// Sharp security per CLAUDE.md: prevent memory accumulation in workers
sharp.cache(false);

/** Max input pixels (100MP) to prevent decompression bombs per CLAUDE.md */
const SHARP_PIXEL_LIMIT = 100_000_000;

/**
 * Quality thresholds per CLAUDE.md:
 * - < 0.2: reject with guidance
 * - < 0.4: warn user, suggest retake
 * - >= 0.4: acceptable
 */
const QUALITY_REJECT_THRESHOLD = 0.2;
const QUALITY_WARN_THRESHOLD = 0.4;

@Processor('uploads')
export class UploadsProcessor extends WorkerHost {
  private readonly logger = new Logger(UploadsProcessor.name);
  private readonly ragServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly ocrClient: OcrClientService,
    private readonly clamav: ClamavService,
    private readonly config: ConfigService,
    private readonly userUploadSearch: UserUploadSearchService,
  ) {
    super();
    this.ragServiceUrl = this.config.get<string>(
      'RAG_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  async process(job: Job<UploadJobData | UploadDigestJobData>): Promise<void> {
    if (job.name === 'generate-upload-digest') {
      return this.processUploadDigest(job as Job<UploadDigestJobData>);
    }

    const { uploadId, jobId } = job.data as UploadJobData;
    this.logger.log(`Processing upload ${uploadId} (job ${jobId})`);

    try {
      // Mark job as processing
      await this.updateJobStatus(jobId, 'processing');
      await this.updateUploadStatus(uploadId, 'processing');

      const upload = await this.prisma.userUpload.findUnique({
        where: { id: uploadId },
        include: { cameraCaptures: true },
      });

      if (!upload) {
        throw new Error(`Upload ${uploadId} not found`);
      }

      // Download from S3
      const buffer = await this.s3.get(upload.objectKey);

      // Step 0: ClamAV malware scan (per CLAUDE.md: scan every file before processing)
      const scanResult = await this.clamav.scanBuffer(
        buffer,
        upload.originalFilename ?? 'upload',
      );

      if (!scanResult.clean) {
        this.logger.warn(
          `Upload ${uploadId} quarantined: malware detected (${scanResult.virus})`,
        );

        // Mark as quarantined
        await this.prisma.userUpload.update({
          where: { id: uploadId },
          data: { processingStatus: 'quarantined' },
        });

        await this.prisma.uploadProcessingJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            errorMessage: `Malware detected: ${scanResult.virus}. File quarantined.`,
          },
        });

        // Delete the infected file from S3
        await this.s3.delete(upload.objectKey);

        return; // Do not process further
      }

      this.logger.debug(`ClamAV scan passed for upload ${uploadId}`);

      if (upload.uploadType === 'camera_scan') {
        // Full OCR pipeline for camera scans
        await this.processCameraScan(upload, buffer);
      } else if (upload.mimeType?.startsWith('image/')) {
        // Standard image processing (non-scan uploads)
        await this.processImage(upload.objectKey, buffer);
      }
      else if (upload.mimeType === 'application/pdf') {
        // Full PDF processing pipeline
        await this.processPdf(upload, buffer);
      }

      // Mark completed
      await this.updateJobStatus(jobId, 'completed');
      await this.updateUploadStatus(uploadId, 'completed');

      // Index OCR text for full-text search (non-blocking per plan)
      try {
        await this.userUploadSearch.indexUpload(uploadId);
      } catch (indexErr) {
        this.logger.warn(
          `Upload ${uploadId}: search indexing failed (non-blocking)`,
          indexErr instanceof Error ? indexErr.message : indexErr,
        );
      }

      this.logger.log(`Upload ${uploadId} processed successfully`);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown processing error';
      this.logger.error(`Upload ${uploadId} processing failed: ${errorMessage}`);

      await this.updateJobStatus(jobId, 'failed', errorMessage);
      await this.updateUploadStatus(uploadId, 'failed');

      throw err; // Let BullMQ handle retries
    }
  }

  /**
   * Full OCR pipeline for camera scans:
   * 1. Image processing (EXIF strip, thumbnail)
   * 2. Quality scoring
   * 3. OCR text extraction
   * 4. Document classification
   * 5. Citation extraction
   * 6. Store results
   */
  private async processCameraScan(
    upload: {
      id: string;
      objectKey: string;
      organizationId: string;
      userId: string;
      originalFilename: string | null;
    },
    buffer: Buffer,
  ): Promise<void> {
    const filename = upload.originalFilename ?? 'scan.jpg';

    // Step 1: Process image (strip EXIF, generate thumbnail)
    await this.processImage(upload.objectKey, buffer);

    // Step 2: Update OCR status to processing
    await this.prisma.userUpload.update({
      where: { id: upload.id },
      data: { ocrStatus: 'processing' },
    });

    // Step 3: Quality scoring
    let qualityScore = 0.5; // default fallback
    try {
      const qualityResult = await this.ocrClient.scoreQuality(buffer, filename);
      qualityScore = qualityResult.overallScore;

      this.logger.log(
        `Quality score for upload ${upload.id}: ${qualityScore} ` +
          `(acceptable: ${qualityResult.isAcceptable}, warning: ${qualityResult.needsWarning})`,
      );

      // Per CLAUDE.md: quality < 0.2 → reject with guidance
      if (qualityScore < QUALITY_REJECT_THRESHOLD) {
        await this.createOcrResult(upload.id, 1, {
          qualityScore,
          ocrConfidence: 0,
          extractedTextObjectKey: '',
          wordCount: 0,
        });

        await this.prisma.userUpload.update({
          where: { id: upload.id },
          data: {
            ocrStatus: 'failed',
            processingStatus: 'failed',
          },
        });

        // Create a processing job to record the failure reason
        await this.prisma.uploadProcessingJob.create({
          data: {
            userUploadId: upload.id,
            jobType: 'quality_check',
            status: 'failed',
            errorMessage: `Image quality too low (${qualityScore.toFixed(2)}). ${qualityResult.recommendation}`,
            metadata: { qualityScore, metrics: qualityResult.metrics },
          },
        });

        this.logger.warn(
          `Upload ${upload.id} rejected: quality score ${qualityScore} < ${QUALITY_REJECT_THRESHOLD}`,
        );
        return;
      }
    } catch (err) {
      this.logger.warn(
        `Quality scoring failed for ${upload.id}, continuing with default: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
      // Continue with OCR even if quality scoring fails — graceful degradation
    }

    // Step 4: OCR text extraction
    let extractedText = '';
    let ocrConfidence = 0;
    let wordCount = 0;
    let languageDetected = 'eng';

    try {
      const ocrResult = await this.ocrClient.extractText(buffer, filename);
      extractedText = ocrResult.text;
      ocrConfidence = ocrResult.confidence;
      wordCount = ocrResult.wordCount;
      languageDetected = ocrResult.languageDetected;

      this.logger.log(
        `OCR extracted ${wordCount} words from upload ${upload.id} (confidence: ${ocrConfidence})`,
      );
    } catch (err) {
      this.logger.error(
        `OCR extraction failed for ${upload.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );

      await this.prisma.userUpload.update({
        where: { id: upload.id },
        data: { ocrStatus: 'failed' },
      });

      throw err;
    }

    // Step 5: Store OCR text in S3
    const ocrTextKey = `uploads/${upload.organizationId}/${upload.userId}/${upload.id}/ocr_text.txt`;
    await this.s3.upload(
      ocrTextKey,
      Buffer.from(extractedText, 'utf-8'),
      'text/plain',
      'ocr_text.txt',
    );

    // Step 6: Create OcrResult record
    await this.createOcrResult(upload.id, 1, {
      qualityScore,
      ocrConfidence,
      languageDetected,
      extractedTextObjectKey: ocrTextKey,
      wordCount,
    });

    // Step 7: Document classification (non-blocking — continue even if it fails)
    let classifiedDocumentType: string | null = null;
    try {
      if (extractedText.length > 50) {
        const classResult = await this.ocrClient.classifyDocument(extractedText);
        classifiedDocumentType = classResult.documentType;
        this.logger.log(
          `Upload ${upload.id} classified as: ${classifiedDocumentType} (confidence: ${classResult.confidence})`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Classification failed for ${upload.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    // Step 8: Citation extraction (non-blocking)
    let extractedCitations: string[] = [];
    let normalizedCitations: string[] = [];
    try {
      if (extractedText.length > 50) {
        const citResult = await this.ocrClient.extractCitations(extractedText);
        extractedCitations = citResult.citations;
        normalizedCitations = citResult.normalizedCitations;
        this.logger.log(
          `Extracted ${extractedCitations.length} citations from upload ${upload.id}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Citation extraction failed for ${upload.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    // Step 9: Update the UserUpload with all results
    await this.prisma.userUpload.update({
      where: { id: upload.id },
      data: {
        ocrStatus: 'completed',
        ocrTextObjectKey: ocrTextKey,
        classifiedDocumentType,
        extractedCitationsJson:
          extractedCitations.length > 0
            ? { citations: extractedCitations, normalized: normalizedCitations }
            : undefined,
      },
    });

    // Step 10: Update camera capture quality score
    const capture = await this.prisma.cameraCapture.findFirst({
      where: { userUploadId: upload.id },
    });
    if (capture) {
      await this.prisma.cameraCapture.update({
        where: { id: capture.id },
        data: {
          captureQualityScore: qualityScore,
          extractedTextStatus: 'completed',
        },
      });
    }

    // Log quality warning if applicable
    if (qualityScore < QUALITY_WARN_THRESHOLD) {
      this.logger.warn(
        `Upload ${upload.id}: quality score ${qualityScore} is below warning threshold ${QUALITY_WARN_THRESHOLD}`,
      );
    }
  }

  /**
   * Process image: strip EXIF metadata, generate 300px-wide thumbnail.
   */
  private async processImage(
    objectKey: string,
    buffer: Buffer,
  ): Promise<void> {
    // Strip EXIF and re-encode (per CLAUDE.md: strip metadata)
    const processed = await sharp(buffer, { limitInputPixels: SHARP_PIXEL_LIMIT })
      .toBuffer();

    // Re-upload stripped version
    await this.s3.upload(objectKey, processed, 'image/jpeg', 'processed.jpg');

    // Generate 300px-wide thumbnail (per CLAUDE.md performance specs)
    const thumbnail = await sharp(buffer, { limitInputPixels: SHARP_PIXEL_LIMIT })
      .resize({ width: 300, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Store thumbnail alongside original
    const thumbKey = objectKey.replace(/\/([^/]+)$/, '/thumb_$1');
    await this.s3.upload(thumbKey, thumbnail, 'image/jpeg', 'thumbnail.jpg');

    this.logger.log(
      `Image processed: original=${processed.length}B, thumb=${thumbnail.length}B`,
    );
  }

  /**
   * Full PDF processing pipeline:
   * 1. Text extraction (PyMuPDF + OCR fallback)
   * 2. Store extracted text in S3
   * 3. Create OcrResult records (one per page)
   * 4. Document classification
   * 5. Citation extraction
   * 6. Update UserUpload with results
   */
  private async processPdf(
    upload: {
      id: string;
      objectKey: string;
      organizationId: string;
      userId: string;
      originalFilename: string | null;
    },
    buffer: Buffer,
  ): Promise<void> {
    const filename = upload.originalFilename ?? 'document.pdf';

    // Step 1: Update OCR status to processing
    await this.prisma.userUpload.update({
      where: { id: upload.id },
      data: { ocrStatus: 'processing' },
    });

    // Step 2: Extract text via Python PDF service
    let pdfResult;
    try {
      pdfResult = await this.ocrClient.extractPdfText(buffer, filename);
      this.logger.log(
        `PDF extracted ${pdfResult.totalWordCount} words from ${pdfResult.totalPages} pages ` +
          `(upload ${upload.id}, confidence: ${pdfResult.confidence}, ` +
          `hasTextLayer: ${pdfResult.hasTextLayer})`,
      );
    } catch (err) {
      this.logger.error(
        `PDF extraction failed for ${upload.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
      await this.prisma.userUpload.update({
        where: { id: upload.id },
        data: { ocrStatus: 'failed' },
      });
      throw err;
    }

    // Step 3: Store full extracted text in S3
    const ocrTextKey = `uploads/${upload.organizationId}/${upload.userId}/${upload.id}/ocr_text.txt`;
    await this.s3.upload(
      ocrTextKey,
      Buffer.from(pdfResult.totalText, 'utf-8'),
      'text/plain',
      'ocr_text.txt',
    );

    // Step 4: Create OcrResult records (one per page)
    for (const page of pdfResult.pages) {
      await this.createOcrResult(upload.id, page.pageNumber, {
        qualityScore: pdfResult.confidence,
        ocrConfidence: page.isOcr ? 0.7 : 1.0,
        languageDetected: pdfResult.languageDetected,
        extractedTextObjectKey: ocrTextKey,
        wordCount: page.wordCount,
      });
    }

    // Step 5: Document classification (non-blocking)
    let classifiedDocumentType: string | null = null;
    try {
      if (pdfResult.totalText.length > 50) {
        const classResult = await this.ocrClient.classifyDocument(pdfResult.totalText);
        classifiedDocumentType = classResult.documentType;
        this.logger.log(
          `Upload ${upload.id} classified as: ${classifiedDocumentType} (confidence: ${classResult.confidence})`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Classification failed for ${upload.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    // Step 6: Citation extraction (non-blocking)
    let extractedCitations: string[] = [];
    let normalizedCitations: string[] = [];
    try {
      if (pdfResult.totalText.length > 50) {
        const citResult = await this.ocrClient.extractCitations(pdfResult.totalText);
        extractedCitations = citResult.citations;
        normalizedCitations = citResult.normalizedCitations;
        this.logger.log(
          `Extracted ${extractedCitations.length} citations from PDF upload ${upload.id}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Citation extraction failed for ${upload.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    // Step 7: Update the UserUpload with all results
    await this.prisma.userUpload.update({
      where: { id: upload.id },
      data: {
        ocrStatus: 'completed',
        ocrTextObjectKey: ocrTextKey,
        classifiedDocumentType,
        extractedCitationsJson:
          extractedCitations.length > 0
            ? { citations: extractedCitations, normalized: normalizedCitations }
            : undefined,
      },
    });
  }

  /**
   * Create an OcrResult record for a single page.
   */
  private async createOcrResult(
    userUploadId: string,
    pageNumber: number,
    data: {
      qualityScore: number;
      ocrConfidence: number;
      languageDetected?: string;
      extractedTextObjectKey: string;
      wordCount: number;
    },
  ): Promise<void> {
    await this.prisma.ocrResult.create({
      data: {
        userUploadId,
        pageNumber,
        qualityScore: data.qualityScore,
        ocrConfidence: data.ocrConfidence,
        languageDetected: data.languageDetected,
        extractedTextObjectKey: data.extractedTextObjectKey,
        wordCount: data.wordCount,
      },
    });
  }

  private async updateJobStatus(
    jobId: string,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.prisma.uploadProcessingJob.update({
      where: { id: jobId },
      data: {
        status,
        ...(errorMessage && { errorMessage }),
        ...(status === 'processing' && { attempts: { increment: 1 } }),
      },
    });
  }

  private async updateUploadStatus(
    uploadId: string,
    status: string,
  ): Promise<void> {
    await this.prisma.userUpload.update({
      where: { id: uploadId },
      data: { processingStatus: status },
    });
  }

  /**
   * Generate a digest from an uploaded document's OCR text.
   * Fetches OCR text from S3, sends to RAG service, updates digest record.
   */
  private async processUploadDigest(
    job: Job<UploadDigestJobData>,
  ): Promise<void> {
    const { uploadId, digestId, ocrTextObjectKey } = job.data;
    this.logger.log(
      `Processing upload digest: uploadId=${uploadId}, digestId=${digestId}`,
    );

    try {
      // Mark digest as generating
      await this.prisma.digest.update({
        where: { id: digestId },
        data: { reviewStatus: 'generating' },
      });

      // Fetch OCR text from S3
      const ocrBuffer = await this.s3.get(ocrTextObjectKey);
      const ocrText = ocrBuffer.toString('utf-8');

      if (!ocrText || ocrText.trim().length === 0) {
        throw new Error('OCR text is empty — cannot generate digest');
      }

      // Call RAG service
      const ragResponse = await this.callRagServiceForDigest(
        uploadId,
        ocrText,
      );

      // Record model run for audit per CLAUDE.md
      const modelRun = await this.prisma.modelRun.create({
        data: {
          runType: 'upload_digest_generation',
          modelName: ragResponse.model_name,
          promptTemplateVersion: ragResponse.prompt_template_version,
          inputRef: `upload:${uploadId}:digest:${digestId}`,
          outputRef: `digest:${digestId}:output`,
          confidence: ragResponse.confidence_score,
        },
      });

      // Determine review status based on confidence
      // Per CLAUDE.md: digests from user scans always private, confidence < 0.7 -> needs_human_review
      const reviewStatus =
        ragResponse.confidence_score >= 0.7
          ? 'pending_review'
          : 'needs_human_review';

      // Update digest with generated content
      await this.prisma.digest.update({
        where: { id: digestId },
        data: {
          facts: ragResponse.facts,
          issues: ragResponse.issues,
          ruling: ragResponse.ruling,
          doctrine: ragResponse.doctrine,
          dispositive: ragResponse.dispositive,
          confidenceScore: ragResponse.confidence_score,
          reviewStatus,
        },
      });

      this.logger.log(
        `Upload digest ${digestId} generated successfully (confidence: ${ragResponse.confidence_score})`,
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown generation error';
      this.logger.error(
        `Upload digest ${digestId} generation failed: ${errorMessage}`,
      );

      await this.prisma.digest.update({
        where: { id: digestId },
        data: { reviewStatus: 'failed' },
      });

      throw err; // Let BullMQ handle retries
    }
  }

  private async callRagServiceForDigest(
    uploadId: string,
    ocrText: string,
  ): Promise<RagDigestResponse> {
    const url = `${this.ragServiceUrl}/memos/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upload_id: uploadId,
        raw_text: ocrText,
        output_type: 'digest',
        source_type: 'camera_scan',
      }),
      signal: AbortSignal.timeout(180_000), // 3 minute timeout
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RAG service error ${response.status}: ${body}`);
    }

    return response.json() as Promise<RagDigestResponse>;
  }
}

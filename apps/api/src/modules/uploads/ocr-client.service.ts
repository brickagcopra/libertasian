import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Quality score response from the Python OCR service.
 */
export interface QualityScoreResult {
  overallScore: number;
  metrics: {
    blur: number;
    resolution: number;
    contrast: number;
    brightness: number;
  };
  isAcceptable: boolean;
  needsWarning: boolean;
  recommendation: string;
}

/**
 * OCR text extraction result from the Python OCR service.
 */
export interface OcrExtractResult {
  text: string;
  confidence: number;
  wordCount: number;
  languageDetected: string;
}

/**
 * Document classification result from the Python OCR service.
 */
export interface ClassificationResult {
  documentType: string;
  confidence: number;
}

/**
 * A single page result from PDF text extraction.
 */
export interface PdfPageResult {
  pageNumber: number;
  text: string;
  wordCount: number;
  isOcr: boolean;
}

/**
 * PDF text extraction result from the Python OCR service.
 */
export interface PdfExtractResult {
  pages: PdfPageResult[];
  totalText: string;
  totalWordCount: number;
  totalPages: number;
  confidence: number;
  languageDetected: string;
  hasTextLayer: boolean;
}

/**
 * Citation extraction result from the Python OCR service.
 */
export interface CitationExtractionResult {
  citations: string[];
  normalizedCitations: string[];
}

/**
 * HTTP client for communicating with the Python OCR service.
 *
 * Per architecture rules (CLAUDE.md): NestJS is the single gateway.
 * NestJS calls Python services over internal HTTP.
 */
@Injectable()
export class OcrClientService {
  private readonly logger = new Logger(OcrClientService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('OCR_SERVICE_URL', 'http://localhost:8002');
  }

  /**
   * Convert a Node.js Buffer to a Blob safe for FormData.
   * Copies to a fresh ArrayBuffer to satisfy strict TypeScript types.
   */
  private bufferToBlob(buf: Buffer): Blob {
    const arrayBuffer = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer;
    return new Blob([arrayBuffer]);
  }

  /**
   * Score image quality for a camera scan page.
   * Calls POST /quality/score on the OCR service.
   */
  async scoreQuality(imageBuffer: Buffer, filename: string): Promise<QualityScoreResult> {
    const url = `${this.baseUrl}/quality/score`;

    try {
      const formData = new FormData();
      formData.append('file', this.bufferToBlob(imageBuffer), filename);

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OCR quality scoring failed (${response.status}): ${body}`);
      }

      const data = (await response.json()) as {
        overall_score: number;
        metrics: { blur: number; resolution: number; contrast: number; brightness: number };
        is_acceptable: boolean;
        needs_warning: boolean;
        recommendation: string;
      };

      return {
        overallScore: data.overall_score,
        metrics: data.metrics,
        isAcceptable: data.is_acceptable,
        needsWarning: data.needs_warning,
        recommendation: data.recommendation,
      };
    } catch (err) {
      this.logger.error(
        `Quality scoring failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      throw err;
    }
  }

  /**
   * Extract text from an image via OCR.
   * Calls POST /ocr/extract on the OCR service.
   */
  async extractText(
    imageBuffer: Buffer,
    filename: string,
    language = 'eng',
  ): Promise<OcrExtractResult> {
    const url = `${this.baseUrl}/ocr/extract`;

    try {
      const formData = new FormData();
      formData.append('file', this.bufferToBlob(imageBuffer), filename);
      formData.append('language', language);

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OCR text extraction failed (${response.status}): ${body}`);
      }

      const data = (await response.json()) as {
        text: string;
        confidence: number;
        word_count: number;
        language_detected: string;
      };

      return {
        text: data.text,
        confidence: data.confidence,
        wordCount: data.word_count,
        languageDetected: data.language_detected,
      };
    } catch (err) {
      this.logger.error(
        `OCR extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      throw err;
    }
  }

  /**
   * Classify a legal document from its extracted text.
   * Calls POST /classify on the OCR service.
   */
  async classifyDocument(text: string): Promise<ClassificationResult> {
    const url = `${this.baseUrl}/classify`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Document classification failed (${response.status}): ${body}`);
      }

      const data = (await response.json()) as {
        document_type: string;
        confidence: number;
      };

      return {
        documentType: data.document_type,
        confidence: data.confidence,
      };
    } catch (err) {
      this.logger.error(
        `Classification failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      throw err;
    }
  }

  /**
   * Extract legal citations from text.
   * Calls POST /citations/extract on the OCR service.
   */
  async extractCitations(text: string): Promise<CitationExtractionResult> {
    const url = `${this.baseUrl}/citations/extract`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Citation extraction failed (${response.status}): ${body}`);
      }

      const data = (await response.json()) as {
        citations: string[];
        normalized_citations: string[];
      };

      return {
        citations: data.citations,
        normalizedCitations: data.normalized_citations,
      };
    } catch (err) {
      this.logger.error(
        `Citation extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      throw err;
    }
  }

  /**
   * Extract text from a PDF file via the Python OCR service.
   * Calls POST /pdf/extract with a 120s timeout (PDFs can be large).
   */
  async extractPdfText(
    pdfBuffer: Buffer,
    filename: string,
  ): Promise<PdfExtractResult> {
    const url = `${this.baseUrl}/pdf/extract`;

    try {
      const formData = new FormData();
      formData.append('file', this.bufferToBlob(pdfBuffer), filename);

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`PDF extraction failed (${response.status}): ${body}`);
      }

      const data = (await response.json()) as {
        pages: Array<{
          page_number: number;
          text: string;
          word_count: number;
          is_ocr: boolean;
        }>;
        total_text: string;
        total_word_count: number;
        total_pages: number;
        confidence: number;
        language_detected: string;
        has_text_layer: boolean;
      };

      return {
        pages: data.pages.map((p) => ({
          pageNumber: p.page_number,
          text: p.text,
          wordCount: p.word_count,
          isOcr: p.is_ocr,
        })),
        totalText: data.total_text,
        totalWordCount: data.total_word_count,
        totalPages: data.total_pages,
        confidence: data.confidence,
        languageDetected: data.language_detected,
        hasTextLayer: data.has_text_layer,
      };
    } catch (err) {
      this.logger.error(
        `PDF extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      throw err;
    }
  }

  /**
   * Health check for the OCR service.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

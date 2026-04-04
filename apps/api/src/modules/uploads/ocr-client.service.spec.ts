import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { OcrClientService } from './ocr-client.service';

describe('OcrClientService', () => {
  let service: OcrClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrClientService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'OCR_SERVICE_URL') return 'http://localhost:8002';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<OcrClientService>(OcrClientService);
  });

  // ---- scoreQuality ----

  describe('scoreQuality', () => {
    it('should call quality/score endpoint and return mapped result', async () => {
      const mockResponse = {
        overall_score: 0.85,
        metrics: { blur: 0.9, resolution: 0.8, contrast: 0.85, brightness: 0.88 },
        is_acceptable: true,
        needs_warning: false,
        recommendation: 'Good quality',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.scoreQuality(Buffer.from('image'), 'photo.jpg');

      expect(result.overallScore).toBe(0.85);
      expect(result.isAcceptable).toBe(true);
      expect(result.needsWarning).toBe(false);
      expect(result.metrics.blur).toBe(0.9);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8002/quality/score',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should throw on API error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error'),
      });

      await expect(
        service.scoreQuality(Buffer.from('image'), 'photo.jpg'),
      ).rejects.toThrow('OCR quality scoring failed (500)');
    });
  });

  // ---- extractText ----

  describe('extractText', () => {
    it('should call ocr/extract endpoint and return mapped result', async () => {
      const mockResponse = {
        text: 'Extracted legal text here',
        confidence: 0.92,
        word_count: 5,
        language_detected: 'eng',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.extractText(Buffer.from('image'), 'scan.jpg');

      expect(result.text).toBe('Extracted legal text here');
      expect(result.confidence).toBe(0.92);
      expect(result.wordCount).toBe(5);
      expect(result.languageDetected).toBe('eng');
    });

    it('should pass language parameter', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          text: 'text',
          confidence: 0.9,
          word_count: 1,
          language_detected: 'fil',
        }),
      });

      await service.extractText(Buffer.from('image'), 'scan.jpg', 'fil');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8002/ocr/extract',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should throw on API error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: jest.fn().mockResolvedValue('Validation error'),
      });

      await expect(
        service.extractText(Buffer.from('image'), 'scan.jpg'),
      ).rejects.toThrow('OCR text extraction failed (422)');
    });
  });

  // ---- classifyDocument ----

  describe('classifyDocument', () => {
    it('should call classify endpoint and return mapped result', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          document_type: 'case',
          confidence: 0.95,
        }),
      });

      const result = await service.classifyDocument('This is a Supreme Court decision...');

      expect(result.documentType).toBe('case');
      expect(result.confidence).toBe(0.95);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8002/classify',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('should throw on API error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Server error'),
      });

      await expect(
        service.classifyDocument('text'),
      ).rejects.toThrow('Document classification failed (500)');
    });
  });

  // ---- extractCitations ----

  describe('extractCitations', () => {
    it('should call citations/extract endpoint and return mapped result', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          citations: ['G.R. No. 123456', 'A.M. No. 2020-01'],
          normalized_citations: ['G.R. No. 123456', 'A.M. No. 2020-01'],
        }),
      });

      const result = await service.extractCitations('Some legal text mentioning G.R. No. 123456');

      expect(result.citations).toHaveLength(2);
      expect(result.normalizedCitations).toHaveLength(2);
      expect(result.citations[0]).toBe('G.R. No. 123456');
    });

    it('should throw on API error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('Bad request'),
      });

      await expect(
        service.extractCitations('text'),
      ).rejects.toThrow('Citation extraction failed (400)');
    });
  });

  // ---- extractPdfText ----

  describe('extractPdfText', () => {
    it('should call pdf/extract endpoint and return mapped result', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          pages: [
            { page_number: 1, text: 'Page 1 text', word_count: 3, is_ocr: false },
            { page_number: 2, text: 'Page 2 text', word_count: 3, is_ocr: true },
          ],
          total_text: 'Page 1 text Page 2 text',
          total_word_count: 6,
          total_pages: 2,
          confidence: 0.88,
          language_detected: 'eng',
          has_text_layer: true,
        }),
      });

      const result = await service.extractPdfText(Buffer.from('pdf content'), 'document.pdf');

      expect(result.pages).toHaveLength(2);
      expect(result.pages[0].pageNumber).toBe(1);
      expect(result.pages[0].isOcr).toBe(false);
      expect(result.pages[1].isOcr).toBe(true);
      expect(result.totalPages).toBe(2);
      expect(result.totalWordCount).toBe(6);
      expect(result.hasTextLayer).toBe(true);
      expect(result.confidence).toBe(0.88);
    });

    it('should throw on API error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 413,
        text: jest.fn().mockResolvedValue('File too large'),
      });

      await expect(
        service.extractPdfText(Buffer.from('pdf'), 'huge.pdf'),
      ).rejects.toThrow('PDF extraction failed (413)');
    });
  });

  // ---- isHealthy ----

  describe('isHealthy', () => {
    it('should return true when health endpoint responds ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      const result = await service.isHealthy();
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8002/health',
        expect.objectContaining({}),
      );
    });

    it('should return false when health endpoint fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false });

      const result = await service.isHealthy();
      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.isHealthy();
      expect(result).toBe(false);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});

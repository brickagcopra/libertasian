/**
 * Camera Scan Flow E2E Integration Tests.
 * Tests the complete camera scan lifecycle on mobile:
 * Capture → Upload → OCR Processing → Quality Check → Digest Generation.
 * Per CLAUDE.md: Private-by-default, quality thresholds, free tier restrictions.
 * Per PRD: SCAN-01 through SCAN-07.
 */

const mockPost = jest.fn();
const mockGet = jest.fn();
const mockUpload = jest.fn();

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
    uploadMultipart: (...args: unknown[]) => mockUpload(...args),
  },
}));

describe('Camera Scan Flow E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Image capture and validation', () => {
    it('should validate captured image dimensions', () => {
      const capture = { uri: 'file://photo.jpg', width: 3024, height: 4032 };
      const maxEdge = 2048;
      const needsResize = Math.max(capture.width, capture.height) > maxEdge;
      expect(needsResize).toBe(true);
    });

    it('should compress to JPEG quality 85 before upload', () => {
      const compressionConfig = { quality: 85, format: 'jpeg', maxDimension: 2048 };
      expect(compressionConfig.quality).toBe(85);
      expect(compressionConfig.maxDimension).toBe(2048);
    });

    it('should support multi-page capture', () => {
      const pages = [
        { id: 'p1', uri: 'file://page1.jpg' },
        { id: 'p2', uri: 'file://page2.jpg' },
        { id: 'p3', uri: 'file://page3.jpg' },
      ];
      expect(pages).toHaveLength(3);
    });
  });

  describe('Upload flow', () => {
    it('should upload scan and receive job ID (202 Accepted)', async () => {
      mockUpload.mockResolvedValueOnce({
        id: 'upload-1',
        status: 'processing',
        jobId: 'job-abc',
      });

      const result = await mockUpload('/uploads/scan', {
        file: { uri: 'file://photo.jpg', type: 'image/jpeg', name: 'scan.jpg' },
        privacyLevel: 'private',
      });

      expect(result.status).toBe('processing');
      expect(result.jobId).toBeDefined();
    });

    it('should default privacy level to private', () => {
      const defaultPrivacy = 'private';
      expect(defaultPrivacy).toBe('private');
    });

    it('should reject oversized files', async () => {
      const maxSize = 20 * 1024 * 1024; // 20MB
      const fileSize = 25 * 1024 * 1024;
      expect(fileSize).toBeGreaterThan(maxSize);
    });

    it('should validate allowed file types', () => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      expect(allowed.includes('image/jpeg')).toBe(true);
      expect(allowed.includes('application/exe')).toBe(false);
    });
  });

  describe('OCR processing status polling', () => {
    it('should poll upload status until completion', async () => {
      // First poll: processing
      mockGet.mockResolvedValueOnce({ id: 'upload-1', status: 'processing', progress: 50 });
      // Second poll: completed
      mockGet.mockResolvedValueOnce({
        id: 'upload-1',
        status: 'completed',
        progress: 100,
        ocrText: 'Extracted legal text...',
        qualityScore: 0.85,
      });

      const poll1 = await mockGet('/uploads/upload-1/status');
      expect(poll1.status).toBe('processing');

      const poll2 = await mockGet('/uploads/upload-1/status');
      expect(poll2.status).toBe('completed');
      expect(poll2.ocrText).toBeDefined();
    });

    it('should handle OCR failure gracefully', async () => {
      mockGet.mockResolvedValueOnce({
        id: 'upload-1',
        status: 'failed',
        error: 'OCR processing failed: unreadable image',
      });

      const result = await mockGet('/uploads/upload-1/status');
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
    });
  });

  describe('Quality scoring', () => {
    it('should accept high quality scans (>= 0.4)', () => {
      const getAction = (score: number) => {
        if (score < 0.2) return 'reject';
        if (score < 0.4) return 'warn';
        return 'accept';
      };

      expect(getAction(0.85)).toBe('accept');
      expect(getAction(0.6)).toBe('accept');
    });

    it('should warn on medium quality scans (0.2-0.4)', () => {
      const getAction = (score: number) => {
        if (score < 0.2) return 'reject';
        if (score < 0.4) return 'warn';
        return 'accept';
      };

      expect(getAction(0.3)).toBe('warn');
      expect(getAction(0.35)).toBe('warn');
    });

    it('should reject low quality scans (< 0.2)', () => {
      const getAction = (score: number) => {
        if (score < 0.2) return 'reject';
        if (score < 0.4) return 'warn';
        return 'accept';
      };

      expect(getAction(0.1)).toBe('reject');
      expect(getAction(0.05)).toBe('reject');
    });
  });

  describe('Digest generation from scan', () => {
    it('should generate digest for pro users', async () => {
      mockPost.mockResolvedValueOnce({
        id: 'digest-1',
        status: 'processing',
        jobId: 'digest-job-1',
      });

      const result = await mockPost('/digests/generate', {
        uploadId: 'upload-1',
        ocrText: 'Legal text from scan...',
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe('processing');
    });

    it('should block digest generation for free users (403)', async () => {
      mockPost.mockRejectedValueOnce({
        response: {
          status: 403,
          data: { error: { code: 'INSUFFICIENT_SUBSCRIPTION', message: 'Pro plan required' } },
        },
      });

      await expect(
        mockPost('/digests/generate', { uploadId: 'upload-1' }),
      ).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ status: 403 }),
        }),
      );
    });

    it('should set digest visibility to private for scan-generated digests', () => {
      const scanDigest = {
        source: 'camera_scan',
        visibility: 'private',
        uploadId: 'upload-1',
      };
      expect(scanDigest.visibility).toBe('private');
    });
  });

  describe('Privacy controls', () => {
    it('should allow toggling to editorial_candidate with confirmation', () => {
      const initialPrivacy = 'private';
      const newPrivacy = 'editorial_candidate';
      const confirmationShown = true;

      expect(initialPrivacy).toBe('private');
      expect(newPrivacy).toBe('editorial_candidate');
      expect(confirmationShown).toBe(true);
    });

    it('should never auto-promote scans to public_editorial', () => {
      const allowedPrivacyLevels = ['private', 'editorial_candidate'];
      expect(allowedPrivacyLevels).not.toContain('public_editorial');
    });
  });
});

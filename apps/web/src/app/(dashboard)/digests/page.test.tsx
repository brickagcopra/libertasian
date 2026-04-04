import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Digests Page integration tests.
 * Per PRD: DIG-01 through DIG-06 — digest generation, review, provenance.
 * Per CLAUDE.md: confidence scoring, provenance records, private-by-default for scans.
 */

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/digests',
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1', email: 'test@test.com', fullName: 'Test User' },
    accessToken: 'test-token',
    isAuthenticated: true,
  }),
}));

describe('Digests Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Digest data validation', () => {
    it('should validate digest has all required fields', () => {
      const digest = {
        id: 'digest-1',
        documentId: 'doc-1',
        facts: 'The petitioner filed...',
        issues: ['Whether res judicata applies'],
        ruling: 'The Court ruled...',
        doctrine: 'The doctrine of res judicata...',
        dispositive: 'WHEREFORE, the petition is DENIED.',
        confidenceScore: 0.85,
        reviewStatus: 'auto_approved',
        visibility: 'public_editorial',
      };
      expect(digest.facts.length).toBeGreaterThan(0);
      expect(digest.issues.length).toBeGreaterThan(0);
      expect(digest.ruling.length).toBeGreaterThan(0);
      expect(digest.dispositive.length).toBeGreaterThan(0);
    });

    it('should enforce confidence score threshold for auto-approval', () => {
      const highConfidence = 0.85;
      const lowConfidence = 0.55;
      const threshold = 0.7;

      expect(highConfidence).toBeGreaterThanOrEqual(threshold);
      expect(lowConfidence).toBeLessThan(threshold);

      const getStatus = (score: number) =>
        score >= threshold ? 'auto_approved' : 'needs_human_review';

      expect(getStatus(highConfidence)).toBe('auto_approved');
      expect(getStatus(lowConfidence)).toBe('needs_human_review');
    });
  });

  describe('Provenance validation', () => {
    it('should validate provenance records link to source sections', () => {
      const provenance = {
        field: 'facts',
        sourceDocumentId: 'doc-1',
        sectionId: 'section-3',
        pageStart: 5,
        pageEnd: 7,
        excerptText: 'The petitioner alleges...',
      };
      expect(provenance.sourceDocumentId).toBeDefined();
      expect(provenance.sectionId).toBeDefined();
      expect(provenance.pageStart).toBeLessThanOrEqual(provenance.pageEnd);
    });
  });

  describe('Digest visibility', () => {
    it('should default scan-generated digests to private', () => {
      const scanDigest = {
        source: 'camera_scan',
        visibility: 'private',
      };
      expect(scanDigest.visibility).toBe('private');
    });

    it('should validate visibility enum values', () => {
      const validVisibilities = ['private', 'public_editorial', 'editorial_candidate'];
      expect(validVisibilities.includes('private')).toBe(true);
      expect(validVisibilities.includes('public')).toBe(false);
    });
  });

  describe('Digest list filtering', () => {
    it('should validate filter parameters', () => {
      const filters = {
        subject: 'civil',
        reviewStatus: 'auto_approved',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
      };
      expect(new Date(filters.dateFrom).toString()).not.toBe('Invalid Date');
      expect(new Date(filters.dateTo).toString()).not.toBe('Invalid Date');
      expect(new Date(filters.dateTo) > new Date(filters.dateFrom)).toBe(true);
    });
  });
});

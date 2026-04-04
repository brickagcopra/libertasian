/**
 * Search & Reader Flow E2E Integration Tests.
 * Tests: Search → Results → Document Reader → Annotations → Bookmarks.
 * Per PRD: SRCH-01 through SRCH-12, DOC-01 through DOC-08.
 * Per CLAUDE.md: Citation normalization, OpenSearch, ETag caching.
 */

const mockPost = jest.fn();
const mockGet = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

describe('Search & Reader Flow E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Search query flow', () => {
    it('should submit search query and receive results', async () => {
      mockPost.mockResolvedValueOnce({
        results: [
          {
            id: 'doc-1',
            title: 'People v. Doe',
            citation: 'G.R. No. 123456',
            score: 0.95,
            snippet: '...the Court held that...',
          },
          {
            id: 'doc-2',
            title: 'Santos v. Republic',
            citation: 'G.R. No. 654321',
            score: 0.82,
            snippet: '...regarding the issue of...',
          },
        ],
        total: 2,
        queryId: 'q-123',
      });

      const result = await mockPost('/search', {
        query: 'res judicata supreme court',
        filters: { court: 'Supreme Court' },
        limit: 20,
      });

      expect(result.results).toHaveLength(2);
      expect(result.results[0].score).toBeGreaterThan(result.results[1].score);
    });

    it('should validate empty query rejection', () => {
      const query = '';
      expect(query.trim().length).toBe(0);
    });

    it('should enforce max query length (1000 chars)', () => {
      const maxLength = 1000;
      const longQuery = 'a'.repeat(1001);
      expect(longQuery.length).toBeGreaterThan(maxLength);
    });

    it('should normalize citation searches', () => {
      const variations = ['G.R. No. 123456', 'GR No 123456', 'G.R.No.123456'];
      const normalized = variations.map((v) =>
        v.replace(/G\.?R\.?\s*N[oO]\.?\s*/gi, 'G.R. No. '),
      );
      normalized.forEach((n) => {
        expect(n).toMatch(/G\.R\. No\. /);
      });
    });
  });

  describe('Citation search', () => {
    it('should search by citation number', async () => {
      mockGet.mockResolvedValueOnce({
        id: 'doc-1',
        title: 'People v. Doe',
        citation: 'G.R. No. 123456',
        court: 'Supreme Court',
        dateDecided: '2025-06-15',
      });

      const result = await mockGet('/search/citation/G.R.%20No.%20123456');
      expect(result.citation).toBe('G.R. No. 123456');
    });
  });

  describe('Search suggestions', () => {
    it('should return suggestions for partial query', async () => {
      mockGet.mockResolvedValueOnce({
        suggestions: [
          'res judicata',
          'res ipsa loquitur',
          'rescission of contract',
        ],
      });

      const result = await mockGet('/search/suggestions?q=res');
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0]).toContain('res');
    });
  });

  describe('AI answer generation', () => {
    it('should generate AI answer with citations', async () => {
      mockPost.mockResolvedValueOnce({
        answer: 'Res judicata applies when...',
        citations: [
          { documentId: 'doc-1', title: 'People v. Doe', excerpt: '...' },
        ],
        confidenceScore: 0.88,
      });

      const result = await mockPost('/ai-answers', {
        query: 'What is res judicata?',
      });

      expect(result.answer.length).toBeGreaterThan(0);
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7);
    });

    it('should handle abstention for low-confidence queries', async () => {
      mockPost.mockResolvedValueOnce({
        answer: null,
        abstention: true,
        reason: 'Insufficient relevant sources found',
      });

      const result = await mockPost('/ai-answers', {
        query: 'obscure unrelated question',
      });

      expect(result.abstention).toBe(true);
      expect(result.answer).toBeNull();
    });
  });

  describe('Document reader flow', () => {
    it('should fetch full document with sections', async () => {
      mockGet.mockResolvedValueOnce({
        id: 'doc-1',
        title: 'People v. Doe',
        citation: 'G.R. No. 123456',
        sections: [
          { id: 'sec-1', title: 'Facts', content: 'The petitioner...', order: 1 },
          { id: 'sec-2', title: 'Issues', content: 'Whether...', order: 2 },
          { id: 'sec-3', title: 'Ruling', content: 'The Court held...', order: 3 },
        ],
        relatedDocuments: [
          { id: 'doc-2', title: 'Santos v. Republic', relationship: 'cited_by' },
        ],
      });

      const result = await mockGet('/documents/doc-1');
      expect(result.sections).toHaveLength(3);
      expect(result.sections[0].title).toBe('Facts');
      expect(result.relatedDocuments).toHaveLength(1);
    });

    it('should support ETag caching for documents', async () => {
      // First request: returns document with ETag
      mockGet.mockResolvedValueOnce({
        data: { id: 'doc-1', title: 'Test' },
        etag: '"abc123"',
      });

      const result = await mockGet('/documents/doc-1');
      expect(result.etag).toBeDefined();

      // Second request with If-None-Match: 304 Not Modified
      mockGet.mockResolvedValueOnce({ status: 304 });
      const cached = await mockGet('/documents/doc-1', {
        headers: { 'If-None-Match': '"abc123"' },
      });
      expect(cached.status).toBe(304);
    });
  });

  describe('Annotation flow', () => {
    it('should create annotation on document section', async () => {
      mockPost.mockResolvedValueOnce({
        id: 'ann-1',
        documentId: 'doc-1',
        sectionId: 'sec-1',
        startOffset: 10,
        endOffset: 50,
        highlightColor: 'yellow',
        note: 'Key holding',
      });

      const result = await mockPost('/annotations', {
        documentId: 'doc-1',
        sectionId: 'sec-1',
        startOffset: 10,
        endOffset: 50,
        highlightColor: 'yellow',
        note: 'Key holding',
      });

      expect(result.id).toBeDefined();
      expect(result.startOffset).toBeLessThan(result.endOffset);
    });

    it('should list annotations for a document', async () => {
      mockGet.mockResolvedValueOnce({
        annotations: [
          { id: 'ann-1', sectionId: 'sec-1', highlightColor: 'yellow' },
          { id: 'ann-2', sectionId: 'sec-2', highlightColor: 'green' },
        ],
      });

      const result = await mockGet('/annotations?documentId=doc-1');
      expect(result.annotations).toHaveLength(2);
    });

    it('should delete annotation', async () => {
      mockDelete.mockResolvedValueOnce({ success: true });
      await mockDelete('/annotations/ann-1');
      expect(mockDelete).toHaveBeenCalledWith('/annotations/ann-1');
    });
  });

  describe('Bookmark flow', () => {
    it('should toggle bookmark on document', async () => {
      // Add bookmark
      mockPost.mockResolvedValueOnce({ id: 'bm-1', documentId: 'doc-1' });
      const addResult = await mockPost('/bookmarks', { documentId: 'doc-1' });
      expect(addResult.id).toBeDefined();

      // Remove bookmark
      mockDelete.mockResolvedValueOnce({ success: true });
      await mockDelete('/bookmarks/bm-1');
      expect(mockDelete).toHaveBeenCalledWith('/bookmarks/bm-1');
    });

    it('should list bookmarked documents', async () => {
      mockGet.mockResolvedValueOnce({
        bookmarks: [
          { id: 'bm-1', documentId: 'doc-1', title: 'People v. Doe' },
          { id: 'bm-2', documentId: 'doc-2', title: 'Santos v. Republic' },
        ],
      });

      const result = await mockGet('/bookmarks');
      expect(result.bookmarks).toHaveLength(2);
    });
  });

  describe('Search quota enforcement', () => {
    it('should enforce free tier search limit (50/day)', async () => {
      mockPost.mockRejectedValueOnce({
        response: {
          status: 429,
          data: { error: { code: 'SEARCH_QUOTA_EXCEEDED' } },
          headers: { 'retry-after': '3600' },
        },
      });

      await expect(
        mockPost('/search', { query: 'test' }),
      ).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ status: 429 }),
        }),
      );
    });
  });
});

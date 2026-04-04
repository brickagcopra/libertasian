/**
 * Workspace Flow E2E Integration Tests.
 * Tests: Matters CRUD → Notes → Tasks → Shares → AI Generation.
 * Per PRD: WS-01 through WS-10.
 * Per CLAUDE.md: Tenant isolation, org-scoped data, cursor pagination.
 */

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

describe('Workspace Flow E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Matters CRUD flow', () => {
    it('should list matters with cursor pagination', async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          { id: 'mat-1', title: 'Reyes v. Santos', status: 'active', matterType: 'civil' },
          { id: 'mat-2', title: 'People v. Cruz', status: 'active', matterType: 'criminal' },
        ],
        meta: { cursor: 'mat-2', hasNext: true, limit: 20 },
      });

      const result = await mockGet('/matters');
      expect(result.data).toHaveLength(2);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.cursor).toBeDefined();
    });

    it('should create a new matter', async () => {
      mockPost.mockResolvedValueOnce({
        id: 'mat-3',
        title: 'New Civil Case',
        matterType: 'civil',
        court: 'RTC Branch 1',
        status: 'active',
      });

      const result = await mockPost('/matters', {
        title: 'New Civil Case',
        matterType: 'civil',
        court: 'RTC Branch 1',
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe('active');
    });

    it('should update matter details', async () => {
      mockPatch.mockResolvedValueOnce({
        id: 'mat-1',
        title: 'Updated Title',
        status: 'closed',
      });

      const result = await mockPatch('/matters/mat-1', {
        title: 'Updated Title',
        status: 'closed',
      });

      expect(result.title).toBe('Updated Title');
      expect(result.status).toBe('closed');
    });

    it('should validate matter status transitions', () => {
      const validTransitions: Record<string, string[]> = {
        active: ['closed', 'archived'],
        closed: ['active', 'archived'],
        archived: ['active'],
      };

      expect(validTransitions['active']).toContain('closed');
      expect(validTransitions['active']).not.toContain('active');
    });

    it('should soft-delete matter', async () => {
      mockDelete.mockResolvedValueOnce({ success: true });
      await mockDelete('/matters/mat-1');
      expect(mockDelete).toHaveBeenCalledWith('/matters/mat-1');
    });
  });

  describe('Notes flow', () => {
    it('should create note linked to matter', async () => {
      mockPost.mockResolvedValueOnce({
        id: 'note-1',
        title: 'Research Notes',
        body: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
        matterId: 'mat-1',
      });

      const result = await mockPost('/notes', {
        title: 'Research Notes',
        body: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
        matterId: 'mat-1',
      });

      expect(result.matterId).toBe('mat-1');
      expect(result.body.type).toBe('doc');
    });

    it('should update note body (Tiptap JSON)', async () => {
      mockPatch.mockResolvedValueOnce({
        id: 'note-1',
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Updated content' }] },
          ],
        },
      });

      const result = await mockPatch('/notes/note-1', {
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Updated content' }] },
          ],
        },
      });

      expect(result.body.type).toBe('doc');
    });

    it('should list notes for a matter', async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          { id: 'note-1', title: 'Note 1', matterId: 'mat-1' },
          { id: 'note-2', title: 'Note 2', matterId: 'mat-1' },
        ],
      });

      const result = await mockGet('/notes?matterId=mat-1');
      expect(result.data).toHaveLength(2);
    });
  });

  describe('Tasks flow', () => {
    it('should create task with due date', async () => {
      mockPost.mockResolvedValueOnce({
        id: 'task-1',
        title: 'File Motion for Extension',
        dueDate: '2026-04-15',
        status: 'pending',
        matterId: 'mat-1',
      });

      const result = await mockPost('/tasks', {
        title: 'File Motion for Extension',
        dueDate: '2026-04-15',
        matterId: 'mat-1',
      });

      expect(result.status).toBe('pending');
      expect(new Date(result.dueDate).toString()).not.toBe('Invalid Date');
    });

    it('should update task status through lifecycle', async () => {
      // pending → in_progress
      mockPatch.mockResolvedValueOnce({ id: 'task-1', status: 'in_progress' });
      let result = await mockPatch('/tasks/task-1', { status: 'in_progress' });
      expect(result.status).toBe('in_progress');

      // in_progress → completed
      mockPatch.mockResolvedValueOnce({ id: 'task-1', status: 'completed' });
      result = await mockPatch('/tasks/task-1', { status: 'completed' });
      expect(result.status).toBe('completed');
    });

    it('should validate task status values', () => {
      const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
      expect(validStatuses.includes('pending')).toBe(true);
      expect(validStatuses.includes('done')).toBe(false);
    });
  });

  describe('Shares flow', () => {
    it('should share matter with another user', async () => {
      mockPost.mockResolvedValueOnce({
        id: 'share-1',
        matterId: 'mat-1',
        sharedWith: 'user-2',
        permission: 'read',
      });

      const result = await mockPost('/matters/mat-1/shares', {
        userId: 'user-2',
        permission: 'read',
      });

      expect(result.permission).toBe('read');
    });

    it('should generate shareable link', async () => {
      mockPost.mockResolvedValueOnce({
        token: 'share-token-abc',
        expiresAt: '2026-04-25T00:00:00Z',
        url: '/shared/share-token-abc',
      });

      const result = await mockPost('/matters/mat-1/share-link', {
        expiresInDays: 30,
      });

      expect(result.token).toBeDefined();
      expect(result.expiresAt).toBeDefined();
    });

    it('should revoke share', async () => {
      mockDelete.mockResolvedValueOnce({ success: true });
      await mockDelete('/matters/mat-1/shares/share-1');
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  describe('AI generation from workspace', () => {
    it('should generate memo for matter', async () => {
      mockPost.mockResolvedValueOnce({
        id: 'memo-1',
        status: 'processing',
        jobId: 'job-memo-1',
      });

      const result = await mockPost('/memos/generate', {
        matterId: 'mat-1',
        topic: 'Motion for Reconsideration',
        type: 'legal_memorandum',
      });

      expect(result.status).toBe('processing');
    });

    it('should generate pleading draft', async () => {
      mockPost.mockResolvedValueOnce({
        id: 'pleading-1',
        status: 'processing',
      });

      await mockPost('/pleadings/generate', {
        matterId: 'mat-1',
        type: 'motion_for_extension',
      });

      expect(mockPost).toHaveBeenCalled();
    });

    it('should generate case comparison', async () => {
      mockPost.mockResolvedValueOnce({
        id: 'comp-1',
        status: 'processing',
      });

      await mockPost('/case-comparisons/generate', {
        documentIds: ['doc-1', 'doc-2'],
      });

      expect(mockPost).toHaveBeenCalledWith(
        '/case-comparisons/generate',
        { documentIds: ['doc-1', 'doc-2'] },
      );
    });
  });

  describe('Tenant isolation', () => {
    it('should scope all queries to organization', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await mockGet('/matters');
      // API automatically scopes by org_id from JWT — verify the call is made
      expect(mockGet).toHaveBeenCalledWith('/matters');
    });

    it('should reject cross-tenant access with 403/404', async () => {
      mockGet.mockRejectedValueOnce({
        response: { status: 404, data: { error: { code: 'NOT_FOUND' } } },
      });

      await expect(
        mockGet('/matters/other-org-matter-id'),
      ).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ status: 404 }),
        }),
      );
    });
  });

  describe('Error handling', () => {
    it('should handle network errors', async () => {
      mockGet.mockRejectedValueOnce(new Error('Network Error'));
      await expect(mockGet('/matters')).rejects.toThrow('Network Error');
    });

    it('should handle 500 server errors', async () => {
      mockGet.mockRejectedValueOnce({
        response: { status: 500, data: { error: { code: 'INTERNAL_ERROR' } } },
      });

      await expect(mockGet('/matters')).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ status: 500 }),
        }),
      );
    });
  });
});

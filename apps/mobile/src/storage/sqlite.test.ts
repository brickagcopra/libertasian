import {
  saveCodal,
  getCachedCodal,
  getCachedSections,
  getCachedCodalsBySubject,
  removeCachedCodal,
  isCodalCached,
  getCacheStats,
  cleanStaleCodals,
  getAllCachedCodalIds,
  type CachedCodal,
  type CachedCodalSection,
} from './sqlite';

// Mock expo-sqlite
const mockRunAsync = jest.fn().mockResolvedValue(undefined);
const mockGetFirstAsync = jest.fn().mockResolvedValue(null);
const mockGetAllAsync = jest.fn().mockResolvedValue([]);
const mockExecAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync: (...args: unknown[]) => mockExecAsync(...args),
    runAsync: (...args: unknown[]) => mockRunAsync(...args),
    getFirstAsync: (...args: unknown[]) => mockGetFirstAsync(...args),
    getAllAsync: (...args: unknown[]) => mockGetAllAsync(...args),
  }),
}));

beforeEach(() => jest.clearAllMocks());

const makeCodal = (overrides: Partial<CachedCodal> = {}): CachedCodal => ({
  id: 'codal-1',
  subject: 'civil_law',
  title: 'Civil Code of the Philippines',
  shortTitle: 'Civil Code',
  documentType: 'statute',
  citationText: 'RA 386',
  promulgationDate: '1950-06-18',
  isOfficial: true,
  sectionCount: 2,
  cachedAt: new Date().toISOString(),
  ...overrides,
});

const makeSection = (overrides: Partial<CachedCodalSection> = {}): CachedCodalSection => ({
  id: 'section-1',
  codalId: 'codal-1',
  sectionType: 'article',
  sectionLabel: 'Article 1',
  ordering: 0,
  plainText: 'This Act shall be known as the Civil Code.',
  pageStart: 1,
  pageEnd: 1,
  ...overrides,
});

describe('saveCodal', () => {
  it('inserts codal and sections into database', async () => {
    const codal = makeCodal();
    const sections = [makeSection(), makeSection({ id: 'section-2', ordering: 1 })];

    await saveCodal(codal, sections);

    // 1 insert codal + 1 delete old sections + 2 insert sections = 4 calls
    expect(mockRunAsync).toHaveBeenCalledTimes(4);
    expect(mockRunAsync.mock.calls[0][0]).toContain('INSERT OR REPLACE INTO codals_cache');
    expect(mockRunAsync.mock.calls[1][0]).toContain('DELETE FROM codal_sections_cache');
  });
});

describe('getCachedCodal', () => {
  it('returns mapped codal when found', async () => {
    mockGetFirstAsync.mockResolvedValueOnce({
      id: 'codal-1',
      subject: 'civil_law',
      title: 'Civil Code',
      short_title: null,
      document_type: 'statute',
      citation_text: 'RA 386',
      promulgation_date: '1950-06-18',
      is_official: 1,
      section_count: 5,
      cached_at: '2026-03-01T00:00:00Z',
    });

    const result = await getCachedCodal('codal-1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('codal-1');
    expect(result!.isOfficial).toBe(true);
    expect(result!.shortTitle).toBeNull();
  });

  it('returns null when not found', async () => {
    mockGetFirstAsync.mockResolvedValueOnce(null);
    const result = await getCachedCodal('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getCachedSections', () => {
  it('returns mapped sections sorted by ordering', async () => {
    mockGetAllAsync.mockResolvedValueOnce([
      {
        id: 's1', codal_id: 'codal-1', section_type: 'article',
        section_label: 'Art. 1', ordering: 0, plain_text: 'text', page_start: 1, page_end: 1,
      },
      {
        id: 's2', codal_id: 'codal-1', section_type: 'article',
        section_label: 'Art. 2', ordering: 1, plain_text: 'text2', page_start: 2, page_end: 2,
      },
    ]);

    const result = await getCachedSections('codal-1');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('s1');
    expect(result[1].sectionLabel).toBe('Art. 2');
  });
});

describe('getCachedCodalsBySubject', () => {
  it('returns codals for a subject', async () => {
    mockGetAllAsync.mockResolvedValueOnce([
      {
        id: 'c1', subject: 'civil_law', title: 'Civil Code',
        short_title: null, document_type: 'statute', citation_text: null,
        promulgation_date: null, is_official: 1, section_count: 10,
        cached_at: '2026-03-01T00:00:00Z',
      },
    ]);

    const result = await getCachedCodalsBySubject('civil_law');
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('civil_law');
  });
});

describe('removeCachedCodal', () => {
  it('deletes sections then codal', async () => {
    await removeCachedCodal('codal-1');

    expect(mockRunAsync).toHaveBeenCalledTimes(2);
    expect(mockRunAsync.mock.calls[0][0]).toContain('DELETE FROM codal_sections_cache');
    expect(mockRunAsync.mock.calls[1][0]).toContain('DELETE FROM codals_cache');
  });
});

describe('isCodalCached', () => {
  it('returns true when count > 0', async () => {
    mockGetFirstAsync.mockResolvedValueOnce({ cnt: 1 });
    expect(await isCodalCached('codal-1')).toBe(true);
  });

  it('returns false when count is 0', async () => {
    mockGetFirstAsync.mockResolvedValueOnce({ cnt: 0 });
    expect(await isCodalCached('codal-1')).toBe(false);
  });
});

describe('getCacheStats', () => {
  it('returns stats from database', async () => {
    mockGetFirstAsync
      .mockResolvedValueOnce({ cnt: 5 })   // codals count
      .mockResolvedValueOnce({ cnt: 120 }) // sections count
      .mockResolvedValueOnce({ val: '2026-01-01T00:00:00Z' }) // oldest
      .mockResolvedValueOnce({ val: '2026-03-20T00:00:00Z' }); // newest

    const stats = await getCacheStats();

    expect(stats.totalCodals).toBe(5);
    expect(stats.totalSections).toBe(120);
    expect(stats.oldestCachedAt).toBe('2026-01-01T00:00:00Z');
    expect(stats.newestCachedAt).toBe('2026-03-20T00:00:00Z');
  });

  it('handles empty database', async () => {
    mockGetFirstAsync
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ cnt: 0 })
      .mockResolvedValueOnce({ val: null })
      .mockResolvedValueOnce({ val: null });

    const stats = await getCacheStats();

    expect(stats.totalCodals).toBe(0);
    expect(stats.totalSections).toBe(0);
    expect(stats.oldestCachedAt).toBeNull();
    expect(stats.newestCachedAt).toBeNull();
  });
});

describe('cleanStaleCodals', () => {
  it('removes codals older than maxAgeDays', async () => {
    const staleId = 'old-codal';
    mockGetAllAsync.mockResolvedValueOnce([{ id: staleId }]);

    const removed = await cleanStaleCodals(30);

    expect(removed).toBe(1);
    // 1 delete sections + 1 delete codal
    expect(mockRunAsync).toHaveBeenCalledTimes(2);
    expect(mockRunAsync).toHaveBeenCalledWith(
      'DELETE FROM codal_sections_cache WHERE codal_id = ?',
      staleId,
    );
    expect(mockRunAsync).toHaveBeenCalledWith(
      'DELETE FROM codals_cache WHERE id = ?',
      staleId,
    );
  });

  it('returns 0 when no stale codals', async () => {
    mockGetAllAsync.mockResolvedValueOnce([]);

    const removed = await cleanStaleCodals(30);

    expect(removed).toBe(0);
    expect(mockRunAsync).not.toHaveBeenCalled();
  });

  it('removes multiple stale codals', async () => {
    mockGetAllAsync.mockResolvedValueOnce([
      { id: 'old-1' },
      { id: 'old-2' },
      { id: 'old-3' },
    ]);

    const removed = await cleanStaleCodals(7);

    expect(removed).toBe(3);
    // 3 codals * 2 deletes each = 6 calls
    expect(mockRunAsync).toHaveBeenCalledTimes(6);
  });
});

describe('getAllCachedCodalIds', () => {
  it('returns all cached IDs', async () => {
    mockGetAllAsync.mockResolvedValueOnce([
      { id: 'c1' },
      { id: 'c2' },
      { id: 'c3' },
    ]);

    const ids = await getAllCachedCodalIds();
    expect(ids).toEqual(['c1', 'c2', 'c3']);
  });

  it('returns empty array when no cached codals', async () => {
    mockGetAllAsync.mockResolvedValueOnce([]);
    const ids = await getAllCachedCodalIds();
    expect(ids).toEqual([]);
  });
});

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { apiClient } from '../../../lib/api-client';
import { mmkvStorage } from '../../../storage/mmkv';
import * as sqliteModule from '../../../storage/sqlite';
import { useOfflineCodals } from './use-offline-codals';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn() },
}));

jest.mock('../../../storage/mmkv', () => ({
  mmkvStorage: {
    getString: jest.fn(),
    setString: jest.fn(),
  },
  STORAGE_KEYS: { OFFLINE_CODAL_IDS: 'offline_codal_ids' },
}));

jest.mock('../../../storage/sqlite', () => ({
  saveCodal: jest.fn().mockResolvedValue(undefined),
  removeCachedCodal: jest.fn().mockResolvedValue(undefined),
  getCachedCodal: jest.fn(),
  getCachedSections: jest.fn(),
  cleanStaleCodals: jest.fn().mockResolvedValue(0),
  getAllCachedCodalIds: jest.fn().mockResolvedValue([]),
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockGetString = mmkvStorage.getString as jest.MockedFunction<typeof mmkvStorage.getString>;
const mockSetString = mmkvStorage.setString as jest.MockedFunction<typeof mmkvStorage.setString>;
const mockGetCachedCodal = sqliteModule.getCachedCodal as jest.MockedFunction<typeof sqliteModule.getCachedCodal>;
const mockGetCachedSections = sqliteModule.getCachedSections as jest.MockedFunction<typeof sqliteModule.getCachedSections>;
const mockCleanStaleCodals = sqliteModule.cleanStaleCodals as jest.MockedFunction<typeof sqliteModule.cleanStaleCodals>;
const mockGetAllCachedIds = sqliteModule.getAllCachedCodalIds as jest.MockedFunction<typeof sqliteModule.getAllCachedCodalIds>;

beforeEach(() => jest.clearAllMocks());

describe('useOfflineCodals', () => {
  it('initializes offlineIds from MMKV', () => {
    mockGetString.mockReturnValue('["doc-1","doc-2"]');
    mockGetAllCachedIds.mockResolvedValue(['doc-1', 'doc-2']);
    const { result } = renderHook(() => useOfflineCodals());
    expect(result.current.offlineIds.has('doc-1')).toBe(true);
    expect(result.current.offlineIds.has('doc-2')).toBe(true);
  });

  it('returns empty set when MMKV is empty', () => {
    mockGetString.mockReturnValue(undefined);
    const { result } = renderHook(() => useOfflineCodals());
    expect(result.current.offlineIds.size).toBe(0);
  });

  it('isOffline returns correct value', () => {
    mockGetString.mockReturnValue('["doc-1"]');
    mockGetAllCachedIds.mockResolvedValue(['doc-1']);
    const { result } = renderHook(() => useOfflineCodals());
    expect(result.current.isOffline('doc-1')).toBe(true);
    expect(result.current.isOffline('doc-2')).toBe(false);
  });

  it('saveForOffline fetches and caches codal', async () => {
    mockGetString.mockReturnValue('[]');
    mockGetAllCachedIds.mockResolvedValue([]);
    mockGet.mockResolvedValueOnce({
      id: 'doc-1', title: 'Civil Code', shortTitle: null,
      documentType: 'statute', citationText: null, promulgationDate: null, isOfficial: true,
    });
    mockGet.mockResolvedValueOnce([
      { id: 's1', sectionType: 'article', sectionLabel: 'Art. 1', ordering: 0, plainText: 'text', pageStart: 1, pageEnd: 1 },
    ]);

    const { result } = renderHook(() => useOfflineCodals());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.saveForOffline('doc-1', 'civil_law');
    });

    expect(success).toBe(true);
    expect(mockGet).toHaveBeenCalledWith('/documents/doc-1');
    expect(mockGet).toHaveBeenCalledWith('/documents/doc-1/sections');
    expect(sqliteModule.saveCodal).toHaveBeenCalled();
    expect(mockSetString).toHaveBeenCalled();
    expect(result.current.offlineIds.has('doc-1')).toBe(true);
  });

  it('saveForOffline returns false and sets error on failure', async () => {
    mockGetString.mockReturnValue('[]');
    mockGetAllCachedIds.mockResolvedValue([]);
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useOfflineCodals());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.saveForOffline('doc-1', 'civil_law');
    });

    expect(success).toBe(false);
    expect(result.current.lastError).toBe('Network error');
    expect(result.current.offlineIds.has('doc-1')).toBe(false);
  });

  it('clearError clears lastError', async () => {
    mockGetString.mockReturnValue('[]');
    mockGetAllCachedIds.mockResolvedValue([]);
    mockGet.mockRejectedValueOnce(new Error('fail'));

    const { result } = renderHook(() => useOfflineCodals());

    await act(async () => {
      await result.current.saveForOffline('doc-1', 'civil_law');
    });

    expect(result.current.lastError).toBe('fail');

    act(() => {
      result.current.clearError();
    });

    expect(result.current.lastError).toBeNull();
  });

  it('removeOffline removes from cache', async () => {
    mockGetString.mockReturnValue('["doc-1"]');
    mockGetAllCachedIds.mockResolvedValue(['doc-1']);
    const { result } = renderHook(() => useOfflineCodals());

    // Wait for the async cleanup/reconciliation to finish
    await waitFor(() => {
      expect(mockCleanStaleCodals).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.removeOffline('doc-1');
    });

    expect(sqliteModule.removeCachedCodal).toHaveBeenCalledWith('doc-1');
    expect(result.current.offlineIds.has('doc-1')).toBe(false);
  });

  it('getOfflineCodal returns cached data', async () => {
    mockGetString.mockReturnValue('["doc-1"]');
    mockGetAllCachedIds.mockResolvedValue(['doc-1']);
    const mockCodal = { id: 'doc-1', title: 'Civil Code' };
    const mockSections = [{ id: 's1', codalId: 'doc-1' }];
    mockGetCachedCodal.mockResolvedValueOnce(mockCodal as never);
    mockGetCachedSections.mockResolvedValueOnce(mockSections as never);

    const { result } = renderHook(() => useOfflineCodals());
    let data: unknown;
    await act(async () => {
      data = await result.current.getOfflineCodal('doc-1');
    });

    expect(data).toEqual({ codal: mockCodal, sections: mockSections });
  });

  it('getOfflineCodal returns null when not cached', async () => {
    mockGetString.mockReturnValue('[]');
    mockGetAllCachedIds.mockResolvedValue([]);
    mockGetCachedCodal.mockResolvedValueOnce(null as never);

    const { result } = renderHook(() => useOfflineCodals());
    let data: unknown;
    await act(async () => {
      data = await result.current.getOfflineCodal('doc-1');
    });

    expect(data).toBeNull();
  });

  it('runs stale cleanup on mount and reconciles IDs', async () => {
    mockGetString.mockReturnValue('["doc-1","doc-2","stale-doc"]');
    mockCleanStaleCodals.mockResolvedValue(1); // 1 stale removed
    mockGetAllCachedIds.mockResolvedValue(['doc-1', 'doc-2']); // after cleanup

    const { result } = renderHook(() => useOfflineCodals());

    await waitFor(() => {
      expect(mockCleanStaleCodals).toHaveBeenCalledWith(30);
    });

    await waitFor(() => {
      expect(result.current.offlineIds.size).toBe(2);
      expect(result.current.offlineIds.has('stale-doc')).toBe(false);
    });
  });

  it('handles cleanup failure gracefully', async () => {
    mockGetString.mockReturnValue('["doc-1"]');
    mockCleanStaleCodals.mockRejectedValue(new Error('sqlite error'));

    const { result } = renderHook(() => useOfflineCodals());

    await waitFor(() => {
      expect(result.current.offlineIds.has('doc-1')).toBe(true);
    });
  });
});

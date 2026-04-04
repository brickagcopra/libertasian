import { renderHook, act } from '@testing-library/react-native';
import { mmkvStorage } from '../../../storage/mmkv';
import { useRecentlyViewed } from './use-recently-viewed';

jest.mock('../../../storage/mmkv', () => ({
  mmkvStorage: { getString: jest.fn(), setString: jest.fn() },
  STORAGE_KEYS: { RECENTLY_VIEWED: 'recently_viewed' },
}));

const mockGetString = mmkvStorage.getString as jest.MockedFunction<typeof mmkvStorage.getString>;
const mockSetString = mmkvStorage.setString as jest.MockedFunction<typeof mmkvStorage.setString>;

beforeEach(() => jest.clearAllMocks());

describe('useRecentlyViewed', () => {
  it('initializes with empty array when nothing stored', () => {
    mockGetString.mockReturnValue(undefined as unknown as string);
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.recentlyViewed).toEqual([]);
  });

  it('initializes from stored data', () => {
    const stored = [{ id: 'd1', title: 'Case', shortTitle: null, documentType: 'decision', grNo: null, court: null, viewedAt: '2024-01-01' }];
    mockGetString.mockReturnValue(JSON.stringify(stored));
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.recentlyViewed).toEqual(stored);
  });

  it('addEntry prepends and deduplicates', () => {
    mockGetString.mockReturnValue('[]');
    const { result } = renderHook(() => useRecentlyViewed());
    act(() => {
      result.current.addEntry({ id: 'd1', title: 'Case A', shortTitle: null, documentType: 'decision', grNo: null, court: null });
    });
    expect(result.current.recentlyViewed).toHaveLength(1);
    expect(result.current.recentlyViewed[0].id).toBe('d1');
    expect(mockSetString).toHaveBeenCalled();
  });

  it('addEntry moves existing entry to front', () => {
    const stored = [
      { id: 'd1', title: 'A', shortTitle: null, documentType: 'decision', grNo: null, court: null, viewedAt: '2024-01-01' },
      { id: 'd2', title: 'B', shortTitle: null, documentType: 'decision', grNo: null, court: null, viewedAt: '2024-01-02' },
    ];
    mockGetString.mockReturnValue(JSON.stringify(stored));
    const { result } = renderHook(() => useRecentlyViewed());
    act(() => {
      result.current.addEntry({ id: 'd2', title: 'B', shortTitle: null, documentType: 'decision', grNo: null, court: null });
    });
    expect(result.current.recentlyViewed[0].id).toBe('d2');
    expect(result.current.recentlyViewed).toHaveLength(2);
  });

  it('clearAll empties list and storage', () => {
    const stored = [{ id: 'd1', title: 'A', shortTitle: null, documentType: 'decision', grNo: null, court: null, viewedAt: '2024-01-01' }];
    mockGetString.mockReturnValue(JSON.stringify(stored));
    const { result } = renderHook(() => useRecentlyViewed());
    act(() => { result.current.clearAll(); });
    expect(result.current.recentlyViewed).toEqual([]);
    expect(mockSetString).toHaveBeenCalledWith('recently_viewed', '[]');
  });

  it('handles corrupted storage gracefully', () => {
    mockGetString.mockReturnValue('not-json{');
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.recentlyViewed).toEqual([]);
  });
});

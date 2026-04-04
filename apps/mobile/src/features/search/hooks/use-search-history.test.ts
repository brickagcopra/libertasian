import { renderHook, act } from '@testing-library/react-native';
import { mmkvStorage } from '../../../storage/mmkv';
import { useSearchHistory } from './use-search-history';

jest.mock('../../../storage/mmkv', () => ({
  mmkvStorage: { getString: jest.fn(), setString: jest.fn() },
  STORAGE_KEYS: { SEARCH_HISTORY: 'search_history' },
}));

const mockGetString = mmkvStorage.getString as jest.MockedFunction<typeof mmkvStorage.getString>;
const mockSetString = mmkvStorage.setString as jest.MockedFunction<typeof mmkvStorage.setString>;

beforeEach(() => jest.clearAllMocks());

describe('useSearchHistory', () => {
  it('initializes with empty array when nothing stored', () => {
    mockGetString.mockReturnValue(undefined as unknown as string);
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual([]);
  });

  it('initializes from stored data', () => {
    mockGetString.mockReturnValue(JSON.stringify(['query1', 'query2']));
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual(['query1', 'query2']);
  });

  it('addEntry prepends and deduplicates', () => {
    mockGetString.mockReturnValue(JSON.stringify(['old query']));
    const { result } = renderHook(() => useSearchHistory());
    act(() => { result.current.addEntry('new query'); });
    expect(result.current.history[0]).toBe('new query');
    expect(result.current.history).toHaveLength(2);
    expect(mockSetString).toHaveBeenCalled();
  });

  it('addEntry ignores empty/whitespace', () => {
    mockGetString.mockReturnValue('[]');
    const { result } = renderHook(() => useSearchHistory());
    act(() => { result.current.addEntry('   '); });
    expect(result.current.history).toEqual([]);
  });

  it('removeEntry removes specific query', () => {
    mockGetString.mockReturnValue(JSON.stringify(['a', 'b', 'c']));
    const { result } = renderHook(() => useSearchHistory());
    act(() => { result.current.removeEntry('b'); });
    expect(result.current.history).toEqual(['a', 'c']);
    expect(mockSetString).toHaveBeenCalled();
  });

  it('clearHistory empties list', () => {
    mockGetString.mockReturnValue(JSON.stringify(['a', 'b']));
    const { result } = renderHook(() => useSearchHistory());
    act(() => { result.current.clearHistory(); });
    expect(result.current.history).toEqual([]);
    expect(mockSetString).toHaveBeenCalledWith('search_history', '[]');
  });

  it('handles corrupted storage gracefully', () => {
    mockGetString.mockReturnValue('{bad json');
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual([]);
  });
});

jest.mock('react-native-mmkv', () => {
  const inst = {
    getString: jest.fn(),
    getBoolean: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    contains: jest.fn(),
    clearAll: jest.fn(),
  };
  return { MMKV: jest.fn(() => inst), __mockInstance: inst };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __mockInstance: m } = require('react-native-mmkv') as {
  __mockInstance: {
    getString: jest.Mock;
    getBoolean: jest.Mock;
    getNumber: jest.Mock;
    set: jest.Mock;
    delete: jest.Mock;
    contains: jest.Mock;
    clearAll: jest.Mock;
  };
};

import { mmkvStorage, STORAGE_KEYS, storage } from './mmkv';

beforeEach(() => {
  m.getString.mockReset();
  m.getBoolean.mockReset();
  m.getNumber.mockReset();
  m.set.mockReset();
  m.delete.mockReset();
  m.contains.mockReset();
  m.clearAll.mockReset();
});

describe('STORAGE_KEYS', () => {
  it('defines all expected keys', () => {
    expect(STORAGE_KEYS.RECENTLY_VIEWED).toBe('recently_viewed_docs');
    expect(STORAGE_KEYS.SEARCH_HISTORY).toBe('search_history');
    expect(STORAGE_KEYS.USER_PREFERENCES).toBe('user_preferences');
    expect(STORAGE_KEYS.CACHED_DIGESTS).toBe('cached_digests');
    expect(STORAGE_KEYS.STUDY_STATS).toBe('study_stats');
    expect(STORAGE_KEYS.FLASHCARD_PROGRESS).toBe('flashcard_progress');
    expect(STORAGE_KEYS.LAST_STUDY_SUBJECT).toBe('last_study_subject');
    expect(STORAGE_KEYS.OFFLINE_CODAL_IDS).toBe('offline_codal_ids');
    expect(STORAGE_KEYS.ONBOARDING_COMPLETED).toBe('onboarding_completed');
  });

  it('has 9 storage keys', () => {
    expect(Object.keys(STORAGE_KEYS)).toHaveLength(9);
  });
});

describe('mmkvStorage.getString', () => {
  it('returns string value for existing key', () => {
    m.getString.mockReturnValue('hello');
    expect(mmkvStorage.getString('test-key')).toBe('hello');
    expect(m.getString).toHaveBeenCalledWith('test-key');
  });

  it('returns undefined for missing key', () => {
    m.getString.mockReturnValue(undefined);
    expect(mmkvStorage.getString('missing')).toBeUndefined();
  });
});

describe('mmkvStorage.setString', () => {
  it('sets string value', () => {
    mmkvStorage.setString('key', 'value');
    expect(m.set).toHaveBeenCalledWith('key', 'value');
  });

  it('sets empty string', () => {
    mmkvStorage.setString('key', '');
    expect(m.set).toHaveBeenCalledWith('key', '');
  });
});

describe('mmkvStorage.getBoolean', () => {
  it('returns true for boolean key', () => {
    m.getBoolean.mockReturnValue(true);
    expect(mmkvStorage.getBoolean('flag')).toBe(true);
  });

  it('returns false', () => {
    m.getBoolean.mockReturnValue(false);
    expect(mmkvStorage.getBoolean('flag')).toBe(false);
  });

  it('returns undefined for unset key', () => {
    m.getBoolean.mockReturnValue(undefined);
    expect(mmkvStorage.getBoolean('unset')).toBeUndefined();
  });
});

describe('mmkvStorage.setBoolean', () => {
  it('sets boolean value', () => {
    mmkvStorage.setBoolean('flag', true);
    expect(m.set).toHaveBeenCalledWith('flag', true);
  });
});

describe('mmkvStorage.getNumber', () => {
  it('returns number value', () => {
    m.getNumber.mockReturnValue(42);
    expect(mmkvStorage.getNumber('count')).toBe(42);
  });

  it('returns 0 for zero value', () => {
    m.getNumber.mockReturnValue(0);
    expect(mmkvStorage.getNumber('zero')).toBe(0);
  });

  it('returns undefined for missing key', () => {
    m.getNumber.mockReturnValue(undefined);
    expect(mmkvStorage.getNumber('missing')).toBeUndefined();
  });
});

describe('mmkvStorage.setNumber', () => {
  it('sets numeric value', () => {
    mmkvStorage.setNumber('count', 99);
    expect(m.set).toHaveBeenCalledWith('count', 99);
  });

  it('sets zero', () => {
    mmkvStorage.setNumber('count', 0);
    expect(m.set).toHaveBeenCalledWith('count', 0);
  });
});

describe('mmkvStorage.delete', () => {
  it('deletes a key', () => {
    mmkvStorage.delete('old-key');
    expect(m.delete).toHaveBeenCalledWith('old-key');
  });
});

describe('mmkvStorage.contains', () => {
  it('returns true for existing key', () => {
    m.contains.mockReturnValue(true);
    expect(mmkvStorage.contains('existing')).toBe(true);
  });

  it('returns false for missing key', () => {
    m.contains.mockReturnValue(false);
    expect(mmkvStorage.contains('missing')).toBe(false);
  });
});

describe('mmkvStorage.clearAll', () => {
  it('clears all storage', () => {
    mmkvStorage.clearAll();
    expect(m.clearAll).toHaveBeenCalledTimes(1);
  });
});

describe('storage instance', () => {
  it('is exported and available', () => {
    expect(storage).toBeDefined();
  });
});

describe('JSON serialization patterns', () => {
  it('stores and retrieves JSON via string helpers', () => {
    const data = { items: ['a', 'b'], count: 2 };
    mmkvStorage.setString(STORAGE_KEYS.RECENTLY_VIEWED, JSON.stringify(data));
    expect(m.set).toHaveBeenCalledWith(
      'recently_viewed_docs',
      '{"items":["a","b"],"count":2}',
    );
  });

  it('parses JSON from getString', () => {
    const json = '{"ids":["c1","c2"]}';
    m.getString.mockReturnValue(json);
    const result = mmkvStorage.getString(STORAGE_KEYS.OFFLINE_CODAL_IDS);
    expect(JSON.parse(result!)).toEqual({ ids: ['c1', 'c2'] });
  });
});

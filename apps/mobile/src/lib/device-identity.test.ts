import { mmkvStorage, STORAGE_KEYS } from '../storage/mmkv';
import {
  deviceHeaders,
  generateUuidV4,
  getDeviceId,
  getDeviceName,
  resetDeviceIdCacheForTests,
} from './device-identity';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('device identity', () => {
  beforeEach(() => {
    mmkvStorage.delete(STORAGE_KEYS.DEVICE_ID);
    resetDeviceIdCacheForTests();
  });

  it('generates RFC 4122 v4 UUIDs', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateUuidV4()).toMatch(UUID_V4);
    }
  });

  it('creates the id once and persists it in MMKV', () => {
    const first = getDeviceId();
    expect(first).toMatch(UUID_V4);
    expect(mmkvStorage.getString(STORAGE_KEYS.DEVICE_ID)).toBe(first);

    resetDeviceIdCacheForTests();
    expect(getDeviceId()).toBe(first);
  });

  it('replaces a stored value that is not UUID-shaped', () => {
    mmkvStorage.setString(STORAGE_KEYS.DEVICE_ID, 'garbage');
    const id = getDeviceId();
    expect(id).toMatch(UUID_V4);
    expect(mmkvStorage.getString(STORAGE_KEYS.DEVICE_ID)).toBe(id);
  });

  it('builds a short, non-empty device label', () => {
    const name = getDeviceName();
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name).toMatch(/\(.+\)$/);
  });

  it('exposes both headers', () => {
    const headers = deviceHeaders();
    expect(headers['X-Device-Id']).toMatch(UUID_V4);
    expect(headers['X-Device-Name']).toBe(getDeviceName());
  });
});

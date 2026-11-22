import { mmkvStorage, STORAGE_KEYS } from '../storage/mmkv';
import {
  deviceHeaders,
  formatDeviceName,
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

  it('names Android "Android" even when the OS name is a build fingerprint', () => {
    // Samsung reports Build.VERSION.BASE_OS (a build fingerprint) as osName.
    expect(
      formatDeviceName({
        os: 'android',
        modelName: 'SM-A176U1',
        osName:
          'samsung/a17xue/a17x:16/BP4A.251205.006/A176U1UEU5BZEB_OYM5BZEB:user/release-keys',
        osVersion: '16',
        platformVersion: 36,
      }),
    ).toBe('SM-A176U1 (Android 16)');
  });

  it('keeps the reported OS name on iOS', () => {
    expect(
      formatDeviceName({
        os: 'ios',
        modelName: 'iPad Pro',
        osName: 'iPadOS',
        osVersion: '27.2',
        platformVersion: '27.2',
      }),
    ).toBe('iPad Pro (iPadOS 27.2)');
  });

  it('exposes both headers', () => {
    const headers = deviceHeaders();
    expect(headers['X-Device-Id']).toMatch(UUID_V4);
    expect(headers['X-Device-Name']).toBe(getDeviceName());
  });
});

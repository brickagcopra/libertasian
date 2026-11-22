import { beforeEach, describe, expect, it } from 'vitest';

import {
  describeUserAgent,
  deviceHeaders,
  generateUuidV4,
  getDeviceId,
  resetDeviceIdCacheForTests,
} from './device-identity';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('device identity', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDeviceIdCacheForTests();
  });

  it('generates v4 UUIDs', () => {
    expect(generateUuidV4()).toMatch(UUID_V4);
  });

  it('creates the id once and persists it in localStorage', () => {
    const first = getDeviceId();
    expect(first).toMatch(UUID_V4);
    resetDeviceIdCacheForTests();
    expect(getDeviceId()).toBe(first);
  });

  it('replaces a stored value that is not UUID-shaped', () => {
    window.localStorage.setItem('libertasian-device-id', 'garbage');
    expect(getDeviceId()).toMatch(UUID_V4);
  });

  it('sends both headers', () => {
    const headers = deviceHeaders();
    expect(headers['X-Device-Id']).toMatch(UUID_V4);
    expect(headers['X-Device-Name']).toBeTruthy();
  });

  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome on Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Safari on macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
    ['', 'Browser'],
  ])('labels %s as %s', (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });
});

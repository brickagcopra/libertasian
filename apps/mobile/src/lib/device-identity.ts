import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { mmkvStorage, STORAGE_KEYS } from '../storage/mmkv';

/**
 * Device identity sent with every API request.
 *
 * `X-Device-Id` is a random UUID generated once per install and kept in MMKV.
 * It is never derived from hardware: reinstalling the app (or deleting the
 * account, which clears MMKV) produces a new one. The API uses it to tell a
 * re-login on the same phone from a sign-in on a new device, and to count an
 * account's signed-in devices against its plan's limit.
 *
 * `X-Device-Name` is a short human label ("iPhone 15 (iOS 26.1)") shown back
 * to the user when they review where they are signed in. Built only from data
 * already on hand (expo-device, react-native Platform).
 */

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 120;

interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

/** RFC 4122 v4 UUID. Uses the platform CSPRNG when the runtime exposes one. */
export function generateUuidV4(): string {
  const cryptoApi = (globalThis as { crypto?: CryptoLike }).crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    // Hermes without a crypto global. The id is an identifier, not a secret
    // (it travels in a plain header), so non-cryptographic randomness is
    // acceptable here.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let cachedId: string | null = null;
let cachedName: string | null = null;

/** The install's device id, created and persisted on first use. Never throws. */
export function getDeviceId(): string {
  if (cachedId) return cachedId;
  try {
    const stored = mmkvStorage.getString(STORAGE_KEYS.DEVICE_ID);
    if (stored && UUID_SHAPE.test(stored)) {
      cachedId = stored;
      return stored;
    }
    const fresh = generateUuidV4();
    mmkvStorage.setString(STORAGE_KEYS.DEVICE_ID, fresh);
    cachedId = fresh;
    return fresh;
  } catch {
    // Storage unavailable: keep a per-launch id rather than failing requests.
    cachedId = generateUuidV4();
    return cachedId;
  }
}

/** Test-only: forget the memoised id so the next call re-reads storage. */
export function resetDeviceIdCacheForTests(): void {
  cachedId = null;
  cachedName = null;
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Drop control characters; the API treats a label containing them as absent.
  const printable = Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  const trimmed = printable.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface DeviceNameInput {
  os: string;
  modelName: unknown;
  osName: unknown;
  osVersion: unknown;
  platformVersion: unknown;
}

/** Pure formatter behind {@link getDeviceName}; exported for tests. */
export function formatDeviceName(input: DeviceNameInput): string {
  const { os } = input;
  const fallbackModel =
    os === 'ios' ? 'iPhone' : os === 'android' ? 'Android device' : 'Device';
  const model = clean(input.modelName) ?? fallbackModel;
  // Android is always "Android". expo-device's `osName` there is
  // `Build.VERSION.BASE_OS` when non-empty, and Samsung fills that with the
  // full build fingerprint ("samsung/a17xue/a17x:16/BP4A…:user/release-keys"),
  // which then showed up verbatim in "Your devices". iOS keeps the reported
  // name so iPads read "iPadOS".
  const osName =
    os === 'android'
      ? 'Android'
      : (clean(input.osName) ?? (os === 'ios' ? 'iOS' : os));
  const osVersion = clean(input.osVersion) ?? clean(String(input.platformVersion));
  const label = osVersion ? `${model} (${osName} ${osVersion})` : `${model} (${osName})`;
  return label.slice(0, MAX_NAME_LENGTH);
}

/** Short label such as "iPhone 15 (iOS 26.1)" or "Pixel 8 (Android 15)". */
export function getDeviceName(): string {
  if (cachedName) return cachedName;
  cachedName = formatDeviceName({
    os: Platform.OS,
    modelName: Device.modelName,
    osName: Device.osName,
    osVersion: Device.osVersion,
    platformVersion: Platform.Version,
  });
  return cachedName;
}

/** Headers identifying this install to the API. */
export function deviceHeaders(): Record<string, string> {
  return {
    'X-Device-Id': getDeviceId(),
    'X-Device-Name': getDeviceName(),
  };
}

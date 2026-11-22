import type { Request } from 'express';

/** Header carrying the client's random per-install / per-browser id. */
export const DEVICE_ID_HEADER = 'x-device-id';
/** Header carrying a short human label such as "Chrome on Windows". */
export const DEVICE_NAME_HEADER = 'x-device-name';

/** Column widths in `refresh_tokens` (device_id VARCHAR(64), device_name VARCHAR(120)). */
export const DEVICE_NAME_MAX_LENGTH = 120;

export interface DeviceIdentity {
  deviceId: string | null;
  deviceName: string | null;
}

export const NO_DEVICE: DeviceIdentity = { deviceId: null, deviceName: null };

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Printable ASCII plus printable Unicode; rejects control characters. */
const PRINTABLE = /^[^\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]+$/u;

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A UUID-shaped device id, lowercased; anything else is treated as absent. */
export function parseDeviceId(raw: string | string[] | undefined): string | null {
  const value = firstHeader(raw)?.trim();
  if (!value || !UUID_SHAPE.test(value)) return null;
  return value.toLowerCase();
}

/**
 * A trimmed device label of at most 120 printable characters. Anything
 * longer, empty or containing control characters is treated as absent
 * rather than rejected — the label is cosmetic and must never block sign-in.
 */
export function parseDeviceName(raw: string | string[] | undefined): string | null {
  const value = firstHeader(raw)?.trim();
  if (!value || value.length > DEVICE_NAME_MAX_LENGTH || !PRINTABLE.test(value)) {
    return null;
  }
  return value;
}

/** Read and validate both device headers from a request. Never throws. */
export function readDeviceIdentity(req: Request | null | undefined): DeviceIdentity {
  const headers = req?.headers;
  if (!headers) return NO_DEVICE;
  return {
    deviceId: parseDeviceId(headers[DEVICE_ID_HEADER]),
    deviceName: parseDeviceName(headers[DEVICE_NAME_HEADER]),
  };
}

import type { ReadAlongKind, ReadAlongManifest, ReadAlongSegment } from '../types';

const KINDS: readonly ReadAlongKind[] = ['title', 'heading', 'sentence'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isKind(value: unknown): value is ReadAlongKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

/** Coerce one raw object into a {@link ReadAlongSegment}, or null if malformed. */
function toSegment(raw: unknown): ReadAlongSegment | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (
    typeof m['id'] !== 'string' ||
    !isKind(m['kind']) ||
    typeof m['sectionKey'] !== 'string' ||
    typeof m['text'] !== 'string' ||
    !isFiniteNumber(m['timeMs'])
  ) {
    return null;
  }
  return {
    id: m['id'],
    kind: m['kind'],
    sectionKey: m['sectionKey'],
    text: m['text'],
    timeMs: m['timeMs'],
  };
}

/**
 * Parse the `readalong.json` manifest fetched from its presigned S3 URL.
 *
 * Returns null when the payload is not a usable manifest (bad JSON, missing
 * `segments` array) so callers can gracefully fall back to plain text. Malformed
 * individual segments are dropped rather than failing the whole manifest, and
 * segments are sorted by `timeMs` (the server already orders them, but the
 * active-segment search assumes ascending order).
 */
export function parseReadAlong(json: string): ReadAlongManifest | null {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const root = obj as Record<string, unknown>;
  if (!Array.isArray(root['segments'])) return null;

  const segments = root['segments']
    .map(toSegment)
    .filter((s): s is ReadAlongSegment => s !== null)
    .sort((a, b) => a.timeMs - b.timeMs);

  return {
    version: isFiniteNumber(root['version']) ? root['version'] : 0,
    voiceId: typeof root['voiceId'] === 'string' ? root['voiceId'] : '',
    durationMs: isFiniteNumber(root['durationMs']) ? root['durationMs'] : null,
    segments,
  };
}

/**
 * Index of the segment active at `currentMs`, or -1 when none.
 *
 * Segments are assumed sorted ascending by `timeMs`. Returns the last segment
 * whose `timeMs <= currentMs` via binary search (O(log n)); -1 before the first
 * segment's onset or when there are no segments.
 */
export function activeSegmentIndex(
  segments: readonly ReadAlongSegment[],
  currentMs: number,
): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segments[mid];
    if (seg && seg.timeMs <= currentMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

import type { ParsedMarks, SentenceMark, WordMark } from '../types';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Parse newline-delimited JSON speech marks into typed word/sentence arrays.
 *
 * Each non-empty line is one JSON object, e.g.
 *   {"time":62,"type":"word","start":57,"end":63,"value":"Digest"}
 * Malformed lines (bad JSON, missing/!typed fields, unknown `type`) are skipped
 * rather than throwing — a single corrupt line must never blank the transcript.
 */
export function parseMarks(ndjson: string): ParsedMarks {
  const words: WordMark[] = [];
  const sentences: SentenceMark[] = [];

  for (const rawLine of ndjson.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;

    const m = obj as Record<string, unknown>;
    if (
      !isFiniteNumber(m['time']) ||
      !isFiniteNumber(m['start']) ||
      !isFiniteNumber(m['end']) ||
      typeof m['value'] !== 'string'
    ) {
      continue;
    }

    if (m['type'] === 'word') {
      words.push({
        time: m['time'],
        type: 'word',
        start: m['start'],
        end: m['end'],
        value: m['value'],
      });
    } else if (m['type'] === 'sentence') {
      sentences.push({
        time: m['time'],
        type: 'sentence',
        start: m['start'],
        end: m['end'],
        value: m['value'],
      });
    }
  }

  return { words, sentences };
}

/**
 * Index of the word currently being spoken at `currentMs`, or -1 when none.
 *
 * Words are assumed sorted ascending by `time` (Polly emits them in order).
 * Returns the last word whose `time <= currentMs`; -1 before the first word's
 * onset or when there are no words.
 */
export function activeWordIndex(words: WordMark[], currentMs: number): number {
  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word && word.time <= currentMs) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}

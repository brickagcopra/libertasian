/**
 * Split a long section into overlapping search chunks.
 *
 * Measured on prod 2026-09-29: 79,285 of ~113K published decision sections
 * exceed 1,800 characters, and every consumer downstream sees only their start
 * — bge-small embeds ~512 tokens, the vector `text_snippet` held 500 chars, the
 * reranker reads `p.text[:1000]` and RAG passages `[:2000]`. A holding in the
 * second half of a long ruling was invisible to search. Chunking gives each
 * part of the section its own keyword row and its own vector.
 *
 * Both indices and both write paths (live `indexLegalDocument`, the rebuild's
 * `reindexKeywordFromPostgres`, and the vector backfill via
 * `buildVectorEmbeddingInputs`) call `chunkSection` and nothing else, so a
 * keyword chunk and its vector share an `_id` and fuse in RRF.
 *
 * Pure and deterministic: the same text always yields the same chunks, which
 * is what makes chunk `_id`s (`{sectionId}:c{n}`) idempotent overwrites and
 * lets the stale-row sweep compare id sets.
 */

import type { IndexDocumentPayload } from './opensearch.service';

/** Sections at or under this length are indexed whole, as one row. */
export const CHUNK_MIN_SECTION_LENGTH = 1_800;

/** Target chunk length before boundary snapping. */
export const CHUNK_TARGET_LENGTH = 1_500;

/** Characters each chunk repeats from the end of the previous one. */
export const CHUNK_OVERLAP = 150;

/** How far a boundary may move from its target to land on a sentence end. */
export const CHUNK_SNAP_WINDOW = 200;

export interface SectionChunk {
  /** 0-based position within the section. */
  index: number;
  /** Offset into the section's `plainText` (inclusive). */
  charStart: number;
  /** Offset into the section's `plainText` (exclusive). */
  charEnd: number;
  /** Exactly `plainText.slice(charStart, charEnd)`. */
  text: string;
}

/**
 * Tokens that end in a period without ending a sentence. Legal text is dense
 * with them ("G.R. No. 12345", "Art. III", "Sec. 5", "People v. Cruz"), and a
 * boundary after one would split a citation from its number.
 */
const ABBREVIATIONS = new Set([
  'no', 'nos', 'art', 'arts', 'sec', 'secs', 'par', 'pars', 'para', 'ch',
  'vol', 'p', 'pp', 'v', 'vs', 'id', 'cf', 'et', 'al', 'inc', 'co', 'corp',
  'ltd', 'jr', 'sr', 'mr', 'mrs', 'ms', 'dr', 'atty', 'hon', 'gen', 'rep',
  'sen', 'gov', 'st', 'sta', 'sto', 'phil', 'scra', 'ca', 'rtc', 'mtc',
  'resp', 'petr', 'approx', 'viz', 'etc',
]);

const CLOSERS = new Set(['"', "'", ')', ']', '”', '’']);

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/**
 * True when a sentence ends at `pos` — i.e. `text.slice(0, pos)` ends with
 * terminal punctuation (optionally followed by closing quotes/brackets), the
 * next character is whitespace, and the next word starts like a sentence.
 */
function isSentenceEnd(text: string, pos: number): boolean {
  if (!isWhitespace(text[pos])) return false;

  let p = pos - 1;
  while (p >= 0 && CLOSERS.has(text[p]!)) p--;
  const punct = text[p];
  if (punct !== '.' && punct !== '!' && punct !== '?') return false;

  if (punct === '.') {
    // The word before the period: an abbreviation or a single letter (an
    // initial, or one link of "G.R.") does not end a sentence.
    let w = p - 1;
    while (w >= 0 && /[A-Za-z.]/.test(text[w]!)) w--;
    const word = text.slice(w + 1, p).toLowerCase();
    if (word.length <= 1 || ABBREVIATIONS.has(word)) return false;
    if (word.includes('.')) return false; // "g.r", "s.c", "u.s"
  }

  let n = pos;
  while (n < text.length && isWhitespace(text[n])) n++;
  if (n >= text.length) return true;
  return /[A-Z"'(\[“‘]/.test(text[n]!);
}

/** The allowed boundary nearest `target`; ties go to the earlier position. */
function nearest(
  text: string,
  target: number,
  lo: number,
  hi: number,
  accept: (text: string, pos: number) => boolean,
): number | null {
  for (let d = 0; d <= CHUNK_SNAP_WINDOW; d++) {
    const before = target - d;
    if (before >= lo && before <= hi && accept(text, before)) return before;
    const after = target + d;
    if (d > 0 && after >= lo && after <= hi && accept(text, after)) return after;
  }
  return null;
}

const isWordBreak = (text: string, pos: number) => isWhitespace(text[pos]);

/**
 * Chunk a section's text. Returns `[]` for a section of
 * `CHUNK_MIN_SECTION_LENGTH` chars or fewer — callers index those whole.
 *
 * Otherwise: chunks of ~`CHUNK_TARGET_LENGTH` chars, each starting
 * ~`CHUNK_OVERLAP` chars before the previous one ended, every end boundary
 * snapped to the nearest sentence end within ±`CHUNK_SNAP_WINDOW` chars
 * (falling back to the nearest whitespace, then to the exact target).
 */
export function chunkSection(text: string): SectionChunk[] {
  const length = text.length;
  if (length <= CHUNK_MIN_SECTION_LENGTH) return [];

  const chunks: SectionChunk[] = [];
  let start = 0;
  while (start < length) {
    const target = start + CHUNK_TARGET_LENGTH;
    let end: number;
    if (target + CHUNK_SNAP_WINDOW >= length) {
      // Close enough to the end that a snapped boundary would leave a sliver:
      // the remainder becomes the last chunk.
      end = length;
    } else {
      // A boundary must leave room for the overlap to move forward.
      const lo = Math.max(start + CHUNK_OVERLAP + 1, target - CHUNK_SNAP_WINDOW);
      const hi = target + CHUNK_SNAP_WINDOW;
      end =
        nearest(text, target, lo, hi, isSentenceEnd) ??
        nearest(text, target, lo, hi, isWordBreak) ??
        target;
    }

    // Drop trailing whitespace from the chunk; the offsets still index `text`.
    let trimmedEnd = end;
    while (trimmedEnd > start && isWhitespace(text[trimmedEnd - 1])) trimmedEnd--;

    chunks.push({
      index: chunks.length,
      charStart: start,
      charEnd: trimmedEnd,
      text: text.slice(start, trimmedEnd),
    });
    if (end >= length) break;

    // Next chunk starts ~CHUNK_OVERLAP before this end, on a word start.
    const overlapTarget = end - CHUNK_OVERLAP;
    const breakAt = nearest(text, overlapTarget, start + 1, end - 1, isWordBreak);
    let next = breakAt ?? overlapTarget;
    while (next < length && isWhitespace(text[next])) next++;
    // Guarantee forward progress whatever the snapping did.
    start = next > start ? next : end;
  }
  return chunks;
}

/** The keyword/vector `_id` of one chunk row. */
export function chunkRowId(sectionId: string, chunkIndex: number): string {
  return `${sectionId}:c${chunkIndex}`;
}

/**
 * The `_id` of any keyword or vector row: `{sectionId}:c{n}` for a chunk,
 * `section_id` for a whole section, `document_id` for the document row.
 * Derived from the row's own identity, so every write is an idempotent
 * overwrite. The single definition — every write path and the stale-row
 * sweep go through it.
 */
export function indexRowId(row: {
  document_id: string;
  section_id?: string;
  chunk_index?: number;
}): string {
  if (row.section_id === undefined) return row.document_id;
  return row.chunk_index === undefined
    ? row.section_id
    : chunkRowId(row.section_id, row.chunk_index);
}

/**
 * The keyword-index rows for one section: one row for a section of
 * `CHUNK_MIN_SECTION_LENGTH` chars or fewer, otherwise one row per chunk
 * (`section_text` = the chunk, with its offsets). Empty for a section with no
 * text. Shared by the live path and the rebuild so the two cannot drift.
 */
export function sectionKeywordRows(
  base: IndexDocumentPayload,
  section: { id: string; sectionType: string; plainText: string | null },
): IndexDocumentPayload[] {
  if (!section.plainText) return [];
  const row: IndexDocumentPayload = {
    ...base,
    section_id: section.id,
    section_type: section.sectionType,
    section_text: section.plainText,
    plain_text: undefined,
  };
  const chunks = chunkSection(section.plainText);
  if (chunks.length === 0) return [row];
  return chunks.map((chunk) => ({
    ...row,
    section_text: chunk.text,
    chunk_index: chunk.index,
    char_start: chunk.charStart,
    char_end: chunk.charEnd,
  }));
}

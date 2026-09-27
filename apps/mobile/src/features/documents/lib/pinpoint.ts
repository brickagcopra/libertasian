/**
 * Reader pinpoint: locate a quoted passage (the reader's `highlight` route
 * param) inside a section's text so the reader can mark it and scroll to it.
 *
 * Port of the web matcher (apps/web/src/features/documents/lib/pinpoint.ts);
 * KEEP THE MATCHING RULES IN SYNC. Quotes come from Deep Research's verifier
 * and are verbatim, but whitespace, curly quotes, dashes and case can still
 * differ from the stored text. Both sides are normalised and the match is
 * mapped back to offsets in the ORIGINAL text. Pure JS: no native module.
 */

export interface PinpointRange {
  start: number;
  end: number;
}

/** A long quote whose tail drifted still anchors on its opening words. */
const PREFIX_FALLBACK_CHARS = 60;
const MIN_NEEDLE = 3;

/**
 * Ellipses, straight quotes and whitespace wrapping an excerpt (the web's
 * `/^(?:\.{3}|…|["'\s])+/`). The quote marks come from char codes because the
 * no-purchase-copy scanner reads a bare quote character in a regex literal as
 * a string delimiter.
 */
const QUOTE_MARKS = String.fromCharCode(34, 39);
const WRAP_START = new RegExp(`^(?:\\.{3}|…|[${QUOTE_MARKS}\\s])+`);
const WRAP_END = new RegExp(`(?:\\.{3}|…|[${QUOTE_MARKS}\\s])+$`);

function foldChar(ch: string): string {
  switch (ch) {
    case '‘':
    case '’':
    case '‛':
    case '′':
      return "'";
    case '“':
    case '”':
    case '„':
    case '″':
      return '"';
    case '‐':
    case '‑':
    case '‒':
    case '–':
    case '—':
    case '−':
      return '-';
    default:
      return ch.toLowerCase();
  }
}

/** Normalised text plus, per normalised char, its index in the input. */
export function normalizeWithMap(input: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (/\s/.test(ch)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += ' ';
      map.push(i - 1);
      pendingSpace = false;
    }
    for (const c of foldChar(ch)) {
      text += c;
      map.push(i);
    }
  }
  return { text, map };
}

/** Normalise a quote and drop the ellipses / quote marks that wrap excerpts. */
export function normalizeQuote(quote: string): string {
  return normalizeWithMap(quote).text.replace(WRAP_START, '').replace(WRAP_END, '');
}

/** First normalised occurrence of `quote` in `text`, as original offsets. */
export function findPinpoint(text: string, quote: string | null | undefined): PinpointRange | null {
  if (!quote) return null;
  const needle = normalizeQuote(quote);
  if (needle.length < MIN_NEEDLE) return null;
  const hay = normalizeWithMap(text);

  let at = hay.text.indexOf(needle);
  let length = needle.length;
  if (at === -1 && needle.length > PREFIX_FALLBACK_CHARS) {
    const prefix = needle.slice(0, PREFIX_FALLBACK_CHARS).trimEnd();
    at = hay.text.indexOf(prefix);
    length = prefix.length;
  }
  if (at === -1) return null;

  const start = hay.map[at] as number;
  const end = (hay.map[at + length - 1] as number) + 1;
  return { start, end };
}

/**
 * The section to pinpoint: the `section` param when it names a loaded
 * section, else the first section whose text contains the quote (same rule
 * as the web reader's `usePinpointTarget`).
 */
export function resolvePinpointSectionId(
  sections: ReadonlyArray<{ id: string; plainText?: string | null }> | undefined,
  sectionParam: string | null | undefined,
  quote: string | null | undefined,
): string | null {
  if (!sections || (!quote && !sectionParam)) return null;
  if (sectionParam && sections.some((s) => s.id === sectionParam)) return sectionParam;
  if (!quote) return null;
  const hit = sections.find((s) => findPinpoint(s.plainText ?? '', quote));
  return hit?.id ?? null;
}

/**
 * The part of a section-level pinpoint that falls inside one paragraph, as
 * offsets relative to that paragraph. A quote spanning a paragraph break is
 * marked in each paragraph it touches. Null when they do not overlap.
 */
export function paragraphPinpointRange(
  paragraphOffset: number | undefined,
  paragraphLength: number,
  pin: PinpointRange | null,
): PinpointRange | null {
  if (!pin || paragraphOffset === undefined) return null;
  const start = Math.max(pin.start, paragraphOffset);
  const end = Math.min(pin.end, paragraphOffset + paragraphLength);
  if (end <= start) return null;
  return { start: start - paragraphOffset, end: end - paragraphOffset };
}

/** First route-param value (expo-router may hand an array for repeated keys). */
export function firstParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : null;
}

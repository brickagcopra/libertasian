/**
 * Reader pinpoint: locate a quoted passage (`?highlight=`) inside a section's
 * text so the reader can wrap it in <mark> and scroll to it.
 *
 * Quotes come from Deep Research's verifier and are verbatim, but the reader
 * renders `cleanLegalText(plainText)`, so whitespace, curly quotes, dashes and
 * case can all differ. Both sides are normalised and the match is mapped back
 * to offsets in the ORIGINAL text.
 */

export interface PinpointRange {
  start: number;
  end: number;
}

/** A long quote whose tail drifted still anchors on its opening words. */
const PREFIX_FALLBACK_CHARS = 60;
const MIN_NEEDLE = 3;

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
  return normalizeWithMap(quote)
    .text.replace(/^(?:\.{3}|…|["'\s])+/, '')
    .replace(/(?:\.{3}|…|["'\s])+$/, '');
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

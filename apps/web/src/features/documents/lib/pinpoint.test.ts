import { describe, expect, it } from 'vitest';

import { findPinpoint, normalizeQuote } from './pinpoint';

const TEXT =
  'The Court held that  the accused’s right to counsel\nwas violated. Thus, the “extrajudicial confession” is inadmissible.';

function slice(text: string, quote: string) {
  const r = findPinpoint(text, quote);
  return r ? text.slice(r.start, r.end) : null;
}

describe('findPinpoint', () => {
  it('finds an exact quote', () => {
    expect(slice(TEXT, 'was violated')).toBe('was violated');
  });

  it('ignores case, whitespace runs, newlines and curly quotes', () => {
    expect(slice(TEXT, "THE ACCUSED'S RIGHT TO COUNSEL WAS")).toBe(
      'the accused’s right to counsel\nwas',
    );
  });

  it('maps back to the original offsets', () => {
    const r = findPinpoint(TEXT, 'the "extrajudicial confession"');
    expect(r).not.toBeNull();
    expect(TEXT.slice(r!.start, r!.end)).toBe('the “extrajudicial confession');
  });

  it('strips wrapping ellipses and quote marks from the excerpt', () => {
    expect(normalizeQuote('...Thus, the rule…')).toBe('thus, the rule');
    expect(slice(TEXT, '…is inadmissible.')).toBe('is inadmissible.');
  });

  it('returns null for no match, empty or too-short quotes', () => {
    expect(findPinpoint(TEXT, 'not in the text')).toBeNull();
    expect(findPinpoint(TEXT, '')).toBeNull();
    expect(findPinpoint(TEXT, null)).toBeNull();
    expect(findPinpoint(TEXT, 'a')).toBeNull();
  });

  it('falls back to the opening words of a long quote whose tail drifted', () => {
    const long =
      'The Court held that the accused’s right to counsel was violated. Thus, the confession obtained is void.';
    const r = findPinpoint(TEXT, long);
    expect(r?.start).toBe(0);
  });

  it('returns the FIRST occurrence', () => {
    expect(findPinpoint('ab x ab', 'ab x')?.start).toBe(0);
    expect(findPinpoint('foo bar foo bar', 'foo bar')).toEqual({ start: 0, end: 7 });
  });
});

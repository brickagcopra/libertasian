import {
  findPinpoint,
  firstParam,
  normalizeQuote,
  paragraphPinpointRange,
  resolvePinpointSectionId,
} from './pinpoint';

// Mirrors apps/web/src/features/documents/lib/pinpoint.test.ts so the two
// matchers cannot drift apart silently.
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

  it('folds en/em dashes and minus signs to a hyphen', () => {
    const text = 'Art. 3 — the rule applies to pages 10–12.';
    expect(slice(text, 'art. 3 - the rule applies to pages 10-12')).toBe(
      'Art. 3 — the rule applies to pages 10–12',
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
    expect(findPinpoint(TEXT, undefined)).toBeNull();
    expect(findPinpoint(TEXT, 'a')).toBeNull();
  });

  it('falls back to the first 60 chars of a long quote whose tail drifted', () => {
    const long =
      'The Court held that the accused’s right to counsel was violated. Thus, the confession obtained is void.';
    const r = findPinpoint(TEXT, long);
    expect(r?.start).toBe(0);
    // Only the 60-char prefix is marked, not the drifted tail.
    expect(TEXT.slice(r!.start, r!.end)).toBe('The Court held that  the accused’s right to counsel\nwas viola');
  });

  it('does not use the prefix fallback for a short quote', () => {
    expect(findPinpoint(TEXT, 'The Court held that nothing')).toBeNull();
  });

  it('returns the FIRST occurrence', () => {
    expect(findPinpoint('ab x ab', 'ab x')?.start).toBe(0);
    expect(findPinpoint('foo bar foo bar', 'foo bar')).toEqual({ start: 0, end: 7 });
  });
});

describe('resolvePinpointSectionId', () => {
  const SECTIONS = [
    { id: 's1', plainText: 'Facts of the case.' },
    { id: 's2', plainText: 'The doctrine of estoppel is based on public policy.' },
  ];

  it('uses the section param when it names a loaded section', () => {
    expect(resolvePinpointSectionId(SECTIONS, 's1', 'estoppel')).toBe('s1');
  });

  it('falls back to the first section containing the quote', () => {
    expect(resolvePinpointSectionId(SECTIONS, 'unknown', 'DOCTRINE of Estoppel')).toBe('s2');
    expect(resolvePinpointSectionId(SECTIONS, null, 'doctrine of estoppel')).toBe('s2');
  });

  it('is null without params, sections or a match', () => {
    expect(resolvePinpointSectionId(SECTIONS, null, null)).toBeNull();
    expect(resolvePinpointSectionId(undefined, 's1', 'x')).toBeNull();
    expect(resolvePinpointSectionId(SECTIONS, 'unknown', null)).toBeNull();
    expect(resolvePinpointSectionId(SECTIONS, null, 'not anywhere')).toBeNull();
  });
});

describe('paragraphPinpointRange', () => {
  it('maps a section range into paragraph-relative offsets', () => {
    expect(paragraphPinpointRange(10, 20, { start: 12, end: 18 })).toEqual({ start: 2, end: 8 });
  });

  it('clips a range spanning a paragraph break to each side', () => {
    const pin = { start: 15, end: 40 };
    expect(paragraphPinpointRange(0, 20, pin)).toEqual({ start: 15, end: 20 });
    expect(paragraphPinpointRange(22, 30, pin)).toEqual({ start: 0, end: 18 });
  });

  it('is null when there is no overlap, no pin or no offset', () => {
    expect(paragraphPinpointRange(0, 10, { start: 10, end: 20 })).toBeNull();
    expect(paragraphPinpointRange(0, 10, null)).toBeNull();
    expect(paragraphPinpointRange(undefined, 10, { start: 0, end: 5 })).toBeNull();
  });
});

describe('firstParam', () => {
  it('unwraps arrays and drops empty values', () => {
    expect(firstParam('a')).toBe('a');
    expect(firstParam(['b', 'c'])).toBe('b');
    expect(firstParam('')).toBeNull();
    expect(firstParam(undefined)).toBeNull();
    expect(firstParam([])).toBeNull();
  });
});

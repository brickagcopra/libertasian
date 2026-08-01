import { buildSectionQueue, hasSectionAudio } from './section-audio';

describe('hasSectionAudio', () => {
  it('is true for the statutory types the API narrates per section', () => {
    // Mirrors the API's reconciler tier 4 (CODAL_DOCUMENT_TYPES).
    for (const type of [
      'codal',
      'constitution',
      'republic_act',
      'presidential_decree',
      'executive_order',
      'rules_of_court',
    ]) {
      expect(hasSectionAudio(type)).toBe(true);
    }
  });

  it('is false for decisions, which are narrated whole', () => {
    expect(hasSectionAudio('decision')).toBe(false);
    expect(hasSectionAudio('bar_exam_questions')).toBe(false);
  });

  it('is false for codal-class types OUTSIDE the narrated set', () => {
    // The reader's local CODAL_DOCUMENT_TYPES (digest-UI gate) is broader than
    // this one. Conflating them would offer Listen where no rendition exists.
    expect(hasSectionAudio('statute')).toBe(false);
    expect(hasSectionAudio('commonwealth_act')).toBe(false);
    expect(hasSectionAudio('batas_pambansa')).toBe(false);
  });

  it('is false when the document type is missing', () => {
    expect(hasSectionAudio(null)).toBe(false);
    expect(hasSectionAudio(undefined)).toBe(false);
    expect(hasSectionAudio('')).toBe(false);
  });

  it('keys on document TYPE, never on a hardcoded id list', () => {
    // The four large documents motivated the feature, but 24 published
    // statutory documents are sectioned and a twenty-fifth would be too.
    expect(hasSectionAudio('republic_act')).toBe(true);
  });
});

describe('buildSectionQueue', () => {
  it('orders by `ordering`, not by array position', () => {
    expect(
      buildSectionQueue([
        { id: 'c', ordering: 3 },
        { id: 'a', ordering: 1 },
        { id: 'b', ordering: 2 },
      ]),
    ).toEqual(['a', 'b', 'c']);
  });

  it('de-duplicates repeated ids', () => {
    // `handleEnded` walks by indexOf, which always returns the FIRST match — a
    // repeated id would let the chain bounce between two positions forever.
    expect(
      buildSectionQueue([
        { id: 'a', ordering: 1 },
        { id: 'b', ordering: 2 },
        { id: 'a', ordering: 3 },
        { id: 'c', ordering: 4 },
      ]),
    ).toEqual(['a', 'b', 'c']);
  });

  it('treats a missing ordering as 0 rather than dropping the section', () => {
    expect(buildSectionQueue([{ id: 'b', ordering: 5 }, { id: 'a' }])).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns an empty queue for no sections', () => {
    expect(buildSectionQueue(null)).toEqual([]);
    expect(buildSectionQueue(undefined)).toEqual([]);
    expect(buildSectionQueue([])).toEqual([]);
  });

  it('drops sections with no text, so the chain never enqueues an empty one', () => {
    // Prod has 2 such sections of 4,857 — the backfill skipped them, and the
    // chain's warm-up GET is what would enqueue synthesis for them.
    expect(
      buildSectionQueue([
        { id: 'a', ordering: 1, plainText: 'Article 1.' },
        { id: 'b', ordering: 2, plainText: '' },
        { id: 'c', ordering: 3, plainText: null },
        { id: 'd', ordering: 4, plainText: '   \n ' },
        { id: 'e', ordering: 5, plainText: 'Article 5.' },
      ]),
    ).toEqual(['a', 'e']);
  });

  it('keeps sections whose text the caller did not supply', () => {
    // `plainText` absent ≠ empty: the caller simply is not carrying the body.
    expect(buildSectionQueue([{ id: 'a', ordering: 1 }])).toEqual(['a']);
  });
});

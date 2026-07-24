import { deriveGrNoDigits, normalizeCitationKey } from './citation-utils';

describe('deriveGrNoDigits', () => {
  it.each([
    ['G.R. No. 246999', '246999'],
    ['G.R. Nos. 205528-29', '205528-29'],
    ['A.M. No. SCC-15-21-P', '15-21'],
    ['A.C. No. 12345', '12345'],
    ['UDK-16915', '16915'],
    ['GR 246999', '246999'],
    ['  G.R. No. 246999  ', '246999'],
  ])('derives %s → %s', (input, expected) => {
    expect(deriveGrNoDigits(input)).toBe(expected);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['letters only', 'G.R. No.'],
    ['hyphens only', '---'],
  ])('returns undefined for %s so no empty keyword is indexed', (_label, input) => {
    expect(deriveGrNoDigits(input)).toBeUndefined();
  });

  it('collapses repeated hyphens rather than emitting an unmatchable key', () => {
    expect(deriveGrNoDigits('G.R. No. 205528--29')).toBe('205528-29');
  });
});

describe('normalizeCitationKey', () => {
  it('mirrors the citation_normalizer: lowercase, strip . , and whitespace', () => {
    expect(normalizeCitationKey('G.R. No. 246999')).toBe('grno246999');
    expect(normalizeCitationKey('People v. Santos, G.R. No. 1')).toBe(
      'peoplevsantosgrno1',
    );
  });

  it('is stable across the punctuation variants users actually type', () => {
    const canonical = normalizeCitationKey('G.R. No. 246999');
    expect(normalizeCitationKey('GR No 246999')).toBe(canonical);
    expect(normalizeCitationKey('g.r.no.246999')).toBe(canonical);
  });

  it('returns an empty string for nullish input', () => {
    expect(normalizeCitationKey(null)).toBe('');
    expect(normalizeCitationKey(undefined)).toBe('');
  });
});

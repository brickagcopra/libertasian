import { describe, expect, it } from 'vitest';

import {
  DERIVATIVE_TYPES,
  SUBJECTS,
  subjectFromCode,
  subjectFromSlug,
  typeFromEnum,
  typeFromSlug,
} from './taxonomy';

describe('taxonomy', () => {
  it('has all 11 derivative types', () => {
    expect(DERIVATIVE_TYPES).toHaveLength(11);
  });

  it('has all 8 study_8 subjects', () => {
    expect(SUBJECTS).toHaveLength(8);
    expect(SUBJECTS.map((s) => s.code).sort()).toEqual([
      'civil_law',
      'criminal_law',
      'labor_law',
      'legal_ethics',
      'mercantile_law',
      'political_law',
      'remedial_law',
      'taxation',
    ]);
  });

  it('every derivative type has a unique slug', () => {
    const slugs = DERIVATIVE_TYPES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every subject has a unique slug', () => {
    const slugs = SUBJECTS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('typeFromSlug round-trips for every type', () => {
    for (const t of DERIVATIVE_TYPES) {
      expect(typeFromSlug(t.slug)?.enum).toBe(t.enum);
    }
  });

  it('typeFromEnum round-trips for every type', () => {
    for (const t of DERIVATIVE_TYPES) {
      expect(typeFromEnum(t.enum)?.slug).toBe(t.slug);
    }
  });

  it('subjectFromSlug round-trips for every subject', () => {
    for (const s of SUBJECTS) {
      expect(subjectFromSlug(s.slug)?.code).toBe(s.code);
    }
  });

  it('subjectFromCode round-trips for every subject', () => {
    for (const s of SUBJECTS) {
      expect(subjectFromCode(s.code)?.slug).toBe(s.slug);
    }
  });

  it('returns undefined for unknown slugs', () => {
    expect(typeFromSlug('not-a-type')).toBeUndefined();
    expect(subjectFromSlug('not-a-subject')).toBeUndefined();
  });
});

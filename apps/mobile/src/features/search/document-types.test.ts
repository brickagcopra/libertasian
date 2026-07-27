import { DOCUMENT_TYPE_GROUPS } from '@libertasian/types';
import {
  DEFAULT_SEARCH_FILTER_LABEL,
  SEARCH_FILTER_LABELS,
  documentTypeFilter,
  kindFor,
  kindLabelFor,
} from './document-types';

describe('search filter chips', () => {
  it('derives its labels from the shared groups', () => {
    expect(SEARCH_FILTER_LABELS).toEqual(DOCUMENT_TYPE_GROUPS.map((g) => g.label));
    expect(DEFAULT_SEARCH_FILTER_LABEL).toBe('All');
  });

  it('omits documentType entirely for "All"', () => {
    const filter = documentTypeFilter('All');
    expect(filter).toEqual({});
    expect('documentType' in filter).toBe(false);
  });

  it('sends the full concrete type array for a group', () => {
    expect(documentTypeFilter('Decisions')).toEqual({ documentType: ['decision'] });
    expect(documentTypeFilter('Rules')).toEqual({
      documentType: [
        'rules_of_court',
        'rule',
        'resolution',
        'administrative_matter',
        'administrative_case',
      ],
    });
    expect(documentTypeFilter('Statutes').documentType).toContain('republic_act');
    expect(documentTypeFilter('Bar Q&A')).toEqual({
      documentType: ['bar_exam_questions'],
    });
  });

  it('never sends a legacy abstract value (zero rows in production)', () => {
    const sent = SEARCH_FILTER_LABELS.flatMap(
      (label) => documentTypeFilter(label).documentType ?? [],
    );
    for (const legacy of ['case', 'statute', 'article', 'outline']) {
      expect(sent).not.toContain(legacy);
    }
  });

  it('omits documentType for an unknown label', () => {
    expect(documentTypeFilter('Outlines')).toEqual({});
  });
});

describe('result badges', () => {
  it('renders decisions as CASE / DECISION', () => {
    expect(kindFor('decision')).toBe('CASE');
    expect(kindLabelFor('decision')).toBe('DECISION');
  });

  it('classes rules and administrative matters as CASE', () => {
    expect(kindFor('rules_of_court')).toBe('CASE');
    expect(kindFor('rule')).toBe('CASE');
    expect(kindFor('resolution')).toBe('CASE');
    expect(kindFor('administrative_matter')).toBe('CASE');
    expect(kindFor('administrative_case')).toBe('CASE');
    expect(kindLabelFor('administrative_matter')).toBe('ADMINISTRATIVE MATTER');
  });

  it('classes every statute-group type as STATUTE', () => {
    const statutes =
      DOCUMENT_TYPE_GROUPS.find((g) => g.label === 'Statutes')?.types ?? [];
    expect(statutes.length).toBeGreaterThan(0);
    for (const type of statutes) expect(kindFor(type)).toBe('STATUTE');
    expect(kindLabelFor('republic_act')).toBe('REPUBLIC ACT');
  });

  it('classes bar questions and unknown types as ARTICLE', () => {
    expect(kindFor('bar_exam_questions')).toBe('ARTICLE');
    expect(kindFor('something_new')).toBe('ARTICLE');
  });

  it('falls back to the coarse kind when the type has no label', () => {
    expect(kindLabelFor('something_new')).toBe('ARTICLE');
  });
});

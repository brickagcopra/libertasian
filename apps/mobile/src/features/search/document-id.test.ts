import { legalDocumentIdOf } from './document-id';
import type { SearchResultItem } from './types';

function hit(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    id: 'section-uuid',
    score: 1,
    source: {
      document_id: 'document-uuid',
      title: 'People v. Reyes',
      document_type: 'decision',
      is_official: true,
      is_published: true,
      created_at: '2024-01-01T00:00:00Z',
      section_id: 'section-uuid',
    },
    ...overrides,
  };
}

describe('legalDocumentIdOf', () => {
  it('returns source.document_id when the OpenSearch _id is a section id', () => {
    expect(legalDocumentIdOf(hit())).toBe('document-uuid');
  });

  it('returns source.document_id for document-level hits too', () => {
    const item = hit({ id: 'document-uuid' });
    delete item.source.section_id;
    expect(legalDocumentIdOf(item)).toBe('document-uuid');
  });

  it('falls back to the _id when source.document_id is absent', () => {
    const item = hit();
    // The API always sends document_id; guard against a malformed payload.
    (item.source as { document_id?: string }).document_id = undefined;
    expect(legalDocumentIdOf(item)).toBe('section-uuid');
  });
});

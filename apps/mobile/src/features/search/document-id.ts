import type { SearchResultItem } from './types';

/**
 * The legal document id for a search hit.
 *
 * `item.id` is the OpenSearch `_id`, which
 * `apps/api/src/modules/search/opensearch.service.ts:511` sets to
 * `section_id ?? document_id`. Section-level rows are the large majority of the
 * index, so for most hits `item.id` is a SECTION uuid and passing it to any
 * endpoint that expects a legal document id yields "Document not found".
 *
 * `item.source.document_id` is always the real document id. Use this helper
 * anywhere a search hit is treated as a document (reader navigation, digest
 * generation, `documentIds` payloads). Keep using `item.id` only where the
 * OpenSearch `_id` itself is wanted.
 */
export function legalDocumentIdOf(item: SearchResultItem): string {
  return item.source.document_id ?? item.id;
}

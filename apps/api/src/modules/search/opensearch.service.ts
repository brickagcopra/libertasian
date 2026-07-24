import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';

import { deriveGrNoDigits, normalizeCitationKey } from './citation-utils';
import {
  DEFAULT_EMBEDDING_DIM,
  INDEX_TOPOLOGY,
  KEYWORD_INDEX,
  USER_UPLOADS_INDEX,
  VECTOR_INDEX,
} from './index-mappings';

/**
 * Index names per PDD Section 4.4. These are ALIASES — the data lives in
 * versioned physical indices (`*_v2`). See `index-mappings.ts`.
 */
export {
  INDEX_VERSION,
  KEYWORD_INDEX,
  VECTOR_INDEX,
  USER_UPLOADS_INDEX,
  KEYWORD_INDEX_PHYSICAL,
  VECTOR_INDEX_PHYSICAL,
  USER_UPLOADS_INDEX_PHYSICAL,
} from './index-mappings';

export interface UserUploadIndexPayload {
  upload_id: string;
  organization_id: string;
  user_id: string;
  ocr_text: string;
  original_filename?: string;
  classified_document_type?: string;
  upload_type: string;
  mime_type?: string;
  privacy_level: string;
  extracted_citations?: string[];
  created_at: string;
}

export interface UserUploadSearchOptions {
  query: string;
  organizationId: string;
  filters?: {
    documentType?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  from?: number;
  size?: number;
}

export interface IndexDocumentPayload {
  document_id: string;
  section_id?: string;
  title: string;
  short_title?: string;
  citation_text?: string;
  plain_text?: string;
  section_text?: string;
  document_type: string;
  court?: string;
  ponente?: string;
  jurisdiction?: string;
  language?: string;
  status: string;
  gr_no?: string;
  /**
   * Digits-and-hyphens-only form of `gr_no`. Derived automatically by
   * `OpenSearchService` at index time — callers do not need to set it.
   */
  gr_no_digits?: string;
  docket_no?: string;
  source_id?: string;
  source_trust_level?: string;
  is_official: boolean;
  is_published: boolean;
  section_type?: string;
  decision_date?: string;
  promulgation_date?: string;
  publication_date?: string;
  created_at: string;
  bar_subjects?: string[];
  topics?: string[];
}

export interface VectorDocumentPayload {
  document_id: string;
  section_id?: string;
  document_type: string;
  court?: string;
  source_trust_level?: string;
  is_official: boolean;
  is_published: boolean;
  decision_date?: string;
  embedding_vector: number[];
  text_snippet: string;
  title: string;
  citation_text?: string;
}

export interface SearchOptions {
  query: string;
  filters?: {
    documentType?: string;
    court?: string;
    ponente?: string;
    sourceId?: string;
    grNo?: string;
    dateFrom?: string;
    dateTo?: string;
    publishedOnly?: boolean;
  };
  /**
   * Document IDs to exclude from results (dedup suppression — non-canonical
   * duplicates and stale versions identified by the dedup engine).
   * Injected as a `must_not.terms` clause on `document_id`.
   */
  excludeDocumentIds?: string[];
  from?: number;
  size?: number;
}

export interface VectorSearchOptions {
  vector: number[];
  filters?: {
    documentType?: string;
    court?: string;
    publishedOnly?: boolean;
  };
  /**
   * Document IDs to exclude from results (dedup suppression). Injected as
   * a `must_not.terms` clause inside the kNN query's filter.
   */
  excludeDocumentIds?: string[];
  k?: number;
}

export interface SearchResultItem {
  id: string;
  score: number;
  source: Record<string, unknown>;
  highlights?: Record<string, string[]>;
}

interface SearchHit {
  _id: string;
  _score: number;
  _source: Record<string, unknown>;
  highlight?: Record<string, string[]>;
}

@Injectable()
export class OpenSearchService implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchService.name);
  private client: Client;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('OPENSEARCH_URL', 'http://localhost:9200');
    const username = this.config.get<string>('OPENSEARCH_USERNAME');
    const password = this.config.get<string>('OPENSEARCH_PASSWORD');

    this.client = new Client({
      node: url,
      ssl: { rejectUnauthorized: false },
      ...(username && password && { auth: { username, password } }),
    });
  }

  /**
   * The embedding dimension the vector index is built with. Read from config so
   * it always tracks what the embedding service actually emits — hardcoding it
   * is what left the prod vector index unusable.
   */
  get embeddingDimension(): number {
    return this.config.get<number>('EMBEDDING_DIM', DEFAULT_EMBEDDING_DIM);
  }

  async onModuleInit() {
    try {
      const info = await this.client.info();
      this.logger.log(
        `OpenSearch connected: ${info.body.version.distribution} ${info.body.version.number}`,
      );
    } catch {
      this.logger.warn('OpenSearch not available — search features will be degraded');
      return;
    }

    if (this.config.get<string>('SEARCH_AUTO_ENSURE_INDEXES', 'true') === 'false') {
      this.logger.log('SEARCH_AUTO_ENSURE_INDEXES=false — skipping index bootstrap');
      return;
    }

    // Never crash boot on an index problem: OpenSearch is a projection, not
    // the system of record (CLAUDE.md rule 4). Log and continue.
    try {
      await this.ensureIndexes();
    } catch (error) {
      this.logger.error(
        `ensureIndexes() failed during boot — continuing with degraded search: ${
          (error as Error).message
        }`,
      );
    }
  }

  /**
   * Idempotently bring the alias → physical index topology into existence.
   *
   * Three states per logical index:
   *  - alias already exists → nothing to do (NEVER repoint an existing alias
   *    here; that is the rebuild job's decision alone).
   *  - a *concrete* index occupies the alias name (this is production today,
   *    auto-created with dynamic mappings) → leave it strictly alone and warn.
   *    Only `POST /search/index/rebuild` may replace it, because that path
   *    reindexes and verifies before deleting anything.
   *  - neither exists (fresh install / CI) → create the `_v2` physical index
   *    with the explicit mapping and point the alias at it.
   */
  async ensureIndexes(): Promise<{
    created: string[];
    existing: string[];
    needsRebuild: string[];
  }> {
    const created: string[] = [];
    const existing: string[] = [];
    const needsRebuild: string[] = [];

    for (const entry of INDEX_TOPOLOGY) {
      const aliasExists = await this.aliasExists(entry.alias);
      if (aliasExists) {
        existing.push(entry.alias);
        continue;
      }

      if (await this.indexExists(entry.alias)) {
        this.logger.warn(
          `"${entry.alias}" is a concrete index, not an alias — it predates the ` +
            `explicit mappings and its filters will not match. Run ` +
            `POST /search/index/rebuild to migrate it to ${entry.physical}.`,
        );
        needsRebuild.push(entry.alias);
        continue;
      }

      await this.createPhysicalIndex(
        entry.physical,
        entry.buildMapping(this.embeddingDimension),
      );
      await this.client.indices.putAlias({
        index: entry.physical,
        name: entry.alias,
        body: { is_write_index: true },
      });
      this.logger.log(`Created ${entry.physical} and aliased it as ${entry.alias}`);
      created.push(entry.alias);
    }

    return { created, existing, needsRebuild };
  }

  /** True when `name` resolves to an alias (as opposed to a concrete index). */
  async aliasExists(name: string): Promise<boolean> {
    const response = await this.client.indices.existsAlias({ name });
    return response.body === true;
  }

  /** True when `name` exists as an index or alias. */
  async indexExists(name: string): Promise<boolean> {
    const response = await this.client.indices.exists({ index: name });
    return response.body === true;
  }

  /**
   * Resolve the physical index (or indices) an alias currently points at.
   * Returns an empty array when the alias does not exist.
   */
  async resolveAliasTargets(alias: string): Promise<string[]> {
    try {
      const response = await this.client.indices.getAlias({ name: alias });
      return Object.keys(response.body as Record<string, unknown>);
    } catch {
      return [];
    }
  }

  /**
   * Create a physical index, failing loudly if it already exists. Callers that
   * want idempotency check `indexExists()` first.
   */
  async createPhysicalIndex(
    indexName: string,
    mapping: Record<string, unknown>,
  ): Promise<void> {
    await this.client.indices.create({ index: indexName, body: mapping });
  }

  async deleteIndex(indexName: string): Promise<void> {
    await this.client.indices.delete({ index: indexName });
  }

  async refreshIndex(indexName: string): Promise<void> {
    await this.client.indices.refresh({ index: indexName });
  }

  async countIndex(indexName: string): Promise<number> {
    const response = await this.client.count({ index: indexName });
    return (response.body as { count: number }).count;
  }

  /**
   * Atomically swap an alias onto `target`, optionally deleting the concrete
   * index that currently squats on the alias name in the SAME request.
   *
   * `remove_index` is the only way to go from "concrete index named X" to
   * "alias X → X_v2" without a window in which X does not resolve at all.
   * Callers MUST have verified the target's doc count first — this method is
   * deliberately dumb about safety so the ordering is testable in one place.
   */
  async swapAlias(options: {
    alias: string;
    target: string;
    removeConcreteIndex?: boolean;
    detachFrom?: string[];
  }): Promise<void> {
    const actions: Record<string, unknown>[] = [];
    if (options.removeConcreteIndex) {
      actions.push({ remove_index: { index: options.alias } });
    }
    for (const previous of options.detachFrom ?? []) {
      actions.push({ remove: { index: previous, alias: options.alias } });
    }
    actions.push({
      add: { index: options.target, alias: options.alias, is_write_index: true },
    });
    await this.client.indices.updateAliases({ body: { actions } });
  }

  /**
   * Server-side copy of one index into another. Used for the vector and
   * user-upload indices, whose payloads (embeddings, OCR text) are expensive or
   * impossible to regenerate — a `_reindex` preserves them for free.
   */
  async reindexInto(source: string, dest: string): Promise<number> {
    const response = await this.client.reindex({
      wait_for_completion: true,
      refresh: true,
      body: { source: { index: source }, dest: { index: dest } },
    });
    return ((response.body as { created?: number }).created ?? 0) as number;
  }

  async indexDocument(doc: IndexDocumentPayload) {
    const id = doc.section_id ?? doc.document_id;
    try {
      await this.client.index({
        index: KEYWORD_INDEX,
        id,
        body: this.withDerivedFields(doc),
        refresh: 'false',
      });
    } catch (error) {
      this.logger.error(`Failed to index document ${id}`, error);
      throw error;
    }
  }

  /**
   * Populate index-time computed fields. Centralised here so every write path
   * (single, bulk, rebuild job) produces identical documents.
   */
  private withDerivedFields(doc: IndexDocumentPayload): Record<string, unknown> {
    const grNoDigits = deriveGrNoDigits(doc.gr_no ?? doc.docket_no);
    const payload: Record<string, unknown> = { ...doc };
    if (grNoDigits) {
      payload['gr_no_digits'] = grNoDigits;
    } else {
      delete payload['gr_no_digits'];
    }
    return payload;
  }

  async bulkIndexDocuments(docs: IndexDocumentPayload[], targetIndex = KEYWORD_INDEX) {
    if (docs.length === 0) return { indexed: 0, errors: 0 };

    const body: Record<string, unknown>[] = [];
    for (const doc of docs) {
      const id = doc.section_id ?? doc.document_id;
      body.push({ index: { _index: targetIndex, _id: id } });
      body.push(this.withDerivedFields(doc));
    }

    try {
      const response = await this.client.bulk({ body, refresh: 'false' });
      let errorCount = 0;
      if (response.body.errors) {
        const items = response.body.items as Record<string, Record<string, unknown>>[];
        errorCount = items.filter((item) => item['index']?.['error']).length;
      }

      if (errorCount > 0) {
        this.logger.warn(
          `Bulk index: ${docs.length - errorCount}/${docs.length} succeeded, ${errorCount} errors`,
        );
      }

      return { indexed: docs.length - errorCount, errors: errorCount };
    } catch (error) {
      this.logger.error('Bulk index failed', error);
      throw error;
    }
  }

  async removeDocument(documentId: string) {
    try {
      await this.client.deleteByQuery({
        index: KEYWORD_INDEX,
        body: {
          query: { term: { document_id: documentId } },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to remove document ${documentId}`, error);
    }
  }

  async searchKeyword(options: SearchOptions) {
    const { query, filters, excludeDocumentIds, from = 0, size = 20 } = options;

    // Build query DSL programmatically (per CLAUDE.md: never interpolate user input)
    const must: Record<string, unknown>[] = [];
    const filter: Record<string, unknown>[] = [];
    const mustNot: Record<string, unknown>[] = [];

    must.push({
      multi_match: {
        query,
        fields: ['title^3', 'short_title^2', 'citation_text^4', 'plain_text', 'section_text', 'gr_no^5'],
        type: 'best_fields',
        fuzziness: 'AUTO',
      },
    });

    if (filters?.documentType) {
      filter.push({ term: { document_type: filters.documentType } });
    }
    if (filters?.court) {
      filter.push({ term: { court: filters.court } });
    }
    if (filters?.ponente) {
      filter.push({ term: { ponente: filters.ponente } });
    }
    if (filters?.sourceId) {
      filter.push({ term: { source_id: filters.sourceId } });
    }
    if (filters?.grNo) {
      filter.push({ term: { gr_no: filters.grNo } });
    }
    if (filters?.publishedOnly) {
      filter.push({ term: { is_published: true } });
    }
    if (filters?.dateFrom || filters?.dateTo) {
      const range: Record<string, string> = {};
      if (filters.dateFrom) range['gte'] = filters.dateFrom;
      if (filters.dateTo) range['lte'] = filters.dateTo;
      filter.push({ range: { decision_date: range } });
    }

    if (!filters?.publishedOnly) {
      filter.push({ terms: { status: ['published', 'indexed'] } });
    }

    // Dedup suppression — exclude non-canonical duplicates / stale versions.
    // Built programmatically (no user input). Empty array = no clause.
    if (excludeDocumentIds && excludeDocumentIds.length > 0) {
      mustNot.push({ terms: { document_id: excludeDocumentIds } });
    }

    const boolQuery: Record<string, unknown> = { must, filter };
    if (mustNot.length > 0) {
      boolQuery['must_not'] = mustNot;
    }

    const body: Record<string, unknown> = {
      query: { bool: boolQuery },
      highlight: {
        fields: {
          plain_text: { fragment_size: 200, number_of_fragments: 3 },
          section_text: { fragment_size: 200, number_of_fragments: 3 },
          title: {},
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
      },
      from,
      size,
      timeout: '5s',
    };

    try {
      const response = await this.client.search({ index: KEYWORD_INDEX, body });
      const hits = response.body.hits as {
        total: { value: number } | number;
        max_score: number | null;
        hits: SearchHit[];
      };

      const total = typeof hits.total === 'number' ? hits.total : hits.total.value;

      return {
        total,
        maxScore: hits.max_score,
        items: hits.hits.map((hit: SearchHit) => ({
          id: hit._id,
          score: hit._score,
          source: hit._source,
          highlights: hit.highlight ?? {},
        })),
        timedOut: response.body.timed_out as boolean,
      };
    } catch (error) {
      this.logger.error('Search failed', error);
      throw error;
    }
  }

  async searchExactCitation(citation: string) {
    const body: Record<string, unknown> = {
      query: {
        bool: {
          // `.raw` sub-fields carry the citation_normalizer (lowercase, strip
          // `.`/`,`/space), so the query value must be normalised the same way.
          should: [
            { term: { gr_no: citation } },
            { term: { 'gr_no.raw': normalizeCitationKey(citation) } },
            { term: { gr_no_digits: deriveGrNoDigits(citation) ?? citation } },
            { term: { 'citation_text.raw': normalizeCitationKey(citation) } },
            { match_phrase: { citation_text: citation } },
          ],
          minimum_should_match: 1,
        },
      },
      size: 10,
      timeout: '5s',
    };

    try {
      const response = await this.client.search({ index: KEYWORD_INDEX, body });
      const hits = response.body.hits as {
        total: { value: number } | number;
        hits: SearchHit[];
      };

      const total = typeof hits.total === 'number' ? hits.total : hits.total.value;

      return {
        total,
        items: hits.hits.map((hit: SearchHit) => ({
          id: hit._id,
          score: hit._score,
          source: hit._source,
        })),
      };
    } catch (error) {
      this.logger.error('Citation search failed', error);
      throw error;
    }
  }

  async searchSuggestions(prefix: string, limit = 10) {
    const body: Record<string, unknown> = {
      query: {
        bool: {
          should: [
            { prefix: { 'title.keyword': { value: prefix, boost: 2 } } },
            {
              prefix: {
                'citation_text.raw': { value: normalizeCitationKey(prefix), boost: 3 },
              },
            },
            { match_phrase_prefix: { title: { query: prefix, max_expansions: 10 } } },
            { match_phrase_prefix: { gr_no: { query: prefix, max_expansions: 10 } } },
          ],
          minimum_should_match: 1,
          filter: [{ term: { is_published: true } }],
        },
      },
      _source: ['document_id', 'title', 'short_title', 'citation_text', 'gr_no', 'document_type', 'court'],
      size: limit,
      timeout: '3s',
    };

    try {
      const response = await this.client.search({ index: KEYWORD_INDEX, body });
      const hits = response.body.hits as { hits: SearchHit[] };

      return hits.hits.map((hit: SearchHit) => ({
        id: hit._id,
        score: hit._score,
        source: hit._source,
      }));
    } catch {
      this.logger.error('Suggestions search failed');
      return [];
    }
  }

  /**
   * Index a document's vector embedding into the vector index.
   */
  async indexVectorDocument(doc: VectorDocumentPayload) {
    const id = doc.section_id ?? doc.document_id;
    try {
      await this.client.index({
        index: VECTOR_INDEX,
        id,
        body: doc as unknown as Record<string, unknown>,
        refresh: 'false',
      });
    } catch (error) {
      this.logger.error(`Failed to index vector for ${id}`, error);
      throw error;
    }
  }

  /**
   * Bulk index vector documents into the vector index.
   */
  async bulkIndexVectorDocuments(
    docs: VectorDocumentPayload[],
    targetIndex = VECTOR_INDEX,
  ) {
    if (docs.length === 0) return { indexed: 0, errors: 0 };

    const body: Record<string, unknown>[] = [];
    for (const doc of docs) {
      const id = doc.section_id ?? doc.document_id;
      body.push({ index: { _index: targetIndex, _id: id } });
      body.push(doc as unknown as Record<string, unknown>);
    }

    try {
      const response = await this.client.bulk({ body, refresh: 'false' });
      let errorCount = 0;
      if (response.body.errors) {
        const items = response.body.items as Record<string, Record<string, unknown>>[];
        errorCount = items.filter((item) => item['index']?.['error']).length;
      }
      return { indexed: docs.length - errorCount, errors: errorCount };
    } catch (error) {
      this.logger.error('Bulk vector index failed', error);
      throw error;
    }
  }

  /**
   * kNN vector search on the vector index.
   * Uses OpenSearch kNN query with optional metadata filters.
   */
  async searchVector(options: VectorSearchOptions): Promise<{
    items: SearchResultItem[];
    timedOut: boolean;
  }> {
    const { vector, filters, excludeDocumentIds, k = 20 } = options;

    const filterClauses: Record<string, unknown>[] = [];
    const mustNotClauses: Record<string, unknown>[] = [];
    if (filters?.documentType) {
      filterClauses.push({ term: { document_type: filters.documentType } });
    }
    if (filters?.court) {
      filterClauses.push({ term: { court: filters.court } });
    }
    if (filters?.publishedOnly) {
      filterClauses.push({ term: { is_published: true } });
    }
    if (excludeDocumentIds && excludeDocumentIds.length > 0) {
      mustNotClauses.push({ terms: { document_id: excludeDocumentIds } });
    }

    const knnQuery: Record<string, unknown> = {
      embedding_vector: {
        vector,
        k,
      },
    };

    // Apply pre-filters if any
    if (filterClauses.length > 0 || mustNotClauses.length > 0) {
      const knnBool: Record<string, unknown> = {};
      if (filterClauses.length > 0) knnBool['must'] = filterClauses;
      if (mustNotClauses.length > 0) knnBool['must_not'] = mustNotClauses;
      knnQuery['filter'] = { bool: knnBool };
    }

    const body: Record<string, unknown> = {
      size: k,
      query: { knn: knnQuery },
      timeout: '5s',
    };

    try {
      const response = await this.client.search({ index: VECTOR_INDEX, body });
      const hits = response.body.hits as {
        hits: SearchHit[];
      };

      return {
        items: hits.hits.map((hit: SearchHit) => ({
          id: hit._id,
          score: hit._score,
          source: hit._source,
        })),
        timedOut: response.body.timed_out as boolean,
      };
    } catch (error) {
      this.logger.error('Vector search failed', error);
      throw error;
    }
  }

  /**
   * Remove a document from both keyword and vector indexes.
   */
  async removeDocumentFromAllIndexes(documentId: string) {
    await this.removeDocument(documentId);
    try {
      await this.client.deleteByQuery({
        index: VECTOR_INDEX,
        body: {
          query: { term: { document_id: documentId } },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to remove vector for document ${documentId}`, error);
    }
  }

  // ---- User Uploads Index ----

  async indexUserUpload(doc: UserUploadIndexPayload) {
    try {
      await this.client.index({
        index: USER_UPLOADS_INDEX,
        id: doc.upload_id,
        body: doc as unknown as Record<string, unknown>,
        refresh: 'false',
      });
    } catch (error) {
      this.logger.error(`Failed to index user upload ${doc.upload_id}`, error);
      throw error;
    }
  }

  async removeUserUpload(uploadId: string) {
    try {
      await this.client.delete({
        index: USER_UPLOADS_INDEX,
        id: uploadId,
      });
    } catch (error) {
      this.logger.warn(`Failed to remove user upload ${uploadId} from index`, error);
    }
  }

  async searchUserUploads(options: UserUploadSearchOptions) {
    const { query, organizationId, filters, from = 0, size = 20 } = options;

    // Tenant isolation: organization_id is ALWAYS required (per CLAUDE.md)
    const filter: Record<string, unknown>[] = [
      { term: { organization_id: organizationId } },
    ];

    if (filters?.documentType) {
      filter.push({ term: { classified_document_type: filters.documentType } });
    }
    if (filters?.dateFrom || filters?.dateTo) {
      const range: Record<string, string> = {};
      if (filters.dateFrom) range['gte'] = filters.dateFrom;
      if (filters.dateTo) range['lte'] = filters.dateTo;
      filter.push({ range: { created_at: range } });
    }

    const body: Record<string, unknown> = {
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: ['ocr_text', 'original_filename^2'],
                type: 'best_fields',
                fuzziness: 'AUTO',
              },
            },
          ],
          filter,
        },
      },
      highlight: {
        fields: {
          ocr_text: { fragment_size: 200, number_of_fragments: 3 },
          original_filename: {},
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
      },
      from,
      size,
      timeout: '5s',
    };

    try {
      const response = await this.client.search({ index: USER_UPLOADS_INDEX, body });
      const hits = response.body.hits as {
        total: { value: number } | number;
        max_score: number | null;
        hits: SearchHit[];
      };

      const total = typeof hits.total === 'number' ? hits.total : hits.total.value;

      return {
        total,
        maxScore: hits.max_score,
        items: hits.hits.map((hit: SearchHit) => ({
          id: hit._id,
          score: hit._score,
          source: hit._source,
          highlights: hit.highlight ?? {},
        })),
        timedOut: response.body.timed_out as boolean,
      };
    } catch (error) {
      this.logger.error('User upload search failed', error);
      throw error;
    }
  }

  getClient(): Client {
    return this.client;
  }
}

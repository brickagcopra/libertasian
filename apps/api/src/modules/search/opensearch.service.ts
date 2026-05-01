import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';

/**
 * OpenSearch index names per PDD Section 4.4
 */
export const KEYWORD_INDEX = 'legal_documents_keyword';
export const VECTOR_INDEX = 'legal_documents_vector';
export const USER_UPLOADS_INDEX = 'user_uploads_searchable';

/**
 * Keyword index mapping for BM25 search.
 * Per CLAUDE.md: keyword type for filterable metadata, text with standard analyzer for full-text.
 */
const KEYWORD_INDEX_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    refresh_interval: '5s',
    analysis: {
      analyzer: {
        legal_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding'],
        },
      },
    },
  },
  mappings: {
    properties: {
      title: { type: 'text', analyzer: 'legal_analyzer', fields: { keyword: { type: 'keyword' } } },
      short_title: { type: 'text', analyzer: 'legal_analyzer' },
      citation_text: { type: 'text', analyzer: 'legal_analyzer', fields: { keyword: { type: 'keyword' } } },
      plain_text: { type: 'text', analyzer: 'legal_analyzer' },
      section_text: { type: 'text', analyzer: 'legal_analyzer' },
      document_id: { type: 'keyword' },
      section_id: { type: 'keyword' },
      document_type: { type: 'keyword' },
      court: { type: 'keyword' },
      ponente: { type: 'keyword' },
      jurisdiction: { type: 'keyword' },
      language: { type: 'keyword' },
      status: { type: 'keyword' },
      gr_no: { type: 'keyword' },
      docket_no: { type: 'keyword' },
      source_id: { type: 'keyword' },
      source_trust_level: { type: 'keyword' },
      is_official: { type: 'boolean' },
      is_published: { type: 'boolean' },
      section_type: { type: 'keyword' },
      decision_date: { type: 'date' },
      promulgation_date: { type: 'date' },
      publication_date: { type: 'date' },
      created_at: { type: 'date' },
      bar_subjects: { type: 'keyword' },
      topics: { type: 'keyword' },
    },
  },
};

const VECTOR_INDEX_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    'index.knn': true,
  },
  mappings: {
    properties: {
      document_id: { type: 'keyword' },
      section_id: { type: 'keyword' },
      document_type: { type: 'keyword' },
      court: { type: 'keyword' },
      source_trust_level: { type: 'keyword' },
      is_official: { type: 'boolean' },
      is_published: { type: 'boolean' },
      decision_date: { type: 'date' },
      embedding_vector: {
        type: 'knn_vector',
        dimension: 1024,
        method: {
          name: 'hnsw',
          space_type: 'cosinesimil',
          engine: 'lucene',
          parameters: { ef_construction: 256, m: 16 },
        },
      },
      text_snippet: { type: 'text' },
      title: { type: 'text' },
      citation_text: { type: 'keyword' },
    },
  },
};

/**
 * Separate index for user uploads per CLAUDE.md: "never co-mingle with editorial corpus."
 * organization_id is a mandatory keyword filter for tenant isolation.
 */
const USER_UPLOADS_INDEX_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    refresh_interval: '5s',
    analysis: {
      analyzer: {
        upload_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding'],
        },
      },
    },
  },
  mappings: {
    properties: {
      upload_id: { type: 'keyword' },
      organization_id: { type: 'keyword' },
      user_id: { type: 'keyword' },
      ocr_text: { type: 'text', analyzer: 'upload_analyzer' },
      original_filename: { type: 'text', fields: { keyword: { type: 'keyword' } } },
      classified_document_type: { type: 'keyword' },
      upload_type: { type: 'keyword' },
      mime_type: { type: 'keyword' },
      privacy_level: { type: 'keyword' },
      extracted_citations: { type: 'keyword' },
      created_at: { type: 'date' },
    },
  },
};

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

  async onModuleInit() {
    try {
      const info = await this.client.info();
      this.logger.log(
        `OpenSearch connected: ${info.body.version.distribution} ${info.body.version.number}`,
      );
    } catch {
      this.logger.warn('OpenSearch not available — search features will be degraded');
    }
  }

  async ensureIndexes() {
    await this.createIndexIfNotExists(KEYWORD_INDEX, KEYWORD_INDEX_MAPPING);
    await this.createIndexIfNotExists(VECTOR_INDEX, VECTOR_INDEX_MAPPING);
    await this.createIndexIfNotExists(USER_UPLOADS_INDEX, USER_UPLOADS_INDEX_MAPPING);
  }

  private async createIndexIfNotExists(indexName: string, mapping: Record<string, unknown>) {
    try {
      const exists = await this.client.indices.exists({ index: indexName });
      if (!exists.body) {
        await this.client.indices.create({ index: indexName, body: mapping });
        this.logger.log(`Created index: ${indexName}`);
      }
    } catch (error) {
      this.logger.error(`Failed to create index ${indexName}`, error);
    }
  }

  async indexDocument(doc: IndexDocumentPayload) {
    const id = doc.section_id ?? doc.document_id;
    try {
      await this.client.index({
        index: KEYWORD_INDEX,
        id,
        body: doc as unknown as Record<string, unknown>,
        refresh: 'false',
      });
    } catch (error) {
      this.logger.error(`Failed to index document ${id}`, error);
      throw error;
    }
  }

  async bulkIndexDocuments(docs: IndexDocumentPayload[]) {
    if (docs.length === 0) return { indexed: 0, errors: 0 };

    const body: Record<string, unknown>[] = [];
    for (const doc of docs) {
      const id = doc.section_id ?? doc.document_id;
      body.push({ index: { _index: KEYWORD_INDEX, _id: id } });
      body.push(doc as unknown as Record<string, unknown>);
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
          should: [
            { term: { gr_no: citation } },
            { term: { 'citation_text.keyword': citation } },
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
            { prefix: { 'citation_text.keyword': { value: prefix, boost: 3 } } },
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
  async bulkIndexVectorDocuments(docs: VectorDocumentPayload[]) {
    if (docs.length === 0) return { indexed: 0, errors: 0 };

    const body: Record<string, unknown>[] = [];
    for (const doc of docs) {
      const id = doc.section_id ?? doc.document_id;
      body.push({ index: { _index: VECTOR_INDEX, _id: id } });
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

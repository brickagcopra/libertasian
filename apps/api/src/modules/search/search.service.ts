import { createHash } from 'crypto';

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingClientService } from './embedding-client.service';
import {
  OpenSearchService,
  type IndexDocumentPayload,
  type SearchResultItem,
  type VectorDocumentPayload,
} from './opensearch.service';
import { SuppressedDocsService } from './suppressed-docs.service';
import { SearchQueryDto } from './dto';

/** Per CLAUDE.md: cache:search:{hash}, 5-min TTL */
const SEARCH_CACHE_TTL = 300;

/** Per CLAUDE.md: RRF constant k=60 (standard value) */
const RRF_K = 60;

/** Max text length to send for embedding (truncate long texts) */
const MAX_EMBEDDING_TEXT_LENGTH = 16_000;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openSearch: OpenSearchService,
    private readonly redis: RedisService,
    private readonly embeddingClient: EmbeddingClientService,
    private readonly suppressedDocs: SuppressedDocsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Whether the dedup post-filter is on. Default: true. Disable instantly
   * by setting `SEARCH_DEDUP_FILTER_ENABLED=false` if it ever over-filters.
   */
  private isDedupFilterEnabled(): boolean {
    const raw = this.config.get<string>('SEARCH_DEDUP_FILTER_ENABLED', 'true');
    return raw !== 'false';
  }

  async initializeIndexes() {
    await this.openSearch.ensureIndexes();
    return { message: 'Indexes initialized' };
  }

  /**
   * Perform hybrid search: BM25 keyword + kNN vector search with RRF fusion.
   * Falls back to BM25-only if the embedding service is unavailable.
   * Results are cached in Redis per CLAUDE.md (5-min TTL).
   */
  async search(dto: SearchQueryDto) {
    const page = dto.page ?? 0;
    const limit = dto.limit ?? 20;
    const cacheKey = this.buildCacheKey(dto);

    // Check cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        items: unknown[];
        meta: {
          total: number;
          maxScore: number | null;
          page: number;
          limit: number;
          timedOut: boolean;
          cached: boolean;
          searchType: string;
        };
      };
      return {
        items: parsed.items,
        meta: { ...parsed.meta, cached: true },
      };
    }

    // Attempt hybrid search (BM25 + kNN with RRF).
    // Wrap in try/catch to handle OpenSearch index-not-found (E3b) and
    // other upstream failures gracefully instead of leaking 500s.
    let result: Awaited<ReturnType<SearchService['hybridSearch']>>;
    try {
      result = await this.hybridSearch(dto, page, limit);
    } catch (err: unknown) {
      // OpenSearch index_not_found_exception → return empty envelope
      if (this.isIndexNotFound(err)) {
        this.logger.warn(
          `Search index missing — returning empty results (index: [redacted])`,
        );
        return {
          items: [],
          meta: { total: 0, maxScore: null, page, limit, timedOut: false, cached: false, searchType: 'keyword_only' as const },
        };
      }
      // Any other OpenSearch / network error → 503
      this.logger.error('Search upstream failure', (err as Error).message);
      throw new ServiceUnavailableException('Search temporarily unavailable');
    }

    const response = {
      items: result.items,
      meta: {
        total: result.total,
        maxScore: result.maxScore,
        page,
        limit,
        timedOut: result.timedOut,
        cached: false,
        searchType: result.searchType,
      },
    };

    // Store in cache (non-blocking)
    this.redis
      .set(cacheKey, JSON.stringify(response), SEARCH_CACHE_TTL)
      .catch((cacheErr) =>
        this.logger.warn('Failed to cache search result', (cacheErr as Error).message),
      );

    return response;
  }

  /**
   * Execute hybrid search combining BM25 keyword results with kNN vector results
   * using Reciprocal Rank Fusion (RRF).
   *
   * Per PDD Section 6.1: Candidate Merge (RRF or weighted fusion).
   */
  private async hybridSearch(
    dto: SearchQueryDto,
    page: number,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
    maxScore: number | null;
    timedOut: boolean;
    searchType: 'hybrid' | 'keyword_only';
  }> {
    // Resolve the dedup suppression list before issuing OpenSearch calls.
    // The service swallows its own errors and returns an empty Set on
    // miss/outage, so the search path NEVER 500s on a Redis hiccup.
    const excludeDocumentIds = this.isDedupFilterEnabled()
      ? Array.from(await this.suppressedDocs.getSuppressedDocIds())
      : [];

    // Always run BM25 keyword search
    const bm25Promise = this.openSearch.searchKeyword({
      query: dto.query,
      filters: {
        documentType: dto.documentType,
        court: dto.court,
        ponente: dto.ponente,
        sourceId: dto.sourceId,
        grNo: dto.grNo,
        dateFrom: dto.dateFrom,
        dateTo: dto.dateTo,
        publishedOnly: dto.publishedOnly,
      },
      excludeDocumentIds,
      from: 0,
      // Fetch more for RRF merging (we re-paginate after fusion)
      size: Math.max(limit * 3, 60),
    });

    // Attempt to get query embedding for kNN search
    const queryVector = await this.embeddingClient.embed(dto.query);

    if (!queryVector) {
      // Embedding service unavailable — fall back to BM25 only.
      // De-dup per document BEFORE paginating so section duplicates don't
      // surface the same case multiple times (matches the RRF path).
      const bm25Result = await bm25Promise;
      const deduped = this.dedupeByDocumentId(bm25Result.items);
      const paginatedItems = deduped.slice(page * limit, (page + 1) * limit);
      return {
        items: paginatedItems,
        total: deduped.length,
        maxScore: bm25Result.maxScore,
        timedOut: bm25Result.timedOut,
        searchType: 'keyword_only',
      };
    }

    // Run kNN search in parallel with BM25
    const [bm25Result, knnResult] = await Promise.all([
      bm25Promise,
      this.openSearch.searchVector({
        vector: queryVector,
        filters: {
          documentType: dto.documentType,
          court: dto.court,
          publishedOnly: dto.publishedOnly,
        },
        excludeDocumentIds,
        k: Math.max(limit * 3, 60),
      }).catch((err) => {
        this.logger.warn(`kNN search failed, using BM25 only: ${(err as Error).message}`);
        return null;
      }),
    ]);

    if (!knnResult) {
      // kNN failed — fall back to BM25 only. De-dup per document before
      // paginating (matches the RRF path and the embedding-null fallback).
      const deduped = this.dedupeByDocumentId(bm25Result.items);
      const paginatedItems = deduped.slice(page * limit, (page + 1) * limit);
      return {
        items: paginatedItems,
        total: deduped.length,
        maxScore: bm25Result.maxScore,
        timedOut: bm25Result.timedOut,
        searchType: 'keyword_only',
      };
    }

    // Apply Reciprocal Rank Fusion (RRF)
    const fusedItems = this.reciprocalRankFusion(
      bm25Result.items,
      knnResult.items,
    );

    // Paginate the fused results
    const totalFused = fusedItems.length;
    const paginatedItems = fusedItems.slice(page * limit, (page + 1) * limit);

    return {
      items: paginatedItems,
      // totalFused already reflects the de-duped fused list (one entry per
      // document), so it is the correct count — bm25Result.total includes
      // raw section duplicates and would over-count.
      total: totalFused,
      maxScore: paginatedItems.length > 0 ? paginatedItems[0]!.score : null,
      timedOut: bm25Result.timedOut || knnResult.timedOut,
      searchType: 'hybrid',
    };
  }

  /**
   * Reciprocal Rank Fusion (RRF) — merges two ranked lists.
   *
   * For each result, compute: RRF_score = 1 / (k + rank_in_list)
   * Sum RRF scores across lists for the same document ID.
   * Sort by total RRF score descending.
   *
   * Per PDD Section 6.1: Candidate Merge (RRF or weighted fusion).
   */
  private reciprocalRankFusion(
    bm25Items: SearchResultItem[],
    knnItems: SearchResultItem[],
  ): SearchResultItem[] {
    const scoreMap = new Map<string, { score: number; item: SearchResultItem }>();

    // Score BM25 results
    for (let rank = 0; rank < bm25Items.length; rank++) {
      const item = bm25Items[rank]!;
      const rrfScore = 1 / (RRF_K + rank + 1);
      const existing = scoreMap.get(item.id);
      if (existing) {
        existing.score += rrfScore;
        // Merge highlights from BM25 result (BM25 has highlights, kNN doesn't)
        if (item.highlights && Object.keys(item.highlights).length > 0) {
          existing.item.highlights = item.highlights;
        }
      } else {
        scoreMap.set(item.id, { score: rrfScore, item: { ...item } });
      }
    }

    // Score kNN results
    for (let rank = 0; rank < knnItems.length; rank++) {
      const item = knnItems[rank]!;
      const rrfScore = 1 / (RRF_K + rank + 1);
      const existing = scoreMap.get(item.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scoreMap.set(item.id, { score: rrfScore, item: { ...item } });
      }
    }

    // Sort by fused RRF score descending
    const fused = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .map(({ score, item }) => ({
        ...item,
        score,
      }));

    // Per-document dedup: a single legal document can have multiple matching
    // sections — keep only the highest-scoring section per document. The sort
    // above ensures the kept entry is the highest-scoring one for its doc.
    return this.dedupeByDocumentId(fused);
  }

  /**
   * Collapse multiple hits for the same legal document into one. A document is
   * indexed once as full-text and once per section, so OpenSearch returns
   * several hits per document; without this the user sees the same case 2–3×.
   * Keeps the FIRST occurrence per `document_id` — callers pre-sort by score,
   * so the first is the highest-scoring. Falls back to the item id when
   * `document_id` is absent. Used by both the RRF path and the keyword_only
   * fallbacks so dedup is consistent on every code path.
   */
  private dedupeByDocumentId(items: SearchResultItem[]): SearchResultItem[] {
    const deduped: SearchResultItem[] = [];
    const seenDocIds = new Set<string>();
    for (const item of items) {
      const docId =
        typeof item.source['document_id'] === 'string'
          ? (item.source['document_id'] as string)
          : item.id;
      if (seenDocIds.has(docId)) continue;
      seenDocIds.add(docId);
      deduped.push(item);
    }
    return deduped;
  }

  private buildCacheKey(dto: SearchQueryDto): string {
    const normalized = JSON.stringify({
      q: dto.query,
      p: dto.page ?? 0,
      l: dto.limit ?? 20,
      dt: dto.documentType,
      ct: dto.court,
      po: dto.ponente,
      si: dto.sourceId,
      gr: dto.grNo,
      df: dto.dateFrom,
      dtt: dto.dateTo,
      pub: dto.publishedOnly,
      m: dto.mode,
    });
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    return `cache:search:${hash}`;
  }

  async searchByCitation(citation: string) {
    const normalized = this.normalizeCitation(citation);
    return this.openSearch.searchExactCitation(normalized);
  }

  async getSuggestions(prefix: string, limit = 10) {
    return this.openSearch.searchSuggestions(prefix, limit);
  }

  /**
   * Index a single legal document (and its sections) into both keyword and vector indexes.
   */
  async indexLegalDocument(documentId: string) {
    const document = await this.prisma.legalDocument.findUnique({
      where: { id: documentId },
      include: {
        source: { select: { id: true, trustLevel: true } },
        sections: {
          select: {
            id: true,
            sectionType: true,
            sectionLabel: true,
            plainText: true,
            pageStart: true,
            pageEnd: true,
          },
          orderBy: { ordering: 'asc' },
        },
        tagMaps: {
          include: {
            tag: { select: { code: true, tagType: true } },
          },
        },
      },
    });

    if (!document) {
      this.logger.warn(`Document not found for indexing: ${documentId}`);
      return;
    }

    const barSubjects = document.tagMaps
      .filter((tm) => tm.tag.tagType === 'bar_subject')
      .map((tm) => tm.tag.code);
    const topics = document.tagMaps
      .filter((tm) => tm.tag.tagType === 'topic')
      .map((tm) => tm.tag.code);

    const basePayload: IndexDocumentPayload = {
      document_id: document.id,
      title: document.title,
      short_title: document.shortTitle ?? undefined,
      citation_text: document.citationText ?? undefined,
      document_type: document.documentType,
      court: document.court ?? undefined,
      ponente: document.ponente ?? undefined,
      jurisdiction: document.jurisdiction ?? undefined,
      language: document.language ?? undefined,
      status: document.status,
      gr_no: document.grNo ?? undefined,
      docket_no: document.docketNo ?? undefined,
      source_id: document.source?.id ?? undefined,
      source_trust_level: document.source?.trustLevel ?? undefined,
      is_official: document.isOfficial,
      is_published: document.isPublished,
      decision_date: document.decisionDate?.toISOString() ?? undefined,
      promulgation_date: document.promulgationDate?.toISOString() ?? undefined,
      publication_date: document.publicationDate?.toISOString() ?? undefined,
      created_at: document.createdAt.toISOString(),
      bar_subjects: barSubjects,
      topics,
    };

    // Combine full text for document-level operations
    const fullText = document.sections
      .map((s) => s.plainText)
      .filter(Boolean)
      .join('\n\n');

    // Index in keyword index
    await this.openSearch.indexDocument({
      ...basePayload,
      plain_text: fullText,
    });

    // Index each section separately for section-level retrieval
    for (const section of document.sections) {
      if (!section.plainText) continue;
      await this.openSearch.indexDocument({
        ...basePayload,
        section_id: section.id,
        section_type: section.sectionType,
        section_text: section.plainText,
        plain_text: undefined,
      });
    }

    // Index vector embeddings (non-blocking, best-effort)
    this.indexVectorEmbeddings(document, basePayload, fullText).catch((err) =>
      this.logger.warn(
        `Vector indexing failed for ${documentId}: ${(err as Error).message}`,
      ),
    );

    this.logger.log(
      `Indexed document ${documentId} with ${document.sections.length} sections`,
    );
  }

  /**
   * Generate embeddings and index into the vector index.
   * Embeds document-level + section-level texts.
   */
  private async indexVectorEmbeddings(
    document: {
      id: string;
      title: string;
      citationText: string | null;
      sections: { id: string; sectionType: string; plainText: string | null }[];
    },
    basePayload: IndexDocumentPayload,
    fullText: string,
  ) {
    // Prepare texts for batch embedding
    const textsToEmbed: { id: string; sectionId?: string; text: string; snippet: string }[] = [];

    // Document-level embedding (title + truncated text)
    if (fullText.length > 0) {
      const docText = `${document.title}\n\n${fullText}`.slice(0, MAX_EMBEDDING_TEXT_LENGTH);
      textsToEmbed.push({
        id: document.id,
        text: docText,
        snippet: fullText.slice(0, 500),
      });
    }

    // Section-level embeddings
    for (const section of document.sections) {
      if (!section.plainText || section.plainText.length < 50) continue;
      const sectionText = section.plainText.slice(0, MAX_EMBEDDING_TEXT_LENGTH);
      textsToEmbed.push({
        id: document.id,
        sectionId: section.id,
        text: sectionText,
        snippet: section.plainText.slice(0, 500),
      });
    }

    if (textsToEmbed.length === 0) return;

    // Batch embed (max 256 per call)
    const batchSize = 256;
    for (let i = 0; i < textsToEmbed.length; i += batchSize) {
      const batch = textsToEmbed.slice(i, i + batchSize);
      const texts = batch.map((t) => t.text);

      const embeddings = await this.embeddingClient.embedBatch(texts);
      if (!embeddings) continue;

      const vectorDocs: VectorDocumentPayload[] = batch.map((t, idx) => ({
        document_id: t.id,
        section_id: t.sectionId,
        document_type: basePayload.document_type,
        court: basePayload.court,
        source_trust_level: basePayload.source_trust_level,
        is_official: basePayload.is_official,
        is_published: basePayload.is_published,
        decision_date: basePayload.decision_date,
        embedding_vector: embeddings[idx]!,
        text_snippet: t.snippet,
        title: basePayload.title,
        citation_text: basePayload.citation_text,
      }));

      await this.openSearch.bulkIndexVectorDocuments(vectorDocs);
    }
  }

  /**
   * Bulk index multiple documents into OpenSearch (keyword + vector).
   * Per CLAUDE.md: batch size 500.
   */
  async bulkIndexDocuments(documentIds: string[]) {
    let totalIndexed = 0;
    let totalErrors = 0;

    const batchSize = 500;
    for (let i = 0; i < documentIds.length; i += batchSize) {
      const batch = documentIds.slice(i, i + batchSize);

      const documents = await this.prisma.legalDocument.findMany({
        where: { id: { in: batch } },
        include: {
          source: { select: { id: true, trustLevel: true } },
          tagMaps: {
            include: {
              tag: { select: { code: true, tagType: true } },
            },
          },
        },
      });

      const payloads: IndexDocumentPayload[] = documents.map((document) => {
        const barSubjects = document.tagMaps
          .filter((tm) => tm.tag.tagType === 'bar_subject')
          .map((tm) => tm.tag.code);
        const topics = document.tagMaps
          .filter((tm) => tm.tag.tagType === 'topic')
          .map((tm) => tm.tag.code);

        return {
          document_id: document.id,
          title: document.title,
          short_title: document.shortTitle ?? undefined,
          citation_text: document.citationText ?? undefined,
          document_type: document.documentType,
          court: document.court ?? undefined,
          ponente: document.ponente ?? undefined,
          jurisdiction: document.jurisdiction ?? undefined,
          language: document.language ?? undefined,
          status: document.status,
          gr_no: document.grNo ?? undefined,
          docket_no: document.docketNo ?? undefined,
          source_id: document.source?.id ?? undefined,
          source_trust_level: document.source?.trustLevel ?? undefined,
          is_official: document.isOfficial,
          is_published: document.isPublished,
          decision_date: document.decisionDate?.toISOString() ?? undefined,
          promulgation_date: document.promulgationDate?.toISOString() ?? undefined,
          publication_date: document.publicationDate?.toISOString() ?? undefined,
          created_at: document.createdAt.toISOString(),
          bar_subjects: barSubjects,
          topics,
        };
      });

      if (payloads.length > 0) {
        const result = await this.openSearch.bulkIndexDocuments(payloads);
        totalIndexed += result.indexed;
        totalErrors += result.errors;
      }
    }

    return { indexed: totalIndexed, errors: totalErrors, total: documentIds.length };
  }

  async removeFromIndex(documentId: string) {
    await this.openSearch.removeDocumentFromAllIndexes(documentId);
  }

  private normalizeCitation(citation: string): string {
    return citation
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^(GR|G\.R\.|GRN|G\.R\.N\.?)\s*(?:No\.?)?\s*/i, 'G.R. No. ');
  }

  /**
   * Detect OpenSearch index_not_found_exception from the @opensearch-project
   * client's ResponseError shape. The error body structure is:
   *   { meta: { body: { error: { type: 'index_not_found_exception' } } } }
   * or sometimes flattened to the top-level body property.
   */
  private isIndexNotFound(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as Record<string, unknown>;
    // ResponseError shape: err.meta.body.error.type
    const meta = e['meta'] as Record<string, unknown> | undefined;
    const body = (meta?.['body'] ?? e['body']) as Record<string, unknown> | undefined;
    const errObj = body?.['error'] as Record<string, unknown> | undefined;
    return errObj?.['type'] === 'index_not_found_exception';
  }
}

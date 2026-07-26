import { createHash } from 'crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingClientService } from './embedding-client.service';
import {
  OpenSearchService,
  type IndexDocumentPayload,
  type KeywordSearchResult,
  type SearchResultItem,
  type SuggestionItem,
  type VectorDocumentPayload,
} from './opensearch.service';
import { PonenteDirectoryService } from './ponente-directory.service';
import {
  DEFAULT_RANKING_WEIGHTS,
  buildDerivativeVisibilityFilter,
  type DerivativeSearchPrincipal,
  type RankingWeights,
} from './query-builder';
import { classifyQuery } from './query-intent';
import { SuppressedDocsService } from './suppressed-docs.service';
import { SearchQueryDto, type SearchScope } from './dto';

/** Per CLAUDE.md: cache:search:{hash}, 5-min TTL */
const SEARCH_CACHE_TTL = 300;

/** Per CLAUDE.md: RRF constant k=60 (standard value) */
const RRF_K = 60;

/** Max text length to send for embedding (truncate long texts) */
const MAX_EMBEDDING_TEXT_LENGTH = 16_000;

/**
 * Sorted set of recent zero-result queries, surfaced on the admin search
 * analytics page so the synonym list can be tuned from real misses. Query text
 * only — no actor, no org, no PII. 30-day TTL (CLAUDE.md: every key has one).
 */
const ZERO_RESULT_QUERY_KEY = 'cache:search:zero_results';
const ZERO_RESULT_TTL = 2_592_000;

/** Response envelope metadata. Additive over v1 — no field was removed. */
export interface SearchResponseMeta {
  total: number;
  /** True when `total` is the cardinality estimate rather than an exact count. */
  approximateTotal: boolean;
  maxScore: number | null;
  page: number;
  limit: number;
  timedOut: boolean;
  cached: boolean;
  searchType: 'hybrid' | 'keyword_only';
  /** Detected query intent kind, for debugging and analytics. */
  intent: string;
  /** True when nothing confident was found — suggestions are offered instead. */
  abstained: boolean;
  suggestions: SuggestionItem[];
  didYouMean?: string;
}

export interface SearchResponse {
  items: unknown[];
  meta: SearchResponseMeta;
}

/**
 * Discriminator attached to items ONLY on a federated request (one that sent
 * `scope`). A request that omits `scope` gets the legacy items untouched.
 */
export type SearchResultKind = 'document' | 'derivative';

/** Federated response metadata. Only present when `scope` was supplied. */
export interface FederatedSearchMeta extends SearchResponseMeta {
  scope: SearchScope;
  counts: { documents: number; derivatives: number };
  /**
   * Non-fatal degradations, e.g. the derivative arm timing out. Present and
   * empty on a clean federated run so clients can rely on the field existing.
   */
  warnings: string[];
}

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
    private readonly ponenteDirectory: PonenteDirectoryService,
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
  async search(
    dto: SearchQueryDto,
    caller: DerivativeSearchPrincipal | null = null,
  ): Promise<SearchResponse> {
    // A request that did not send `scope` takes the pre-C3 path verbatim. This
    // is a structural guarantee rather than a promise to keep two branches in
    // sync: there is exactly one code path for legacy clients and C3 does not
    // touch it. `searchDocuments` below IS that path, unmodified.
    if (dto.scope === undefined) {
      return this.searchDocuments(dto);
    }
    return this.federatedSearch(dto, dto.scope, caller);
  }

  /**
   * Federated search across the document and derivative corpora.
   *
   * Ordering note, stated plainly because it is a real limitation: within each
   * kind results are ranked by BM25, but the two lists are CONCATENATED
   * (documents first), not globally ranked. BM25 scores from two indices with
   * different mappings, field counts and term statistics are not comparable, so
   * interleaving them by score would be inventing a ranking. Proper cross-corpus
   * fusion needs a reranker over the merged candidate set, which is C4's
   * problem. `counts` lets a client render two sections instead.
   */
  private async federatedSearch(
    dto: SearchQueryDto,
    scope: SearchScope,
    caller: DerivativeSearchPrincipal | null,
  ): Promise<SearchResponse> {
    const page = dto.page ?? 0;
    const limit = dto.limit ?? 20;
    const warnings: string[] = [];

    const wantsDocuments = scope === 'documents' || scope === 'all';
    const wantsDerivatives = scope === 'derivatives' || scope === 'all';

    const documentResponse = wantsDocuments
      ? await this.searchDocuments(dto)
      : null;

    let derivativeItems: SearchResultItem[] = [];
    let derivativeTotal = 0;
    let derivativeTimedOut = false;

    if (wantsDerivatives) {
      // The visibility filter is built HERE, from the JWT-derived principal the
      // controller passed in. `dto` is never consulted for identity — a
      // body-supplied organization id would be an org-enumeration primitive.
      const visibilityFilter = buildDerivativeVisibilityFilter(caller);
      try {
        const result = await this.openSearch.searchDerivatives({
          query: dto.query,
          visibilityFilter,
          from: page * limit,
          size: limit,
        });
        derivativeItems = result.items;
        derivativeTotal = result.total;
        derivativeTimedOut = result.timedOut;
        if (result.timedOut) {
          warnings.push('Derivative results are partial: the derivative search timed out.');
        }
      } catch (err: unknown) {
        // Degrade, do not fail. A missing or unhealthy derivatives index must
        // not take down document search, which is the primary surface.
        const reason = this.isIndexNotFound(err)
          ? 'the derivative index is not available'
          : 'the derivative search failed';
        this.logger.warn(`Derivative arm degraded: ${(err as Error).message}`);
        warnings.push(`Derivative results were omitted because ${reason}.`);
      }
    }

    const items: unknown[] = [
      ...(documentResponse?.items ?? []).map((item) => this.withKind(item, 'document')),
      ...derivativeItems.map((item) => this.withKind(item, 'derivative')),
    ];

    const documentTotal = documentResponse?.meta.total ?? 0;
    const base = documentResponse?.meta;

    const meta: FederatedSearchMeta = {
      total: documentTotal + derivativeTotal,
      approximateTotal: base?.approximateTotal ?? false,
      maxScore: base?.maxScore ?? null,
      page,
      limit,
      timedOut: (base?.timedOut ?? false) || derivativeTimedOut,
      cached: base?.cached ?? false,
      searchType: base?.searchType ?? 'keyword_only',
      intent: base?.intent ?? 'general',
      // With derivatives in scope, having found derivative hits means the
      // request was not a miss even if the document arm abstained.
      abstained: (base?.abstained ?? true) && derivativeItems.length === 0,
      suggestions: base?.suggestions ?? [],
      ...(base?.didYouMean && { didYouMean: base.didYouMean }),
      scope,
      counts: { documents: documentTotal, derivatives: derivativeTotal },
      warnings,
    };

    return { items, meta };
  }

  /** Attach the federated discriminator without mutating the source item. */
  private withKind(item: unknown, kind: SearchResultKind): unknown {
    if (typeof item !== 'object' || item === null) return item;
    return { ...(item as Record<string, unknown>), kind };
  }

  /**
   * The document search path, byte-for-byte as it was before C3.
   *
   * Do not add federated concerns here. `search()` routes legacy (no `scope`)
   * requests straight into this method, so any change to its response is a
   * change to the pre-C3 contract.
   */
  private async searchDocuments(dto: SearchQueryDto): Promise<SearchResponse> {
    const page = dto.page ?? 0;
    const limit = dto.limit ?? 20;

    // Deep pagination guard. `from + size` past SEARCH_MAX_WINDOW exceeds the
    // index's max_result_window and would surface as an opaque upstream 500;
    // fail with a clear 400 instead.
    const maxWindow = this.config.get<number>('SEARCH_MAX_WINDOW', 1000);
    if ((page + 1) * limit > maxWindow) {
      throw new BadRequestException(
        `Result window too large: page ${page} at limit ${limit} exceeds the ` +
          `${maxWindow}-result maximum. Narrow the query with filters instead.`,
      );
    }

    const cacheKey = this.buildCacheKey(dto);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as SearchResponse;
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
          meta: {
            total: 0,
            maxScore: null,
            page,
            limit,
            timedOut: false,
            cached: false,
            searchType: 'keyword_only' as const,
            approximateTotal: false,
            intent: 'general',
            abstained: true,
            suggestions: [] as SuggestionItem[],
          },
        };
      }
      // Any other OpenSearch / network error → 503
      this.logger.error('Search upstream failure', (err as Error).message);
      throw new ServiceUnavailableException('Search temporarily unavailable');
    }

    // Zero-result recovery. Abstain rather than fabricate: return suggestions
    // plus a term-suggester "did you mean" so the user can self-correct, and
    // record the miss so the synonym list can be tuned from real data.
    const minScore = this.config.get<number>('SEARCH_MIN_SCORE', 1.0);
    const abstained =
      result.items.length === 0 || (result.maxScore ?? 0) < minScore;

    let suggestions: SuggestionItem[] = [];
    if (abstained) {
      suggestions = await this.openSearch
        .searchSuggestions(result.cleanedQuery, 5)
        .catch(() => []);
      this.recordZeroResultQuery(dto.query, result.total);
    }

    const response = {
      items: result.items,
      meta: {
        total: result.total,
        approximateTotal: result.approximateTotal,
        maxScore: result.maxScore,
        page,
        limit,
        timedOut: result.timedOut,
        cached: false,
        searchType: result.searchType,
        intent: result.intentKind,
        abstained,
        suggestions,
        ...(result.didYouMean && { didYouMean: result.didYouMean }),
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

  /** Whether the v2 tiered ranker is active. Default on; flip to revert. */
  private isRankerV2Enabled(): boolean {
    return this.config.get<string>('SEARCH_RANKER_V2', 'true') !== 'false';
  }

  /**
   * Log a query that returned nothing useful. Query text only — no user id, no
   * org id, no PII — so it is safe to surface on the admin analytics page and
   * mine for missing synonyms.
   */
  private recordZeroResultQuery(query: string, total: number): void {
    const entry = JSON.stringify({
      q: query.slice(0, 200),
      total,
      at: new Date().toISOString(),
    });
    const client = this.redis.getClient();
    client
      .zadd(ZERO_RESULT_QUERY_KEY, Date.now(), entry)
      .then(() => client.expire(ZERO_RESULT_QUERY_KEY, ZERO_RESULT_TTL))
      .catch((err: unknown) =>
        this.logger.warn(
          `Failed to record zero-result query: ${(err as Error).message}`,
        ),
      );
  }

  /** Recent zero-result queries, newest first. Used by the admin analytics page. */
  async getZeroResultQueries(
    limit = 100,
  ): Promise<{ query: string; total: number; at: string }[]> {
    try {
      const raw = await this.redis
        .getClient()
        .zrevrange(ZERO_RESULT_QUERY_KEY, 0, Math.min(limit, 500) - 1);
      return raw.map((entry) => {
        const parsed = JSON.parse(entry) as { q: string; total: number; at: string };
        return { query: parsed.q, total: parsed.total, at: parsed.at };
      });
    } catch (err) {
      this.logger.warn(
        `Failed to read zero-result queries: ${(err as Error).message}`,
      );
      return [];
    }
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
    approximateTotal: boolean;
    maxScore: number | null;
    timedOut: boolean;
    searchType: 'hybrid' | 'keyword_only';
    intentKind: string;
    cleanedQuery: string;
    didYouMean?: string;
  }> {
    // Resolve the dedup suppression list before issuing OpenSearch calls.
    // The service swallows its own errors and returns an empty Set on
    // miss/outage, so the search path NEVER 500s on a Redis hiccup.
    const excludeDocumentIds = this.isDedupFilterEnabled()
      ? Array.from(await this.suppressedDocs.getSuppressedDocIds())
      : [];

    const rankerV2 = this.isRankerV2Enabled();
    const intent = rankerV2
      ? classifyQuery(dto.query, {
          ponenteAllowList: await this.ponenteDirectory.getPonenteNames(),
        })
      : undefined;

    const filters = {
      documentType: dto.documentType,
      court: dto.court,
      ponente: dto.ponente,
      sourceId: dto.sourceId,
      grNo: dto.grNo,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      publishedOnly: dto.publishedOnly,
    };

    // Under v2 the collapse happens inside OpenSearch, so `from`/`size`
    // paginate correctly against the collapsed set and we request exactly one
    // page. The v1 path still over-fetches because it de-dupes in JS after.
    const bm25Promise = this.openSearch.searchKeyword({
      query: dto.query,
      ...(intent && { intent }),
      filters,
      excludeDocumentIds,
      from: rankerV2 ? page * limit : 0,
      size: rankerV2 ? limit : Math.max(limit * 3, 60),
      ...(rankerV2 && { weights: this.resolveWeights() }),
    });

    const intentKind = intent?.kind ?? 'general';
    const cleanedQuery = intent?.cleanedQuery ?? dto.query;

    // Attempt to get query embedding for kNN search
    const queryVector = await this.embeddingClient.embed(dto.query);

    if (!queryVector) {
      const bm25Result = await bm25Promise;
      return {
        ...this.finalizeKeywordOnly(bm25Result, rankerV2, page, limit),
        intentKind,
        cleanedQuery,
      };
    }

    // Run kNN search in parallel with BM25
    const [bm25Result, knnResult] = await Promise.all([
      bm25Promise,
      this.openSearch
        .searchVector({
          vector: queryVector,
          filters: {
            documentType: dto.documentType,
            court: dto.court,
            publishedOnly: dto.publishedOnly,
          },
          excludeDocumentIds,
          k: Math.max(limit * 3, 60),
        })
        .catch((err) => {
          this.logger.warn(
            `kNN search failed, using BM25 only: ${(err as Error).message}`,
          );
          return null;
        }),
    ]);

    if (!knnResult) {
      return {
        ...this.finalizeKeywordOnly(bm25Result, rankerV2, page, limit),
        intentKind,
        cleanedQuery,
      };
    }

    // RRF fusion window. Under v2 the BM25 side is already collapsed AND
    // already paginated, so fusing on a deep page would reorder rows against a
    // kNN list that only ever covers the head of the corpus. We therefore fuse
    // only inside SEARCH_FUSION_WINDOW; past it pagination is purely lexical
    // (BM25 order). Deep pages are navigational rather than exploratory, so
    // stable ordering matters more there than blended ranking.
    const fusionWindow = this.config.get<number>('SEARCH_FUSION_WINDOW', 100);
    if (rankerV2 && page * limit >= fusionWindow) {
      return {
        ...this.finalizeKeywordOnly(bm25Result, rankerV2, page, limit),
        intentKind,
        cleanedQuery,
      };
    }

    const fusedItems = this.reciprocalRankFusion(bm25Result.items, knnResult.items);

    if (rankerV2) {
      // BM25 already returned exactly this page; fusion reorders it and blends
      // in kNN neighbours, so there is nothing further to slice off the front.
      return {
        items: fusedItems.slice(0, limit),
        total: bm25Result.total,
        approximateTotal: bm25Result.approximateTotal,
        maxScore: bm25Result.maxScore,
        timedOut: bm25Result.timedOut || knnResult.timedOut,
        searchType: 'hybrid',
        intentKind,
        cleanedQuery,
        ...(bm25Result.didYouMean && { didYouMean: bm25Result.didYouMean }),
      };
    }

    const paginatedItems = fusedItems.slice(page * limit, (page + 1) * limit);
    return {
      items: paginatedItems,
      total: fusedItems.length,
      approximateTotal: false,
      maxScore: paginatedItems.length > 0 ? paginatedItems[0]!.score : null,
      timedOut: bm25Result.timedOut || knnResult.timedOut,
      searchType: 'hybrid',
      intentKind,
      cleanedQuery,
    };
  }

  /**
   * Shape a BM25-only result. Under v2 OpenSearch already collapsed and
   * paginated; under v1 we still de-dupe and slice in JS.
   */
  private finalizeKeywordOnly(
    bm25Result: KeywordSearchResult,
    rankerV2: boolean,
    page: number,
    limit: number,
  ) {
    if (rankerV2) {
      return {
        items: bm25Result.items,
        total: bm25Result.total,
        approximateTotal: bm25Result.approximateTotal,
        maxScore: bm25Result.maxScore,
        timedOut: bm25Result.timedOut,
        searchType: 'keyword_only' as const,
        ...(bm25Result.didYouMean && { didYouMean: bm25Result.didYouMean }),
      };
    }

    const deduped = this.dedupeByDocumentId(bm25Result.items);
    return {
      items: deduped.slice(page * limit, (page + 1) * limit),
      total: deduped.length,
      approximateTotal: false,
      maxScore: bm25Result.maxScore,
      timedOut: bm25Result.timedOut,
      searchType: 'keyword_only' as const,
    };
  }

  /** Ranking weights, all env-tunable without a code deploy. */
  private resolveWeights(): RankingWeights {
    return {
      officialBoost: this.config.get<number>(
        'SEARCH_BOOST_OFFICIAL',
        DEFAULT_RANKING_WEIGHTS.officialBoost,
      ),
      trustOfficial: this.config.get<number>(
        'SEARCH_BOOST_TRUST_OFFICIAL',
        DEFAULT_RANKING_WEIGHTS.trustOfficial,
      ),
      trustSemiOfficial: this.config.get<number>(
        'SEARCH_BOOST_TRUST_SEMI_OFFICIAL',
        DEFAULT_RANKING_WEIGHTS.trustSemiOfficial,
      ),
      trustEditorial: this.config.get<number>(
        'SEARCH_BOOST_TRUST_EDITORIAL',
        DEFAULT_RANKING_WEIGHTS.trustEditorial,
      ),
      recencyScaleDays: this.config.get<number>(
        'SEARCH_RECENCY_SCALE_DAYS',
        DEFAULT_RANKING_WEIGHTS.recencyScaleDays,
      ),
      recencyDecay: this.config.get<number>(
        'SEARCH_RECENCY_DECAY',
        DEFAULT_RANKING_WEIGHTS.recencyDecay,
      ),
      recencyWeight: this.config.get<number>(
        'SEARCH_RECENCY_WEIGHT',
        DEFAULT_RANKING_WEIGHTS.recencyWeight,
      ),
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

  /**
   * Cache key for the DOCUMENT arm only.
   *
   * `scope` is deliberately excluded: the document results for a given query are
   * identical whether or not derivatives were also requested, so a federated and
   * a legacy request share the entry.
   *
   * Derivative results are NOT cached at all. Their visibility depends on the
   * caller's organization, so a correct key would have to include the org — and
   * a key that is wrong by omission serves one tenant's private artifacts to
   * another. That is a cross-tenant read, which is not a risk worth a cache hit;
   * the derivative arm queries OpenSearch every time. If this ever needs
   * caching, the org id must be IN the key, not merely near it.
   */
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

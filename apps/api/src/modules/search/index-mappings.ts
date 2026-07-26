/**
 * OpenSearch index topology and mappings.
 *
 * Why this file exists: the previous mappings lived inline in
 * `opensearch.service.ts` and were only reachable from the admin
 * `POST /search/index/initialize` endpoint. In production the first
 * `indexDocument()` write therefore auto-created the indices with OpenSearch
 * *dynamic* mappings — every `keyword` field became analysed `text`, so every
 * `term`/`terms` filter silently matched nothing and the vector index had no
 * `knn_vector` field at all.
 *
 * Two structural changes prevent a repeat:
 *  1. **Aliases over versioned physical indices.** Reads and writes address the
 *     alias (`legal_documents_keyword`); the data lives in
 *     `legal_documents_keyword_v2`. A future mapping change builds `_v3` and
 *     flips the alias atomically — no downtime, no in-place mutation.
 *  2. **`dynamic: 'strict'`.** An unmapped field now raises
 *     `strict_dynamic_mapping_exception` on write instead of being silently
 *     auto-mapped. A mapping gap fails loudly and early.
 */

/**
 * Physical index version suffix. Bump to `v3` when a mapping change requires a
 * reindex; the rebuild job then builds the new physical index and repoints the
 * alias.
 */
export const INDEX_VERSION = 'v3';

/** Alias names — the ONLY names application code should read from or write to. */
export const KEYWORD_INDEX = 'legal_documents_keyword';
export const VECTOR_INDEX = 'legal_documents_vector';
export const USER_UPLOADS_INDEX = 'user_uploads_searchable';
export const DERIVATIVES_INDEX = 'derivative_artifacts';

/** Current physical index backing each alias. */
export const KEYWORD_INDEX_PHYSICAL = `${KEYWORD_INDEX}_${INDEX_VERSION}`;
export const VECTOR_INDEX_PHYSICAL = `${VECTOR_INDEX}_${INDEX_VERSION}`;
export const USER_UPLOADS_INDEX_PHYSICAL = `${USER_UPLOADS_INDEX}_${INDEX_VERSION}`;
export const DERIVATIVES_INDEX_PHYSICAL = `${DERIVATIVES_INDEX}_${INDEX_VERSION}`;

/** Default embedding dimension — `BAAI/bge-small-en-v1.5` emits 384. */
export const DEFAULT_EMBEDDING_DIM = 384;

/**
 * Search-time-only synonym expansions. Kept deliberately small and lowercase
 * (the filter runs after `lowercase` in the chain). Because these apply only to
 * `legal_search_analyzer`, the list can be changed with a close/update/open
 * cycle — no reindex required.
 */
export const LEGAL_SYNONYMS = [
  'gr, grn => g.r',
  'sc => supreme court',
  'ra => republic act',
  'pd => presidential decree',
  'eo => executive order',
  'bp => batas pambansa',
  'roc => rules of court',
  'am => administrative matter',
  'ac => administrative case',
];

/**
 * Shared analysis block. `legal_analyzer` is the index-time analyzer;
 * `legal_search_analyzer` is the same chain plus synonyms and is only ever
 * referenced as a `search_analyzer`.
 */
const ANALYSIS = {
  char_filter: {
    // Mirror of `normalizeCitationKey()` in citation-utils.ts.
    citation_strip: {
      type: 'pattern_replace',
      pattern: '[.,\\s]',
      replacement: '',
    },
  },
  filter: {
    legal_synonyms: {
      type: 'synonym_graph',
      lenient: true,
      synonyms: LEGAL_SYNONYMS,
    },
  },
  analyzer: {
    legal_analyzer: {
      type: 'custom',
      tokenizer: 'standard',
      filter: ['lowercase', 'asciifolding'],
    },
    legal_search_analyzer: {
      type: 'custom',
      tokenizer: 'standard',
      filter: ['lowercase', 'asciifolding', 'legal_synonyms'],
    },
  },
  normalizer: {
    citation_normalizer: {
      type: 'custom',
      char_filter: ['citation_strip'],
      filter: ['lowercase'],
    },
  },
} as const;

const BASE_SETTINGS = {
  number_of_shards: 1,
  number_of_replicas: 0,
  refresh_interval: '5s',
  'index.max_result_window': 10_000,
  analysis: ANALYSIS,
};

/**
 * Keyword (BM25) index. Every field that is filtered on is `keyword`; the three
 * large full-text fields deliberately have no `.keyword` sub-field (that alone
 * cuts roughly 40% of index size on a corpus of decision bodies).
 */
export function buildKeywordIndexMapping(): Record<string, unknown> {
  return {
    settings: BASE_SETTINGS,
    mappings: {
      dynamic: 'strict',
      properties: {
        // --- full text ---
        title: {
          type: 'text',
          analyzer: 'legal_analyzer',
          search_analyzer: 'legal_search_analyzer',
          fields: {
            keyword: { type: 'keyword', ignore_above: 512 },
            suggest: { type: 'search_as_you_type', analyzer: 'legal_analyzer' },
          },
        },
        short_title: { type: 'text', analyzer: 'legal_analyzer' },
        plain_text: {
          type: 'text',
          analyzer: 'legal_analyzer',
          search_analyzer: 'legal_search_analyzer',
        },
        section_text: {
          type: 'text',
          analyzer: 'legal_analyzer',
          search_analyzer: 'legal_search_analyzer',
        },

        // --- citations: analysed for phrase match, `raw` for exact term match ---
        citation_text: {
          type: 'text',
          analyzer: 'legal_analyzer',
          fields: {
            raw: { type: 'keyword', normalizer: 'citation_normalizer' },
          },
        },
        gr_no: {
          type: 'keyword',
          fields: {
            raw: { type: 'keyword', normalizer: 'citation_normalizer' },
          },
        },
        // Digits-and-hyphens-only form of gr_no — makes bare-number lookup
        // (`246999`) an exact term match. Derived by deriveGrNoDigits().
        gr_no_digits: { type: 'keyword' },
        docket_no: {
          type: 'keyword',
          fields: {
            raw: { type: 'keyword', normalizer: 'citation_normalizer' },
          },
        },

        // --- people: keyword for exact filter, .text for name search ---
        ponente: {
          type: 'keyword',
          fields: {
            text: { type: 'text', analyzer: 'legal_analyzer' },
          },
        },

        // --- filterable metadata (the single highest-impact fix) ---
        document_id: { type: 'keyword' },
        section_id: { type: 'keyword' },
        document_type: { type: 'keyword' },
        // `court` keeps the raw display literal ("Supreme Court") because the
        // reader and suggestion rows render it verbatim; `court_key` is the
        // snake_case form filters actually match on. Same split as
        // gr_no / gr_no_digits, and for the same reason.
        court: { type: 'keyword' },
        court_key: { type: 'keyword' },
        jurisdiction: { type: 'keyword' },
        language: { type: 'keyword' },
        status: { type: 'keyword' },
        source_id: { type: 'keyword' },
        source_trust_level: { type: 'keyword' },
        section_type: { type: 'keyword' },
        bar_subjects: { type: 'keyword' },
        topics: { type: 'keyword' },

        // --- booleans / dates ---
        is_official: { type: 'boolean' },
        is_published: { type: 'boolean' },
        decision_date: { type: 'date' },
        promulgation_date: { type: 'date' },
        publication_date: { type: 'date' },
        created_at: { type: 'date' },
      },
    },
  };
}

/**
 * Vector (kNN) index. `dimension` MUST match what the embedding service emits —
 * it is read from `EMBEDDING_DIM` and never hardcoded, because a mismatch makes
 * the index reject every single vector write.
 */
export function buildVectorIndexMapping(
  dimension: number,
): Record<string, unknown> {
  return {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
      refresh_interval: '5s',
      'index.knn': true,
      analysis: ANALYSIS,
    },
    mappings: {
      dynamic: 'strict',
      properties: {
        embedding_vector: {
          type: 'knn_vector',
          dimension,
          method: {
            name: 'hnsw',
            space_type: 'cosinesimil',
            engine: 'lucene',
            parameters: { ef_construction: 256, m: 16 },
          },
        },
        document_id: { type: 'keyword' },
        section_id: { type: 'keyword' },
        document_type: { type: 'keyword' },
        court: { type: 'keyword' },
        // Present so vectors written from now on are filterable by key. Note
        // that documents COPIED forward by the rebuild job predate the field —
        // `searchVector()` therefore matches either form. See its court clause.
        court_key: { type: 'keyword' },
        source_trust_level: { type: 'keyword' },
        is_official: { type: 'boolean' },
        is_published: { type: 'boolean' },
        decision_date: { type: 'date' },
        text_snippet: { type: 'text', analyzer: 'legal_analyzer' },
        title: { type: 'text', analyzer: 'legal_analyzer' },
        citation_text: { type: 'keyword' },
      },
    },
  };
}

/**
 * User uploads live in their own index per CLAUDE.md ("never co-mingle with
 * editorial corpus"). `organization_id` is a mandatory keyword filter for
 * tenant isolation — it was one of the fields silently mapped as analysed
 * `text` in prod, which is precisely why it must be explicit here.
 */
export function buildUserUploadsIndexMapping(): Record<string, unknown> {
  return {
    settings: BASE_SETTINGS,
    mappings: {
      dynamic: 'strict',
      properties: {
        upload_id: { type: 'keyword' },
        organization_id: { type: 'keyword' },
        user_id: { type: 'keyword' },
        ocr_text: {
          type: 'text',
          analyzer: 'legal_analyzer',
          search_analyzer: 'legal_search_analyzer',
        },
        original_filename: {
          type: 'text',
          analyzer: 'legal_analyzer',
          fields: { keyword: { type: 'keyword', ignore_above: 512 } },
        },
        classified_document_type: { type: 'keyword' },
        upload_type: { type: 'keyword' },
        mime_type: { type: 'keyword' },
        privacy_level: { type: 'keyword' },
        extracted_citations: { type: 'keyword' },
        created_at: { type: 'date' },
      },
    },
  };
}

/**
 * Derivative artifacts (~100k rows) — digests, outlines, flashcards, model
 * answers and the rest of the 11 shapes. Today these are searchable only via
 * `title ILIKE '%q%'`; this index makes their bodies reachable.
 *
 * **BM25 only — no `knn_vector` field, deliberately.** Embedding ~100k
 * derivative bodies costs materially more than the recall it buys here:
 * derivatives are short, heavily titled, and already reachable semantically
 * through the source document they derive from. Adding a vector field later is
 * a new physical index plus an alias flip, the same as any other mapping
 * change — nothing about this decision is one-way.
 *
 * **SECURITY — no MCQ answer-key fields.** There is deliberately no mapping for
 * `isCorrect`, `rationale` or `explanation`. With `dynamic: 'strict'` this is
 * enforced by OpenSearch and not merely by convention: were the extractor ever
 * to regress and emit one, the write would fail with
 * `strict_dynamic_mapping_exception` instead of silently publishing an answer
 * key. `derivative-extract.ts` is the first line of that defence and this
 * mapping is the second. An admin-facing rationale search is a SEPARATE index.
 *
 * `organization_id` and `visibility` are mapped here but not yet filtered on —
 * C2 owns the query path. They must exist in the mapping before C2 can filter
 * on them, and an unmapped field under `dynamic: 'strict'` would reject the
 * write outright.
 */
export function buildDerivativesIndexMapping(): Record<string, unknown> {
  return {
    settings: BASE_SETTINGS,
    mappings: {
      dynamic: 'strict',
      properties: {
        // --- full text ---
        title: {
          type: 'text',
          analyzer: 'legal_analyzer',
          search_analyzer: 'legal_search_analyzer',
          fields: {
            keyword: { type: 'keyword', ignore_above: 512 },
            suggest: { type: 'search_as_you_type', analyzer: 'legal_analyzer' },
          },
        },
        // The joined output of extractSearchableText(). No `.keyword`
        // sub-field: it is never filtered or aggregated on, and derivative
        // bodies are long enough that one would be pure index bloat.
        body_text: {
          type: 'text',
          analyzer: 'legal_analyzer',
          search_analyzer: 'legal_search_analyzer',
        },

        // --- identity / filterable metadata ---
        derivative_id: { type: 'keyword' },
        derivative_type: { type: 'keyword' },
        source_document_id: { type: 'keyword' },
        organization_id: { type: 'keyword' },
        visibility: { type: 'keyword' },
        audience: { type: 'keyword' },
        language: { type: 'keyword' },
        subject_codes: { type: 'keyword' },
        taxonomy_version: { type: 'keyword' },
        upgrade_tier: { type: 'keyword' },

        // --- booleans / numerics / dates ---
        is_gated: { type: 'boolean' },
        is_published: { type: 'boolean' },
        confidence_score: { type: 'float' },
        created_at: { type: 'date' },
        published_at: { type: 'date' },
      },
    },
  };
}

export interface IndexTopologyEntry {
  alias: string;
  physical: string;
  buildMapping: (dimension: number) => Record<string, unknown>;
}

/** The three logical indices, in creation order. */
export const INDEX_TOPOLOGY: readonly IndexTopologyEntry[] = [
  {
    alias: KEYWORD_INDEX,
    physical: KEYWORD_INDEX_PHYSICAL,
    buildMapping: () => buildKeywordIndexMapping(),
  },
  {
    alias: VECTOR_INDEX,
    physical: VECTOR_INDEX_PHYSICAL,
    buildMapping: (dimension: number) => buildVectorIndexMapping(dimension),
  },
  {
    alias: USER_UPLOADS_INDEX,
    physical: USER_UPLOADS_INDEX_PHYSICAL,
    buildMapping: () => buildUserUploadsIndexMapping(),
  },
] as const;

/**
 * The derivatives index, defined but deliberately NOT yet in INDEX_TOPOLOGY.
 *
 * Adding it to the topology array is what makes the rebuild job create and
 * populate it — that wiring, along with the query path and tenant/visibility
 * filtering, is C2. Keeping the entry separate means C1 ships the mapping with
 * zero change to what the rebuild job does today: the existing three indices
 * are built exactly as before. C2 appends this to INDEX_TOPOLOGY.
 */
export const DERIVATIVES_INDEX_ENTRY: IndexTopologyEntry = {
  alias: DERIVATIVES_INDEX,
  physical: DERIVATIVES_INDEX_PHYSICAL,
  buildMapping: () => buildDerivativesIndexMapping(),
};

import {
  INDEX_TOPOLOGY,
  INDEX_VERSION,
  KEYWORD_INDEX,
  KEYWORD_INDEX_PHYSICAL,
  USER_UPLOADS_INDEX,
  VECTOR_INDEX,
  buildKeywordIndexMapping,
  buildUserUploadsIndexMapping,
  buildVectorIndexMapping,
} from './index-mappings';

type Props = Record<string, Record<string, unknown>>;

const keywordProps = () =>
  (buildKeywordIndexMapping()['mappings'] as { properties: Props }).properties;

describe('index topology', () => {
  it('points each alias at a versioned physical index', () => {
    expect(KEYWORD_INDEX_PHYSICAL).toBe(`${KEYWORD_INDEX}_${INDEX_VERSION}`);
    expect(INDEX_TOPOLOGY.map((entry) => entry.alias)).toEqual([
      KEYWORD_INDEX,
      VECTOR_INDEX,
      USER_UPLOADS_INDEX,
    ]);
    for (const entry of INDEX_TOPOLOGY) {
      expect(entry.physical).toBe(`${entry.alias}_${INDEX_VERSION}`);
    }
  });
});

describe('keyword index mapping', () => {
  it('is strict so a mapping gap fails loudly instead of auto-mapping', () => {
    const mappings = buildKeywordIndexMapping()['mappings'] as Record<string, unknown>;
    expect(mappings['dynamic']).toBe('strict');
  });

  // The regression this whole PR exists for: these fields were dynamically
  // mapped as analysed `text` in prod, so every term/terms filter matched zero
  // documents.
  it.each([
    'document_type',
    'court',
    'jurisdiction',
    'language',
    'status',
    'source_id',
    'source_trust_level',
    'section_type',
    'document_id',
    'section_id',
    'bar_subjects',
    'topics',
    'gr_no_digits',
  ])('maps %s as keyword so term filters match', (field) => {
    expect(keywordProps()[field]).toEqual({ type: 'keyword' });
  });

  it('gives ponente a .text sub-field so name search works', () => {
    const ponente = keywordProps()['ponente'] as {
      type: string;
      fields: Record<string, Record<string, unknown>>;
    };
    expect(ponente.type).toBe('keyword');
    expect(ponente.fields['text']).toEqual({
      type: 'text',
      analyzer: 'legal_analyzer',
    });
  });

  it('gives citation fields a normalized .raw sub-field for exact lookup', () => {
    for (const field of ['citation_text', 'gr_no', 'docket_no']) {
      const mapping = keywordProps()[field] as {
        fields: Record<string, Record<string, unknown>>;
      };
      expect(mapping.fields['raw']).toEqual({
        type: 'keyword',
        normalizer: 'citation_normalizer',
      });
    }
  });

  it('gives title a search_as_you_type sub-field for suggestions', () => {
    const title = keywordProps()['title'] as {
      fields: Record<string, Record<string, unknown>>;
    };
    expect(title.fields['suggest']?.['type']).toBe('search_as_you_type');
    expect(title.fields['keyword']).toEqual({ type: 'keyword', ignore_above: 512 });
  });

  it('omits .keyword on the large full-text fields to save index size', () => {
    for (const field of ['plain_text', 'section_text', 'short_title']) {
      expect(keywordProps()[field]).not.toHaveProperty('fields');
    }
  });

  it('applies synonyms only at search time so the list needs no reindex', () => {
    const settings = buildKeywordIndexMapping()['settings'] as {
      analysis: {
        analyzer: Record<string, { filter: string[] }>;
      };
    };
    expect(settings.analysis.analyzer['legal_analyzer']!.filter).not.toContain(
      'legal_synonyms',
    );
    expect(settings.analysis.analyzer['legal_search_analyzer']!.filter).toContain(
      'legal_synonyms',
    );
    // No index-time field may declare the synonym analyzer as its `analyzer`.
    for (const mapping of Object.values(keywordProps())) {
      expect(mapping['analyzer']).not.toBe('legal_search_analyzer');
    }
  });

  it('matches the mapping snapshot', () => {
    expect(buildKeywordIndexMapping()).toMatchSnapshot();
  });
});

describe('vector index mapping', () => {
  it('enables index.knn and sizes knn_vector from the supplied dimension', () => {
    const mapping = buildVectorIndexMapping(384);
    expect((mapping['settings'] as Record<string, unknown>)['index.knn']).toBe(true);

    const props = (mapping['mappings'] as { properties: Props }).properties;
    expect(props['embedding_vector']).toEqual({
      type: 'knn_vector',
      dimension: 384,
      method: {
        name: 'hnsw',
        space_type: 'cosinesimil',
        engine: 'lucene',
        parameters: { ef_construction: 256, m: 16 },
      },
    });
  });

  it('never hardcodes 1024 — the dimension is whatever the caller passes', () => {
    const props = (
      buildVectorIndexMapping(768)['mappings'] as { properties: Props }
    ).properties;
    expect(props['embedding_vector']!['dimension']).toBe(768);
  });

  it('matches the mapping snapshot', () => {
    expect(buildVectorIndexMapping(384)).toMatchSnapshot();
  });
});

describe('user uploads index mapping', () => {
  it('maps organization_id as keyword — tenant isolation depends on it', () => {
    const props = (
      buildUserUploadsIndexMapping()['mappings'] as { properties: Props }
    ).properties;
    expect(props['organization_id']).toEqual({ type: 'keyword' });
    expect(props['privacy_level']).toEqual({ type: 'keyword' });
  });

  it('matches the mapping snapshot', () => {
    expect(buildUserUploadsIndexMapping()).toMatchSnapshot();
  });
});

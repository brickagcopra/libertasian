import {
  MAX_EMBEDDING_TEXT_LENGTH,
  MIN_SECTION_TEXT_LENGTH,
  SNIPPET_LENGTH,
  buildVectorEmbeddingInputs,
  joinSectionText,
  toVectorDocumentPayload,
  toVectorPayloadBase,
  vectorDocumentId,
} from './vector-embedding-inputs';

/**
 * These rules are shared by the live indexing path and the backfill. A
 * divergence here is not a cosmetic bug: it puts two populations of vectors
 * into one index, where the same query gets a different answer depending on
 * which code path happened to write the chunk.
 */
describe('vector embedding inputs', () => {
  const section = (id: string, text: string | null) => ({ id, plainText: text });

  describe('buildVectorEmbeddingInputs', () => {
    it('emits the document-level vector first, then one per section', () => {
      const sections = [
        section('sec-1', 'A'.repeat(100)),
        section('sec-2', 'B'.repeat(100)),
      ];
      const inputs = buildVectorEmbeddingInputs(
        { id: 'doc-1', title: 'Republic Act No. 386', sections },
        joinSectionText(sections),
      );

      expect(inputs).toHaveLength(3);
      expect(inputs[0]!.sectionId).toBeUndefined();
      expect(inputs[0]!.documentId).toBe('doc-1');
      expect(inputs.slice(1).map((i) => i.sectionId)).toEqual(['sec-1', 'sec-2']);
    });

    it('skips a section under the minimum length', () => {
      const short = 'Article 1.';
      expect(short.length).toBeLessThan(MIN_SECTION_TEXT_LENGTH);

      const sections = [section('sec-short', short), section('sec-long', 'C'.repeat(60))];
      const inputs = buildVectorEmbeddingInputs(
        { id: 'doc-1', title: 'Civil Code', sections },
        joinSectionText(sections),
      );

      expect(inputs.map((i) => i.sectionId)).toEqual([undefined, 'sec-long']);
    });

    it('skips a section at exactly one character below the minimum, keeps it at the minimum', () => {
      const below = 'x'.repeat(MIN_SECTION_TEXT_LENGTH - 1);
      const atBoundary = 'y'.repeat(MIN_SECTION_TEXT_LENGTH);
      const sections = [section('below', below), section('at', atBoundary)];

      const inputs = buildVectorEmbeddingInputs(
        { id: 'doc-1', title: 'T', sections },
        joinSectionText(sections),
      );

      expect(inputs.map((i) => i.sectionId)).toEqual([undefined, 'at']);
    });

    it('skips sections with null plain text', () => {
      const sections = [section('sec-null', null), section('sec-ok', 'D'.repeat(80))];
      const inputs = buildVectorEmbeddingInputs(
        { id: 'doc-1', title: 'T', sections },
        joinSectionText(sections),
      );

      expect(inputs.map((i) => i.sectionId)).toEqual([undefined, 'sec-ok']);
    });

    it('emits nothing at all for a document with no embeddable text', () => {
      const sections = [section('sec-null', null), section('sec-short', 'tiny')];
      const inputs = buildVectorEmbeddingInputs(
        { id: 'doc-1', title: 'T', sections },
        joinSectionText(sections),
      );

      // The document-level vector is suppressed too: `joinSectionText` of a
      // null and a short section is 'tiny', which is non-empty, so the
      // doc-level vector DOES survive. Assert the real behaviour rather than
      // the convenient one.
      expect(inputs).toHaveLength(1);
      expect(inputs[0]!.sectionId).toBeUndefined();
    });

    it('emits nothing when there is no text anywhere', () => {
      const sections = [section('sec-null', null)];
      const inputs = buildVectorEmbeddingInputs(
        { id: 'doc-1', title: 'T', sections },
        joinSectionText(sections),
      );
      expect(inputs).toEqual([]);
    });

    it('truncates both the document text and each section at the ceiling', () => {
      const long = 'Z'.repeat(MAX_EMBEDDING_TEXT_LENGTH + 5_000);
      const sections = [section('sec-1', long)];
      const inputs = buildVectorEmbeddingInputs(
        { id: 'doc-1', title: 'Long', sections },
        joinSectionText(sections),
      );

      expect(inputs[0]!.text).toHaveLength(MAX_EMBEDDING_TEXT_LENGTH);
      expect(inputs[1]!.text).toHaveLength(MAX_EMBEDDING_TEXT_LENGTH);
    });

    it('prefixes the document-level text with the title', () => {
      const sections = [section('sec-1', 'E'.repeat(80))];
      const inputs = buildVectorEmbeddingInputs(
        { id: 'doc-1', title: 'Rules of Court', sections },
        joinSectionText(sections),
      );
      expect(inputs[0]!.text.startsWith('Rules of Court\n\n')).toBe(true);
    });

    it('caps snippets at the display length', () => {
      const long = 'F'.repeat(SNIPPET_LENGTH + 200);
      const sections = [section('sec-1', long)];
      const inputs = buildVectorEmbeddingInputs(
        { id: 'doc-1', title: 'T', sections },
        joinSectionText(sections),
      );
      for (const input of inputs) {
        expect(input.snippet.length).toBeLessThanOrEqual(SNIPPET_LENGTH);
      }
    });
  });

  describe('vectorDocumentId', () => {
    it('is the section id when there is one', () => {
      expect(vectorDocumentId({ documentId: 'doc-1', sectionId: 'sec-1' })).toBe('sec-1');
    });

    it('falls back to the document id for the document-level vector', () => {
      expect(vectorDocumentId({ documentId: 'doc-1' })).toBe('doc-1');
    });

    it('is stable, which is what makes a re-run an overwrite rather than a duplicate', () => {
      const input = { documentId: 'doc-1', sectionId: 'sec-1' };
      expect(vectorDocumentId(input)).toBe(vectorDocumentId({ ...input }));
    });
  });

  describe('joinSectionText', () => {
    it('drops empty sections and joins with a blank line', () => {
      expect(
        joinSectionText([
          { plainText: 'one' },
          { plainText: null },
          { plainText: '' },
          { plainText: 'two' },
        ]),
      ).toBe('one\n\ntwo');
    });
  });

  describe('payload assembly', () => {
    const basePayload = {
      document_type: 'codal',
      court: 'Supreme Court',
      source_trust_level: 'official',
      is_official: true,
      is_published: true,
      decision_date: '2020-01-01T00:00:00.000Z',
      title: 'Civil Code',
      citation_text: 'R.A. No. 386',
    };

    it('narrows a keyword payload to the vector fields', () => {
      const base = toVectorPayloadBase({ ...basePayload, plain_text: 'ignored' } as never);
      expect(base).toEqual(basePayload);
      expect(base as Record<string, unknown>).not.toHaveProperty('plain_text');
    });

    it('carries the embedding, id and snippet onto the vector document', () => {
      const payload = toVectorDocumentPayload(
        { documentId: 'doc-1', sectionId: 'sec-1', text: 'body', snippet: 'snip' },
        toVectorPayloadBase(basePayload),
        [0.1, 0.2, 0.3],
      );

      expect(payload).toMatchObject({
        document_id: 'doc-1',
        section_id: 'sec-1',
        text_snippet: 'snip',
        embedding_vector: [0.1, 0.2, 0.3],
        document_type: 'codal',
        title: 'Civil Code',
      });
      // The raw text is never stored — only the snippet.
      expect(payload as unknown as Record<string, unknown>).not.toHaveProperty('text');
    });
  });
});

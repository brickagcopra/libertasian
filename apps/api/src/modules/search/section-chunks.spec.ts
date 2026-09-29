import type { IndexDocumentPayload } from './opensearch.service';
import {
  CHUNK_MIN_SECTION_LENGTH,
  CHUNK_OVERLAP,
  CHUNK_SNAP_WINDOW,
  CHUNK_TARGET_LENGTH,
  chunkSection,
  indexRowId,
  sectionKeywordRows,
} from './section-chunks';

/** Deterministic prose: numbered sentences of varying length. */
function prose(chars: number): string {
  const parts: string[] = [];
  let n = 0;
  let length = 0;
  while (length < chars) {
    const filler = 'the petitioner argues '.repeat(1 + (n % 5));
    const sentence = `Sentence ${n} states that ${filler}the point.`;
    parts.push(sentence);
    length += sentence.length + 1;
    n++;
  }
  return parts.join(' ');
}

describe('chunkSection', () => {
  it('does not chunk a section at or under the threshold', () => {
    expect(chunkSection('')).toEqual([]);
    expect(chunkSection(prose(1_000).slice(0, 1_000))).toEqual([]);
    expect(chunkSection('x'.repeat(CHUNK_MIN_SECTION_LENGTH))).toEqual([]);
  });

  it('chunks a section one character over the threshold', () => {
    const text = prose(3_000).slice(0, CHUNK_MIN_SECTION_LENGTH + 1);
    expect(chunkSection(text).length).toBeGreaterThanOrEqual(2);
  });

  it('round-trips: every chunk is exactly its slice of the input', () => {
    const text = prose(12_000);
    for (const chunk of chunkSection(text)) {
      expect(chunk.text).toBe(text.slice(chunk.charStart, chunk.charEnd));
    }
  });

  it('covers the whole text, in order, with ~150-char overlaps', () => {
    const text = prose(12_000);
    const chunks = chunkSection(text);

    expect(chunks[0]!.charStart).toBe(0);
    expect(chunks[chunks.length - 1]!.charEnd).toBe(text.length);
    chunks.forEach((chunk, i) => expect(chunk.index).toBe(i));

    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      const cur = chunks[i]!;
      expect(cur.charStart).toBeGreaterThan(prev.charStart);
      // Overlaps the previous chunk (no gap), by roughly CHUNK_OVERLAP.
      const overlap = prev.charEnd - cur.charStart;
      expect(overlap).toBeGreaterThan(CHUNK_OVERLAP - 60);
      expect(overlap).toBeLessThan(CHUNK_OVERLAP + 60);
    }
  });

  it('keeps every chunk near the target length', () => {
    const chunks = chunkSection(prose(20_000));
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_TARGET_LENGTH + CHUNK_SNAP_WINDOW);
    }
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.length).toBeGreaterThanOrEqual(
        CHUNK_TARGET_LENGTH - CHUNK_SNAP_WINDOW - 1,
      );
    }
  });

  it('snaps each boundary to a sentence end', () => {
    const chunks = chunkSection(prose(12_000));
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.endsWith('the point.')).toBe(true);
    }
    // Chunks after the first start on a word, never on whitespace.
    for (const chunk of chunks.slice(1)) {
      expect(chunk.text[0]).toMatch(/\S/);
    }
  });

  it('prefers a real sentence end over a nearer citation abbreviation', () => {
    // ~330 chars of abbreviation periods ("G.R.", "No.", "Art.", "Sec.",
    // "v.") between real sentence ends, so every ±200 window holds both.
    const citation = 'As held in G.R. No. 12345 and Art. III Sec. 5 of People v. Cruz ';
    const text = `${citation.repeat(5)}The Court agrees. `.repeat(20).trim();
    const chunks = chunkSection(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.endsWith('The Court agrees.')).toBe(true);
    }
  });

  it('falls back to whitespace when there is no sentence end in the window', () => {
    const text = 'word '.repeat(1_000).trim();
    const chunks = chunkSection(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).toMatch(/^word( word)*$/);
    }
  });

  it('falls back to the exact target when there is no whitespace at all', () => {
    const text = 'x'.repeat(5_000);
    const chunks = chunkSection(text);
    expect(chunks[0]!.charEnd).toBe(CHUNK_TARGET_LENGTH);
    expect(chunks[1]!.charStart).toBe(CHUNK_TARGET_LENGTH - CHUNK_OVERLAP);
    expect(chunks[chunks.length - 1]!.charEnd).toBe(text.length);
  });

  it('is deterministic', () => {
    const text = prose(9_000);
    expect(chunkSection(text)).toEqual(chunkSection(text));
  });
});

describe('indexRowId', () => {
  it('names document, section and chunk rows', () => {
    expect(indexRowId({ document_id: 'doc' })).toBe('doc');
    expect(indexRowId({ document_id: 'doc', section_id: 'sec' })).toBe('sec');
    expect(indexRowId({ document_id: 'doc', section_id: 'sec', chunk_index: 0 })).toBe(
      'sec:c0',
    );
    expect(indexRowId({ document_id: 'doc', section_id: 'sec', chunk_index: 7 })).toBe(
      'sec:c7',
    );
  });
});

describe('sectionKeywordRows', () => {
  const base: IndexDocumentPayload = {
    document_id: 'doc-1',
    title: 'People v. Cruz',
    document_type: 'decision',
    status: 'published',
    is_official: true,
    is_published: true,
    created_at: '2020-01-01T00:00:00.000Z',
  };

  it('writes a short section as one row, unchanged', () => {
    const rows = sectionKeywordRows(base, {
      id: 'sec-1',
      sectionType: 'facts',
      plainText: 'Short facts.',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      section_id: 'sec-1',
      section_type: 'facts',
      section_text: 'Short facts.',
    });
    expect(rows[0]!.chunk_index).toBeUndefined();
    expect(indexRowId(rows[0]!)).toBe('sec-1');
  });

  it('writes a long section as chunk rows instead of its one section row', () => {
    const text = prose(8_000);
    const chunks = chunkSection(text);
    const rows = sectionKeywordRows(base, {
      id: 'sec-9',
      sectionType: 'ruling',
      plainText: text,
    });

    expect(rows).toHaveLength(chunks.length);
    rows.forEach((row, n) => {
      expect(indexRowId(row)).toBe(`sec-9:c${n}`);
      expect(row).toMatchObject({
        document_id: 'doc-1',
        section_id: 'sec-9',
        section_type: 'ruling',
        section_text: chunks[n]!.text,
        chunk_index: n,
        char_start: chunks[n]!.charStart,
        char_end: chunks[n]!.charEnd,
        title: 'People v. Cruz',
      });
      expect(row.plain_text).toBeUndefined();
    });
    expect(rows.map((row) => indexRowId(row))).not.toContain('sec-9');
  });

  it('writes nothing for a section with no text', () => {
    expect(sectionKeywordRows(base, { id: 's', sectionType: 'x', plainText: null })).toEqual(
      [],
    );
    expect(sectionKeywordRows(base, { id: 's', sectionType: 'x', plainText: '' })).toEqual([]);
  });
});

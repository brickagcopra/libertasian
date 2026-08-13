import { dedupeSources, formatAnswerText, splitCompleteText } from './format-answer-text';
import type { AiAnswerSource } from '../search/types';

const DOC = '2e2bad34-d194-4ddb-9e70-c9d0cd2ff388';
const SEC_A = 'f767e1bc-4578-4a85-a99b-6f9886af62d7';
const SEC_B = '081627b2-5b8e-42a8-b2f5-abb0e00bff2b';
const OTHER_DOC = '9a9a9a9a-0000-0000-0000-000000000000';

function source(over: Partial<AiAnswerSource> = {}): AiAnswerSource {
  return {
    document_id: DOC,
    title: '1987 Constitution',
    relevance_score: 0.9,
    passage_text: '…',
    ...over,
  };
}

describe('formatAnswerText — citation markers', () => {
  it('rewrites a section marker as the 1-based index of its source row', () => {
    const sources = [source({ section_id: SEC_A }), source({ section_id: SEC_B })];

    const out = formatAnswerText(`Sovereignty resides in the people [SOURCE ${DOC}§${SEC_B}].`, sources);

    expect(out).toBe('Sovereignty resides in the people [2].');
    // The whole point: no wire identifiers reach the reader.
    expect(out).not.toContain('SOURCE');
    expect(out).not.toContain(DOC);
    expect(out).not.toContain(SEC_B);
  });

  it('falls back to the first row of the document when the marker has no section', () => {
    const sources = [source({ section_id: SEC_A }), source({ section_id: SEC_B })];

    expect(formatAnswerText(`The territory is defined [SOURCE ${DOC}].`, sources)).toBe(
      'The territory is defined [1].',
    );
  });

  it('falls back to the document row when the section id is not among the sources', () => {
    const sources = [source({ section_id: SEC_A })];

    expect(formatAnswerText(`Text [SOURCE ${DOC}§${SEC_B}].`, sources)).toBe('Text [1].');
  });

  it('removes a marker that resolves to no source at all', () => {
    // A fabricated citation. Showing `[n]` would point the reader at a row
    // that does not exist; showing the raw marker is the bug being fixed.
    const out = formatAnswerText(`Cited claim [SOURCE ${OTHER_DOC}§${SEC_A}].`, [
      source({ section_id: SEC_A }),
    ]);

    expect(out).toBe('Cited claim.');
    expect(out).not.toContain('SOURCE');
    expect(out).not.toContain(OTHER_DOC);
  });

  it('numbers against the deduplicated source list, matching the panel', () => {
    // The reranker returns the same passage twice; the panel collapses it, so
    // the marker for the third distinct passage must read [2], not [3].
    const sources = [
      source({ section_id: SEC_A }),
      source({ section_id: SEC_A }),
      source({ section_id: SEC_B }),
    ];

    expect(formatAnswerText(`Claim [SOURCE ${DOC}§${SEC_B}].`, sources)).toBe('Claim [2].');
  });

  it('handles several markers in one answer', () => {
    const sources = [source({ section_id: SEC_A }), source({ section_id: SEC_B })];

    const out = formatAnswerText(
      `One [SOURCE ${DOC}§${SEC_A}] and two [SOURCE ${DOC}§${SEC_B}].`,
      sources,
    );

    expect(out).toBe('One [1] and two [2].');
  });
});

describe('formatAnswerText — markdown with no renderer', () => {
  it('strips bold and italic to plain prose', () => {
    expect(formatAnswerText('**Democratic and Republican State**: text', [])).toBe(
      'Democratic and Republican State: text',
    );
    expect(formatAnswerText('__also bold__ here', [])).toBe('also bold here');
    expect(formatAnswerText('an *emphasised* word', [])).toBe('an emphasised word');
    expect(formatAnswerText('an _emphasised_ word', [])).toBe('an emphasised word');
  });

  it('removes leading heading markers', () => {
    expect(formatAnswerText('## Key principles\nBody text', [])).toBe('Key principles\nBody text');
  });

  it('leaves a section sign and a lone asterisk alone', () => {
    // `§` is legal notation and must survive; a stray asterisk is not emphasis.
    expect(formatAnswerText('Art. III § 1 applies', [])).toBe('Art. III § 1 applies');
    expect(formatAnswerText('Rule 3* is footnoted', [])).toBe('Rule 3* is footnoted');
    expect(formatAnswerText('a_b_c identifier', [])).toBe('a_b_c identifier');
  });

  it('tidies the whitespace a removed marker leaves behind', () => {
    const out = formatAnswerText(`Claim [SOURCE ${OTHER_DOC}] , and more.\n\n\n\nNext.`, []);

    expect(out).toBe('Claim, and more.\n\nNext.');
  });

  it('returns an empty string for empty input', () => {
    expect(formatAnswerText('', [])).toBe('');
  });
});

describe('dedupeSources', () => {
  it('collapses exact document+section repeats', () => {
    const out = dedupeSources([
      source({ section_id: SEC_A }),
      source({ section_id: SEC_A }),
      source({ section_id: SEC_B }),
    ]);

    expect(out).toHaveLength(2);
  });

  it('keeps distinct sections of the same document', () => {
    // Eight sections of one codal share a title. Collapsing by document_id
    // would throw away real, distinct sources.
    const out = dedupeSources([
      source({ section_id: SEC_A }),
      source({ section_id: SEC_B }),
    ]);

    expect(out).toHaveLength(2);
  });
});

describe('splitCompleteText — streaming hold-back', () => {
  it('holds back a partial marker carrying a real document uuid', () => {
    // Real 36-char uuids, not a truncated stand-in: the length of an actual
    // marker is the whole point of the ceiling this exercises.
    const partial = `[SOURCE ${DOC}§${SEC_A.slice(0, 12)}`;
    expect(splitCompleteText(`The territory ${partial}`)).toEqual({
      emit: 'The territory ',
      hold: partial,
    });
  });

  it('holds back a bare opening bracket', () => {
    expect(splitCompleteText('text [')).toEqual({ emit: 'text ', hold: '[' });
  });

  it('releases the marker once it closes', () => {
    const buffer = `text [SOURCE ${DOC}]`;
    expect(splitCompleteText(buffer)).toEqual({ emit: buffer, hold: '' });
  });

  it('releases a section-qualified marker once it closes', () => {
    const buffer = `text [SOURCE ${DOC}§${SEC_A}]`;
    expect(splitCompleteText(buffer)).toEqual({ emit: buffer, hold: '' });
  });

  it('never shows any part of a section-qualified marker fed one char at a time', () => {
    // The regression this pins: a full `[SOURCE <36>§<36>]` is 82 characters,
    // so an 80-char ceiling tripped one character BEFORE the closing bracket
    // arrived and flushed the partial marker to the screen — the exact flash
    // the gate exists to prevent, on the default marker shape. Only a real
    // 36+36 uuid pair delivered one character at a time reaches that boundary.
    const marker = `[SOURCE ${DOC}§${SEC_A}]`;
    expect(marker).toHaveLength(82);

    const answer = `Sovereignty resides in the people ${marker}. Next sentence.`;
    const sources = [source({ section_id: SEC_A })];

    let held = '';
    let emitted = '';

    for (const ch of answer) {
      const { emit, hold } = splitCompleteText(held + ch);
      held = hold;
      emitted += emit;

      // What the reader would see at this instant. A complete marker is
      // rewritten to `[1]`; a partial one has nothing to match and would
      // survive as raw text — which is what this asserts can never happen.
      const onScreen = formatAnswerText(emitted, sources);
      expect(onScreen).not.toContain('SOURCE');
      expect(onScreen).not.toContain(DOC);
      expect(onScreen).not.toContain(SEC_A);
    }

    // And nothing is lost along the way.
    expect(emitted + held).toBe(answer);
  });

  it('does not hold text that cannot become a marker', () => {
    expect(splitCompleteText('see [Rule 3 of the')).toEqual({
      emit: 'see [Rule 3 of the',
      hold: '',
    });
  });

  it('releases an unclosed bracket followed by 130 characters of prose', () => {
    // The ceiling still has to do its real job: an unclosed `[` in ordinary
    // prose must not swallow the rest of the answer.
    const long = `text [SOURCE ${'x'.repeat(130)}`;
    expect(splitCompleteText(long)).toEqual({ emit: long, hold: '' });
  });

  it('emits everything when there is no bracket at all', () => {
    expect(splitCompleteText('plain prose')).toEqual({ emit: 'plain prose', hold: '' });
  });
});

import {
  DIGEST_CONTENT,
  DOCTRINE_CONTENT,
  ESSAY_CONTENT,
  ESSAY_MODEL_ANSWER_CONTENT,
  FLASHCARD_CONTENT,
  MCQ_CONTENT,
  ONE_PAGE_SUMMARY_CONTENT,
  OUTLINE_CONTENT,
  SAMPLE_CONTRACT_CONTENT,
  SAMPLE_PLEADING_CONTENT,
  SUGGESTED_BAR_ANSWER_CONTENT,
} from '@libertasian/types';

import {
  EXTRACTABLE_TYPES,
  MCQ_FORBIDDEN_KEYS,
  extractSearchableText,
} from './derivative-extract';

/**
 * These fixtures are the SAME objects `apps/web`'s renderer tests run against
 * (the web fixtures module re-exports them from `@libertasian/types`). That is
 * the point: if a content shape changes, the renderers and this extractor break
 * together instead of drifting apart silently.
 */

/** Convenience — the extractor returns blocks; most assertions are on the join. */
const joined = (type: string, content: unknown): string =>
  extractSearchableText(type, content).join('\n');

describe('extractSearchableText', () => {
  describe('coverage of all 11 derivative types', () => {
    const ALL_TYPES: ReadonlyArray<[string, unknown]> = [
      ['case_digest', DIGEST_CONTENT],
      ['doctrine_extract', DOCTRINE_CONTENT],
      ['mcq_question', MCQ_CONTENT],
      ['essay_prompt', ESSAY_CONTENT],
      ['essay_model_answer', ESSAY_MODEL_ANSWER_CONTENT],
      ['suggested_bar_answer', SUGGESTED_BAR_ANSWER_CONTENT],
      ['flashcard', FLASHCARD_CONTENT],
      ['subject_outline', OUTLINE_CONTENT],
      ['sample_pleading', SAMPLE_PLEADING_CONTENT],
      ['sample_contract', SAMPLE_CONTRACT_CONTENT],
      ['one_page_summary', ONE_PAGE_SUMMARY_CONTENT],
    ];

    it('knows exactly the 11 shapes and no others', () => {
      expect([...EXTRACTABLE_TYPES].sort()).toEqual(
        ALL_TYPES.map(([type]) => type).sort(),
      );
    });

    it.each(ALL_TYPES)('extracts non-empty blocks for %s', (type, content) => {
      const blocks = extractSearchableText(type, content);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks.every((block) => block.trim().length > 0)).toBe(true);
    });
  });

  // --- per-shape content assertions -------------------------------------

  it('case_digest: extracts every prose field in reading order', () => {
    const blocks = extractSearchableText('case_digest', DIGEST_CONTENT);
    expect(blocks).toEqual([
      DIGEST_CONTENT.summary,
      DIGEST_CONTENT.facts,
      DIGEST_CONTENT.petitionerArguments,
      DIGEST_CONTENT.respondentArguments,
      ...DIGEST_CONTENT.issues,
      DIGEST_CONTENT.ruling,
      DIGEST_CONTENT.doctrine,
      DIGEST_CONTENT.dispositive,
    ]);
  });

  it('doctrine_extract: reads the snake_case shape', () => {
    const blocks = extractSearchableText('doctrine_extract', DOCTRINE_CONTENT);
    expect(blocks).toEqual(DOCTRINE_CONTENT.doctrines.map((entry) => entry.text));
    // Exactly two blocks: `doctrine_type` and `confidence` are classification
    // metadata, not prose, so they contribute nothing to the searchable body.
    expect(blocks).toHaveLength(DOCTRINE_CONTENT.doctrines.length);
  });

  it('flashcard: extracts both faces of every card', () => {
    const text = joined('flashcard', FLASHCARD_CONTENT);
    for (const card of FLASHCARD_CONTENT.cards) {
      expect(text).toContain(card.front);
      expect(text).toContain(card.back);
    }
  });

  it('suggested_bar_answer: includes annotations and attribution', () => {
    const text = joined('suggested_bar_answer', SUGGESTED_BAR_ANSWER_CONTENT);
    expect(text).toContain(SUGGESTED_BAR_ANSWER_CONTENT.questionText);
    expect(text).toContain(SUGGESTED_BAR_ANSWER_CONTENT.suggestedAnswer);
    for (const annotation of SUGGESTED_BAR_ANSWER_CONTENT.annotations) {
      expect(text).toContain(annotation.quote);
      expect(text).toContain(annotation.commentary);
    }
    expect(text).toContain(SUGGESTED_BAR_ANSWER_CONTENT.sourceAttribution);
  });

  it('sample_pleading: reads caption and parties as an OBJECT of roles', () => {
    const text = joined('sample_pleading', SAMPLE_PLEADING_CONTENT);
    expect(text).toContain(SAMPLE_PLEADING_CONTENT.caption.caseTitle);
    expect(text).toContain(SAMPLE_PLEADING_CONTENT.caption.caseNumber);
    expect(text).toContain(SAMPLE_PLEADING_CONTENT.parties.counsel);
    expect(text).toContain(SAMPLE_PLEADING_CONTENT.prayer);
    expect(text).toContain(SAMPLE_PLEADING_CONTENT.proofOfService);
    expect(text).toContain('Statement of Facts');
  });

  it('sample_contract: reads parties as an ARRAY of roles', () => {
    // Same key name as sample_pleading, different shape — a single shared
    // handler would silently drop one of the two.
    const text = joined('sample_contract', SAMPLE_CONTRACT_CONTENT);
    expect(text).toContain('ABC Realty Corp.');
    expect(text).toContain('456 Ortigas Ave., Pasig City');
    expect(text).toContain(SAMPLE_CONTRACT_CONTENT.recitals[0]);
    expect(text).toContain('Schedule A');
  });

  it('one_page_summary: extracts key points, highlights and quick reference', () => {
    const text = joined('one_page_summary', ONE_PAGE_SUMMARY_CONTENT);
    expect(text).toContain(ONE_PAGE_SUMMARY_CONTENT.bottomLine);
    for (const point of ONE_PAGE_SUMMARY_CONTENT.keyPoints) {
      expect(text).toContain(point);
    }
    for (const highlight of ONE_PAGE_SUMMARY_CONTENT.highlights) {
      expect(text).toContain(highlight.term);
      expect(text).toContain(highlight.definition);
    }
    expect(text).toContain('Rule 113, Sec. 5');
  });

  // --- trap 1: key casing ------------------------------------------------

  describe('key casing', () => {
    it('reads camelCase keys', () => {
      const text = joined('case_digest', {
        petitionerArguments: 'camel petitioner',
        respondentArguments: 'camel respondent',
      });
      expect(text).toContain('camel petitioner');
      expect(text).toContain('camel respondent');
    });

    it('reads the snake_case spelling of the same keys', () => {
      const text = joined('case_digest', {
        petitioner_arguments: 'snake petitioner',
        respondent_arguments: 'snake respondent',
      });
      expect(text).toContain('snake petitioner');
      expect(text).toContain('snake respondent');
    });

    it('reads a camelCase doctrine entry as well as the snake_case fixture', () => {
      expect(
        joined('doctrine_extract', { doctrines: [{ doctrineText: 'camel doctrine' }] }),
      ).toContain('camel doctrine');
      expect(
        joined('doctrine_extract', { doctrines: [{ text: 'plain doctrine' }] }),
      ).toContain('plain doctrine');
    });

    it('reads snake_case nesting keys', () => {
      const text = joined('subject_outline', {
        topic: 'Topic',
        sections: [
          { heading: 'Parent', sub_sections: [{ heading: 'Snake child' }] },
        ],
      });
      expect(text).toContain('Snake child');
    });
  });

  // --- trap 2: the three recursive shapes --------------------------------

  describe('recursion', () => {
    it('subject_outline: walks subSections in the fixture', () => {
      const text = joined('subject_outline', OUTLINE_CONTENT);
      expect(text).toContain('Warrantless Exceptions');
      expect(text).toContain('Plain view, consent, etc.');
    });

    it('sample_contract: walks subclauses in the fixture', () => {
      const text = joined('sample_contract', SAMPLE_CONTRACT_CONTENT);
      expect(text).toContain('Renewal');
      expect(text).toContain('Renewable by mutual written agreement.');
    });

    it('essay_prompt: walks modelAnswer.outlineSections in the fixture', () => {
      const text = joined('essay_prompt', ESSAY_CONTENT);
      expect(text).toContain(ESSAY_CONTENT.promptText);
      expect(text).toContain('The exclusionary rule bars illegally obtained evidence.');
      expect(text).toContain('Issue Identification');
    });

    it('essay_model_answer: walks answer.outlineSections in the fixture', () => {
      const text = joined('essay_model_answer', ESSAY_MODEL_ANSWER_CONTENT);
      expect(text).toContain('Therefore, the evidence must be excluded.');
      expect(text).toContain('Lead with the answer.');
      expect(text).toContain('Conflating plain view with stop-and-frisk.');
    });

    it.each([
      ['subSections', 'subject_outline', 'sections'],
      ['subclauses', 'sample_contract', 'clauses'],
      ['outlineSections', 'essay_prompt', 'outlineSections'],
    ])('recurses %s to arbitrary depth', (nestKey, type, rootKey) => {
      const DEPTH = 12;
      // Build heading-per-level nesting from the innermost outwards.
      let node: Record<string, unknown> = { heading: `level-${DEPTH}` };
      for (let level = DEPTH - 1; level >= 1; level -= 1) {
        node = { heading: `level-${level}`, [nestKey]: [node] };
      }

      const content =
        type === 'essay_prompt'
          ? { modelAnswer: { [rootKey]: [node] } }
          : { [rootKey]: [node] };

      const text = joined(type, content);
      for (let level = 1; level <= DEPTH; level += 1) {
        expect(text).toContain(`level-${level}`);
      }
    });

    it('terminates on pathological nesting instead of overflowing the stack', () => {
      let node: Record<string, unknown> = { heading: 'deepest' };
      for (let level = 0; level < 5_000; level += 1) {
        node = { heading: `n-${level}`, subSections: [node] };
      }
      expect(() =>
        extractSearchableText('subject_outline', { sections: [node] }),
      ).not.toThrow();
    });
  });

  // --- trap 3: the MCQ answer-key rule (security-critical) ---------------

  describe('mcq_question answer-key exclusion', () => {
    it('extracts the stem and every option text', () => {
      const blocks = extractSearchableText('mcq_question', MCQ_CONTENT);
      expect(blocks).toEqual([
        MCQ_CONTENT.questionStem,
        ...MCQ_CONTENT.options.map((option) => option.text),
      ]);
    });

    it('never emits a rationale, an explanation, or the correctness flag', () => {
      const text = joined('mcq_question', MCQ_CONTENT);

      for (const option of MCQ_CONTENT.options) {
        expect(text).not.toContain(option.rationale);
      }
      expect(text).not.toContain(MCQ_CONTENT.explanation);
      // The correct option's TEXT is indexed (it is a plain distractor to a
      // reader); what must never leak is which one it is.
      expect(text).not.toContain('isCorrect');
      expect(text).not.toContain('true');
      expect(text).not.toContain('rationale');
    });

    it('excludes the forbidden keys under either casing', () => {
      const text = joined('mcq_question', {
        questionStem: 'Stem?',
        options: [
          {
            label: 'A',
            text: 'Option text',
            isCorrect: true,
            is_correct: true,
            rationale: 'LEAKED-RATIONALE',
            explanation: 'LEAKED-EXPLANATION',
          },
        ],
        rationale: 'LEAKED-TOP-RATIONALE',
        explanation: 'LEAKED-TOP-EXPLANATION',
      });

      expect(text).toContain('Stem?');
      expect(text).toContain('Option text');
      for (const leak of [
        'LEAKED-RATIONALE',
        'LEAKED-EXPLANATION',
        'LEAKED-TOP-RATIONALE',
        'LEAKED-TOP-EXPLANATION',
      ]) {
        expect(text).not.toContain(leak);
      }
    });

    it('names the forbidden keys so the rule is asserted, not just documented', () => {
      expect(MCQ_FORBIDDEN_KEYS).toEqual(
        expect.arrayContaining(['isCorrect', 'rationale', 'explanation']),
      );
    });

    it('does not leak an answer key through an unknown sibling shape', () => {
      // A future MCQ variant that renames the field must still not leak: there
      // is no generic fallback walker, so unrecognised keys are simply unread.
      const text = joined('mcq_question', {
        questionStem: 'Stem?',
        options: [{ text: 'Opt', correctAnswer: 'LEAKED-NEW-FIELD' }],
      });
      expect(text).not.toContain('LEAKED-NEW-FIELD');
    });
  });

  // --- markdown / HTML normalisation -------------------------------------

  describe('plain-text normalisation', () => {
    it('strips markdown emphasis, headings, bullets and links', () => {
      const blocks = extractSearchableText('case_digest', {
        summary: '## Heading\n\n**Bold** and _italic_ and `code`',
        facts: '- first bullet\n- second bullet',
        ruling: 'See [Art. III, Sec. 2](https://example.com/const) for the rule.',
      });
      expect(blocks[0]).toBe('Heading Bold and italic and code');
      expect(blocks[1]).toBe('first bullet second bullet');
      expect(blocks[2]).toBe('See Art. III, Sec. 2 for the rule.');
    });

    it('strips HTML tags and decodes entities', () => {
      const blocks = extractSearchableText('case_digest', {
        summary: '<p>Rule <strong>66</strong> &amp; Rule 65</p>',
      });
      expect(blocks[0]).toBe('Rule 66 & Rule 65');
    });

    it('collapses whitespace', () => {
      const blocks = extractSearchableText('case_digest', {
        summary: '  spaced   out\n\n\ttext  ',
      });
      expect(blocks[0]).toBe('spaced out text');
    });

    it('leaves underscores inside tokens alone', () => {
      const blocks = extractSearchableText('case_digest', {
        summary: 'The doctrine_type field and snake_case keys.',
      });
      expect(blocks[0]).toBe('The doctrine_type field and snake_case keys.');
    });

    it('drops blocks that are empty once stripped', () => {
      const blocks = extractSearchableText('case_digest', {
        summary: '   ',
        facts: '<br/>',
        ruling: 'Real content.',
      });
      expect(blocks).toEqual(['Real content.']);
    });
  });

  // --- totality: malformed and empty input -------------------------------

  describe('malformed and empty input', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'not an object'],
      ['a number', 42],
      ['a boolean', true],
      ['an array', [{ summary: 'ignored' }]],
      ['an empty object', {}],
    ])('returns [] for %s content', (_label, content) => {
      expect(extractSearchableText('case_digest', content)).toEqual([]);
    });

    it.each([
      ['an unknown type', 'not_a_real_type'],
      ['an empty type', ''],
    ])('returns [] for %s', (_label, type) => {
      expect(extractSearchableText(type, DIGEST_CONTENT)).toEqual([]);
    });

    it('ignores wrong-typed fields rather than throwing', () => {
      expect(() =>
        extractSearchableText('mcq_question', {
          questionStem: 42,
          options: 'not-an-array',
        }),
      ).not.toThrow();

      expect(
        extractSearchableText('subject_outline', {
          topic: 'Kept',
          sections: [null, 'string-section', 7, { heading: 'Also kept' }],
        }),
      ).toEqual(['Kept', 'Also kept']);
    });

    it('survives every type being handed every other type\'s content', () => {
      // Cheap guard against a mis-mapped `derivativeType` column in prod.
      for (const type of EXTRACTABLE_TYPES) {
        for (const content of [
          DIGEST_CONTENT,
          MCQ_CONTENT,
          SAMPLE_CONTRACT_CONTENT,
          OUTLINE_CONTENT,
        ]) {
          expect(() => extractSearchableText(type, content)).not.toThrow();
        }
      }
    });
  });

  it('is pure — repeated calls yield equal output and do not mutate input', () => {
    const snapshot = JSON.stringify(OUTLINE_CONTENT);
    const first = extractSearchableText('subject_outline', OUTLINE_CONTENT);
    const second = extractSearchableText('subject_outline', OUTLINE_CONTENT);
    expect(first).toEqual(second);
    expect(JSON.stringify(OUTLINE_CONTENT)).toBe(snapshot);
  });
});

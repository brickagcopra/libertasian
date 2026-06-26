import { LATIN_LEXICON, toSsml, toSsmlDocument } from './legal-ssml.util';

describe('toSsml — legal SSML normalizer', () => {
  it('wraps output in a single <speak> root', () => {
    const { ssml } = toSsml('A short ruling.');
    expect(ssml.startsWith('<speak>')).toBe(true);
    expect(ssml.endsWith('</speak>')).toBe(true);
  });

  it('frames a sentence in <p>/<s> with a leading mark (back-compat single-blob)', () => {
    const { ssml } = toSsml('A short ruling.');
    expect(ssml).toBe(
      '<speak><p><mark name="seg-0"/><s>A short ruling.</s></p></speak>',
    );
  });

  describe('G.R. citation expansion', () => {
    it('spells digits individually in SSML and plain text', () => {
      const { ssml, normalizedText } = toSsml('See G.R. No. 168338 for details.');
      expect(ssml).toContain(
        'G R Number <say-as interpret-as="digits">168338</say-as>',
      );
      expect(normalizedText).toContain('G R Number 168338');
    });

    it('handles spacing variants (GR, GRN) and strips comma grouping', () => {
      expect(toSsml('GR No. 12,345').normalizedText).toContain('G R Number 12345');
      expect(toSsml('G.R.No.999').normalizedText).toContain('G R Number 999');
    });
  });

  it('expands "v." to "versus"', () => {
    const { ssml, normalizedText } = toSsml('People v. Dela Cruz');
    expect(normalizedText).toBe('People versus Dela Cruz');
    expect(ssml).toContain('People versus Dela Cruz');
  });

  it('expands Sec./Art. (and plurals) to Section/Article', () => {
    const { normalizedText } = toSsml('Under Art. 415 and Sec. 3, see Arts. 1 and Secs. 2.');
    expect(normalizedText).toBe(
      'Under Article 415 and Section 3, see Articles 1 and Sections 2.',
    );
  });

  it('expands J./C.J./Hon. to full titles (C.J. before J.)', () => {
    expect(toSsml('per Reyes, J.').normalizedText).toBe('per Reyes, Justice');
    expect(toSsml('per Bernabe, C.J.').normalizedText).toBe('per Bernabe, Chief Justice');
    expect(toSsml('the Hon. Court').normalizedText).toBe('the Honorable Court');
  });

  it('does not mangle an initial chain like J.B.L.', () => {
    const { normalizedText } = toSsml('Penned by J.B.L. Reyes, J.');
    expect(normalizedText).toContain('J.B.L.');
    expect(normalizedText).toContain('Reyes, Justice');
    expect(normalizedText).not.toContain('JusticeB');
  });

  describe('statute citations', () => {
    it('expands R.A./P.D./B.P./E.O. and digit-izes their numbers', () => {
      expect(toSsml('Violation of R.A. 8294 applies.').normalizedText).toContain(
        'Republic Act Number 8294',
      );
      expect(toSsml('Under P.D. No. 1606 the court acts.').normalizedText).toContain(
        'Presidential Decree Number 1606',
      );
      expect(toSsml('Per B.P. 22 the check bounced.').normalizedText).toContain(
        'Batas Pambansa Number 22',
      );
      expect(toSsml('See E.O. 209 today.').normalizedText).toContain(
        'Executive Order Number 209',
      );
    });

    it('digit-spells statute numbers in SSML', () => {
      const { ssml } = toSsml('Violation of R.A. 8294 applies.');
      expect(ssml).toContain(
        'Republic Act Number <say-as interpret-as="digits">8294</say-as>',
      );
    });
  });

  describe('number, symbol and currency normalization', () => {
    it('expands a standalone No. to "Number" with spelled digits', () => {
      const { ssml, normalizedText } = toSsml('Filed under No. 12345 today.');
      expect(normalizedText).toContain('Number 12345');
      expect(ssml).toContain(
        'Number <say-as interpret-as="digits">12345</say-as>',
      );
    });

    it('expands § to Section and % to percent', () => {
      expect(toSsml('See § 5 of the Code.').normalizedText).toContain('Section 5');
      expect(toSsml('Raised by 50%.').normalizedText).toContain('50 percent');
    });

    it('re-voices peso amounts, including a scale word', () => {
      expect(toSsml('He paid P2.8 million in damages.').normalizedText).toContain(
        '2.8 million pesos',
      );
      expect(toSsml('A fine of ₱500 was set.').normalizedText).toContain('500 pesos');
      expect(toSsml('Damages of PHP 1,000 awarded.').normalizedText).toContain(
        '1,000 pesos',
      );
    });

    it('does not treat a middle initial as a peso amount', () => {
      const { normalizedText } = toSsml('Juan P. Cruz reasoned otherwise.');
      expect(normalizedText).toContain('Juan P. Cruz');
      expect(normalizedText).not.toContain('pesos');
    });
  });

  describe('all-caps de-shouting', () => {
    it('title-cases all-caps words longer than three characters', () => {
      const { normalizedText } = toSsml(
        'WHEREFORE, the petition is GRANTED by METROBANK.',
      );
      expect(normalizedText).toContain('Wherefore');
      expect(normalizedText).toContain('Granted');
      expect(normalizedText).toContain('Metrobank');
      expect(normalizedText).not.toContain('WHEREFORE');
      expect(normalizedText).not.toContain('METROBANK');
    });

    it('leaves short (<=3 char) all-caps tokens untouched', () => {
      const { normalizedText } = toSsml('The DOJ and the SEC ruled.');
      expect(normalizedText).toContain('DOJ');
      expect(normalizedText).toContain('SEC');
    });
  });

  describe('dict-blob hygiene', () => {
    it('rewrites a single {issue, holding} object to prose (single quotes)', () => {
      const { ssml, normalizedText } = toSsml(
        "{'issue': 'Whether the search was valid', 'holding': 'The search was illegal'}",
      );
      expect(normalizedText).toContain(
        'Issue: Whether the search was valid. The Court held: The search was illegal.',
      );
      expect(normalizedText).not.toContain('{');
      expect(normalizedText).not.toContain('}');
      expect(normalizedText).not.toContain("'");
      // No brace/quote artifacts reach the SSML either.
      expect(ssml).not.toContain('{');
      expect(ssml).not.toContain("'");
    });

    it('rewrites the double-quoted object form', () => {
      const { normalizedText } = toSsml(
        '{"issue": "Was notice given", "holding": "Notice was defective"}',
      );
      expect(normalizedText).toContain('Issue: Was notice given.');
      expect(normalizedText).toContain('The Court held: Notice was defective.');
      expect(normalizedText).not.toContain('"');
    });

    it('rewrites a bulleted list of objects', () => {
      const blob =
        "- {'issue': 'Was probable cause shown', 'holding': 'No probable cause existed'}\n" +
        "- {'issue': 'Is the evidence admissible', 'holding': 'The evidence is suppressed'}";
      const { normalizedText } = toSsml(blob);
      expect(normalizedText).toContain('Issue: Was probable cause shown.');
      expect(normalizedText).toContain('The Court held: No probable cause existed.');
      expect(normalizedText).toContain('Issue: Is the evidence admissible.');
      expect(normalizedText).not.toContain('{');
      expect(normalizedText).not.toContain('}');
    });
  });

  describe('Latin lexicon', () => {
    it('exports the five original terms', () => {
      const terms = LATIN_LEXICON.map((entry) => entry.term);
      expect(terms).toEqual(
        expect.arrayContaining([
          'stare decisis',
          'res ipsa loquitur',
          'certiorari',
          'ponente',
          'en banc',
        ]),
      );
    });

    it('includes the extended Philippine legal terms', () => {
      const terms = LATIN_LEXICON.map((entry) => entry.term);
      expect(terms).toEqual(
        expect.arrayContaining([
          'prima facie',
          'habeas corpus',
          'mandamus',
          'amicus curiae',
          'obiter dictum',
          'ratio decidendi',
          'ex parte',
        ]),
      );
    });

    it('wraps IPA terms in <phoneme>', () => {
      const { ssml } = toSsml('The doctrine of stare decisis controls.');
      expect(ssml).toContain('<phoneme alphabet="ipa"');
      expect(ssml).toContain('>stare decisis</phoneme>');
    });

    it('wraps alias-only terms in <sub>', () => {
      const { ssml } = toSsml('The ponente wrote en banc.');
      expect(ssml).toContain('<sub alias="poh-NEN-teh">ponente</sub>');
      expect(ssml).toContain('<sub alias="on bonk">en banc</sub>');
    });

    it('wraps an extended term (habeas corpus)', () => {
      const { ssml } = toSsml('The writ of habeas corpus issued.');
      expect(ssml).toContain('<sub alias="HAY-bee-us KOR-pus">habeas corpus</sub>');
    });

    it('matches case-insensitively while preserving original casing', () => {
      const { ssml } = toSsml('Certiorari was granted.');
      expect(ssml).toContain('>Certiorari</phoneme>');
    });

    it('leaves Latin terms unexpanded in normalizedText', () => {
      expect(toSsml('stare decisis').normalizedText).toBe('stare decisis');
    });
  });

  describe('footnote markers', () => {
    it('strips bracketed footnote numbers', () => {
      expect(toSsml('The ruling[12] is final[3].').normalizedText).toBe(
        'The ruling is final.',
      );
    });

    it('strips superscript footnote digits', () => {
      expect(toSsml('Settled law¹⁰ applies.').normalizedText).toBe(
        'Settled law applies.',
      );
    });
  });

  describe('sentence segmentation', () => {
    it('splits paragraphs into <s> sentences, each preceded by its mark', () => {
      const { ssml } = toSsml('The accused fled. The Court convicted him.');
      expect(ssml).toBe(
        '<speak><p><mark name="seg-0"/><s>The accused fled.</s>' +
          '<mark name="seg-1"/><s>The Court convicted him.</s></p></speak>',
      );
    });

    it('does not split after a guard abbreviation (Inc.)', () => {
      const { ssml } = toSsml('Owned by Acme Inc. The board met.');
      expect(ssml).toContain('<s>Owned by Acme Inc. The board met.</s>');
    });

    it('does not split after Corp.', () => {
      const { ssml } = toSsml('Held by Big Corp. The motion was denied.');
      expect(ssml).toContain('<s>Held by Big Corp. The motion was denied.</s>');
    });
  });

  describe('paragraph structure', () => {
    it('renders each paragraph as its own <p> block', () => {
      const { ssml } = toSsml('First paragraph.\n\nSecond paragraph.');
      expect(ssml).toBe(
        '<speak><p><mark name="seg-0"/><s>First paragraph.</s></p>' +
          '<p><mark name="seg-1"/><s>Second paragraph.</s></p></speak>',
      );
    });

    it('preserves paragraph separation in normalizedText', () => {
      expect(toSsml('One.\n\nTwo.').normalizedText).toBe('One.\n\nTwo.');
    });
  });

  describe('structured document builder', () => {
    it('gives the title a distinct drc + x-loud (slower) delivery', () => {
      const { ssml, normalizedText } = toSsmlDocument({
        title: 'People v. Dela Cruz',
        sections: [{ heading: 'Facts', body: 'The accused fled.' }],
      });
      expect(ssml).toContain(
        '<mark name="seg-0"/><p><amazon:effect name="drc"><prosody volume="x-loud" rate="96%">People versus Dela Cruz</prosody></amazon:effect></p><break time="900ms"/>',
      );
      expect(normalizedText).toContain('People versus Dela Cruz');
    });

    it('paces section headings with drc + x-loud and long breaks', () => {
      const { ssml, normalizedText } = toSsmlDocument({
        sections: [{ heading: 'Facts', body: 'The accused fled.' }],
      });
      expect(ssml).toContain(
        '<break time="700ms"/><mark name="seg-0"/><amazon:effect name="drc"><prosody volume="x-loud" rate="90%"><p>Facts.</p></prosody></amazon:effect><break time="400ms"/>',
      );
      expect(ssml).toContain('<mark name="seg-1"/><s>The accused fled.</s>');
      expect(normalizedText).toContain('Facts.');
    });

    it('never emits <emphasis> or <prosody pitch> (rejected on neural)', () => {
      const { ssml } = toSsmlDocument({
        title: 'A Title',
        sections: [{ heading: 'Ruling', body: 'Affirmed in full.' }],
      });
      expect(ssml).not.toContain('<emphasis');
      expect(ssml).not.toContain('pitch=');
    });

    it('skips an empty section and a blank title', () => {
      const { ssml } = toSsmlDocument({
        title: '   ',
        sections: [
          { heading: 'Facts', body: '' },
          { heading: 'Ruling', body: 'Affirmed.' },
        ],
      });
      expect(ssml).not.toContain('rate="96%"'); // no title
      expect(ssml).not.toContain('Facts.'); // empty body → heading skipped
      expect(ssml).toContain('<prosody volume="x-loud" rate="90%"><p>Ruling.</p>');
      expect(ssml).toContain('<s>Affirmed.</s>');
    });
  });

  describe('segment manifest + marks', () => {
    it('emits one <mark> per manifest entry, ids contiguous from seg-0', () => {
      const { ssml, manifest } = toSsmlDocument({
        title: 'People v. Dela Cruz',
        sections: [
          { key: 'facts', heading: 'Facts', body: 'He fled. He hid.' },
          { key: 'ruling', heading: 'Ruling', body: 'Affirmed.' },
        ],
      });

      // ids are contiguous seg-0..seg-(n-1) in manifest order.
      expect(manifest.map((m) => m.id)).toEqual([
        'seg-0',
        'seg-1',
        'seg-2',
        'seg-3',
        'seg-4',
        'seg-5',
      ]);

      // exactly one <mark> per manifest entry, same ids, same order.
      const markIds = [...ssml.matchAll(/<mark name="(seg-\d+)"\/>/g)].map(
        (m) => m[1],
      );
      expect(markIds).toEqual(manifest.map((m) => m.id));
    });

    it('labels kinds (title/heading/sentence) and carries the section key', () => {
      const { manifest } = toSsmlDocument({
        title: 'People v. Dela Cruz',
        sections: [{ key: 'facts', heading: 'Facts', body: 'He fled. He hid.' }],
      });
      expect(manifest).toEqual([
        { id: 'seg-0', kind: 'title', sectionKey: 'title', text: 'People v. Dela Cruz' },
        { id: 'seg-1', kind: 'heading', sectionKey: 'facts', text: 'Facts' },
        { id: 'seg-2', kind: 'sentence', sectionKey: 'facts', text: 'He fled.' },
        { id: 'seg-3', kind: 'sentence', sectionKey: 'facts', text: 'He hid.' },
      ]);
    });

    it('keeps manifest text ORIGINAL/un-normalized while SSML is spoken-form', () => {
      const { ssml, manifest } = toSsmlDocument({
        sections: [{ key: 'facts', heading: 'Facts', body: 'See G.R. No. 168338.' }],
      });
      const sentence = manifest.find((m) => m.kind === 'sentence');
      // Manifest preserves the citation exactly as displayed…
      expect(sentence?.text).toBe('See G.R. No. 168338.');
      // …while the spoken SSML expands + digit-spells it.
      expect(ssml).toContain(
        'G R Number <say-as interpret-as="digits">168338</say-as>',
      );
      expect(sentence?.text).not.toContain('G R Number');
    });

    it('falls back to a heading slug for sectionKey when none is supplied', () => {
      const { manifest } = toSsmlDocument({
        sections: [{ heading: 'Dispositive Portion', body: 'Granted.' }],
      });
      expect(manifest.every((m) => m.sectionKey === 'dispositive-portion')).toBe(
        true,
      );
    });

    it('is empty for an empty document', () => {
      expect(toSsml('').manifest).toEqual([]);
    });
  });

  describe('XML safety', () => {
    it('escapes &, < and > in the SSML body', () => {
      const { ssml } = toSsml('Smith & Co. sued <b>them</b>.');
      expect(ssml).toContain('Smith &amp; Co.');
      expect(ssml).toContain('&lt;b&gt;them&lt;/b&gt;');
    });

    it('does not escape the SSML tags it generates', () => {
      const { ssml } = toSsml('stare decisis');
      expect(ssml).not.toContain('&lt;phoneme');
    });
  });

  it('is pure — does not mutate its input and is deterministic', () => {
    const input = 'G.R. No. 1 — stare decisis per X, J.';
    const first = toSsml(input);
    const second = toSsml(input);
    expect(first).toEqual(second);
    expect(input).toBe('G.R. No. 1 — stare decisis per X, J.');
  });

  it('returns an empty <speak> for empty input', () => {
    expect(toSsml('').ssml).toBe('<speak></speak>');
    expect(toSsml('').normalizedText).toBe('');
  });
});

import { LATIN_LEXICON, toSsml } from './legal-ssml.util';

describe('toSsml — legal SSML normalizer', () => {
  it('wraps output in a single <speak> root', () => {
    const { ssml } = toSsml('A short ruling.');
    expect(ssml.startsWith('<speak>')).toBe(true);
    expect(ssml.endsWith('</speak>')).toBe(true);
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

  describe('Latin lexicon', () => {
    it('exports the five expected terms', () => {
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

  describe('paragraph breaks', () => {
    it('inserts <break> between paragraphs in SSML', () => {
      const { ssml } = toSsml('First paragraph.\n\nSecond paragraph.');
      expect(ssml).toContain('<break time="700ms"/>');
      expect(ssml).toBe(
        '<speak>First paragraph.<break time="700ms"/>Second paragraph.</speak>',
      );
    });

    it('preserves paragraph separation in normalizedText', () => {
      expect(toSsml('One.\n\nTwo.').normalizedText).toBe('One.\n\nTwo.');
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

import { describe, it, expect } from 'vitest';

import { sanitizeRulingText } from './sanitize-ruling';

describe('sanitizeRulingText', () => {
  it('returns empty string for null/undefined/empty input', () => {
    expect(sanitizeRulingText(null)).toBe('');
    expect(sanitizeRulingText(undefined)).toBe('');
    expect(sanitizeRulingText('')).toBe('');
  });

  it('normalizes smart double quotes to straight double quotes', () => {
    expect(sanitizeRulingText('\u201CHello\u201D')).toBe('"Hello"');
  });

  it('normalizes smart single quotes / apostrophes to straight single quotes', () => {
    expect(sanitizeRulingText('it\u2019s \u2018there\u2019')).toBe("it's 'there'");
  });

  it('normalizes em and en dashes to " — " with single spaces', () => {
    expect(sanitizeRulingText('A\u2014B')).toBe('A \u2014 B');
    expect(sanitizeRulingText('A \u2013 B')).toBe('A \u2014 B');
    expect(sanitizeRulingText('A  \u2014  B')).toBe('A \u2014 B');
  });

  it('strips triple and stray backticks', () => {
    expect(sanitizeRulingText('```ts\nfoo\n```')).toBe('ts\nfoo');
    expect(sanitizeRulingText('use `foo` now')).toBe('use foo now');
  });

  it('strips bold markdown markers', () => {
    expect(sanitizeRulingText('**Held:** guilty')).toBe('Held: guilty');
  });

  it('strips leading markdown headings', () => {
    expect(sanitizeRulingText('# Ruling\n## Facts\ntext')).toBe('Ruling\nFacts\ntext');
  });

  it('replaces bullet glyphs with "- "', () => {
    expect(sanitizeRulingText('\u2022 one\n\u25CF two\n\u25AA three')).toBe('- one\n- two\n- three');
  });

  it('collapses 3+ consecutive newlines to exactly 2', () => {
    expect(sanitizeRulingText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('unescapes literal "\\n" / "\\r\\n" sequences to real newlines', () => {
    expect(sanitizeRulingText('line1\\nline2')).toBe('line1\nline2');
    expect(sanitizeRulingText('line1\\r\\nline2')).toBe('line1\nline2');
  });

  it('round-trips a realistic LLM ruling sample cleanly', () => {
    const dirty =
      '# Ruling\n\n' +
      '**The Court held** that the petition is \u201Cwithout merit.\u201D ' +
      'The respondent\u2019s argument \u2014 while novel \u2014 fails.\n\n\n' +
      '\u2022 First, due process was observed.\n' +
      '\u25CF Second, the evidence is overwhelming.\n\n' +
      '```\nAccordingly, the petition is DENIED.\n```';

    const clean = sanitizeRulingText(dirty);

    expect(clean).not.toContain('\u201C');
    expect(clean).not.toContain('\u201D');
    expect(clean).not.toContain('\u2019');
    expect(clean).not.toContain('\u2022');
    expect(clean).not.toContain('\u25CF');
    expect(clean).not.toContain('```');
    expect(clean).not.toContain('**');
    expect(clean).not.toMatch(/^#/m);
    expect(clean).not.toMatch(/\n{3,}/);
    expect(clean).toContain('"without merit."');
    expect(clean).toContain("respondent's argument \u2014 while novel \u2014 fails.");
    expect(clean).toContain('- First, due process was observed.');
    expect(clean).toContain('- Second, the evidence is overwhelming.');
  });

  it('is idempotent — sanitizing twice yields the same result', () => {
    const dirty =
      '\u201CHello\u201D \u2014 world \u2022 item\n\n\n**bold** `code`';
    const once = sanitizeRulingText(dirty);
    const twice = sanitizeRulingText(once);
    expect(twice).toBe(once);
  });
});

import { sanitizeRulingText } from './sanitize-ruling.util';

/**
 * Parity guard: this server copy must clean a ruling string identically to the
 * web `sanitizeRulingText` so the read-along text matches the plain render.
 * Cases mirror apps/web/src/features/digests/lib/sanitize-ruling.ts behavior.
 */
describe('sanitizeRulingText (server mirror)', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(sanitizeRulingText(null)).toBe('');
    expect(sanitizeRulingText(undefined)).toBe('');
    expect(sanitizeRulingText('')).toBe('');
  });

  it('unescapes literal \\n / \\r sequences to real newlines', () => {
    expect(sanitizeRulingText('a\\nb')).toBe('a\nb');
    expect(sanitizeRulingText('a\\r\\nb')).toBe('a\nb');
  });

  it('normalizes smart quotes to straight quotes', () => {
    expect(sanitizeRulingText('“quoted” and ‘single’')).toBe(
      '"quoted" and \'single\'',
    );
  });

  it('normalizes em/en dashes to spaced em-dash', () => {
    expect(sanitizeRulingText('a—b')).toBe('a — b');
    expect(sanitizeRulingText('a – b')).toBe('a — b');
  });

  it('strips markdown fences, inline backticks, bold, and ATX headers', () => {
    expect(sanitizeRulingText('```\ncode\n```')).toBe('code');
    expect(sanitizeRulingText('use `x` here')).toBe('use x here');
    expect(sanitizeRulingText('**bold** text')).toBe('bold text');
    expect(sanitizeRulingText('## Heading\nbody')).toBe('Heading\nbody');
  });

  it('converts bullet glyphs to "- " and collapses 3+ newlines to 2', () => {
    expect(sanitizeRulingText('• item')).toBe('- item');
    expect(sanitizeRulingText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims trailing per-line whitespace and outer whitespace', () => {
    expect(sanitizeRulingText('  a   \n  b  ')).toBe('a\n  b');
  });

  it('leaves already-clean prose unchanged (the common case)', () => {
    expect(sanitizeRulingText('The Court affirmed the conviction.')).toBe(
      'The Court affirmed the conviction.',
    );
  });
});

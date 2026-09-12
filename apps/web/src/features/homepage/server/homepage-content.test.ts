import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getHomepageContent, DEFAULT_HOMEPAGE_CONTENT } from './homepage-content';

describe('getHomepageContent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns DEFAULT_HOMEPAGE_CONTENT when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const content = await getHomepageContent();

    expect(content).toBe(DEFAULT_HOMEPAGE_CONTENT);
    expect(content.footer.contactEmail).toBe('support@libertasian.com');
  });

  it('returns DEFAULT_HOMEPAGE_CONTENT when response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const content = await getHomepageContent();

    expect(content).toBe(DEFAULT_HOMEPAGE_CONTENT);
  });

  it('returns DEFAULT_HOMEPAGE_CONTENT when payload is missing data.content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    }) as unknown as typeof fetch;

    const content = await getHomepageContent();

    expect(content).toBe(DEFAULT_HOMEPAGE_CONTENT);
  });

  it('deep-merges overrides on top of defaults', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          content: {
            hero: { tagline: 'Override tagline' },
            footer: { contactEmail: 'override@example.com' },
          },
        },
      }),
    }) as unknown as typeof fetch;

    const content = await getHomepageContent();

    expect(content.hero.tagline).toBe('Override tagline');
    // Untouched hero fields preserved from defaults
    expect(content.hero.headline).toBe(DEFAULT_HOMEPAGE_CONTENT.hero.headline);
    expect(content.footer.contactEmail).toBe('override@example.com');
    // Untouched footer fields preserved
    expect(content.footer.brandDescription).toBe(DEFAULT_HOMEPAGE_CONTENT.footer.brandDescription);
  });
});

describe('DEFAULT_HOMEPAGE_CONTENT corpus claims', () => {
  // These strings are marketing claims about what the corpus actually holds,
  // and both of them were wrong until 2026-09-12. Measured on prod that day:
  // 97 bar sittings and 1,536 questions across 13 distinct years (2006-2018
  // except 2011, plus 2022), and exactly ONE Republic Act -- the Revised
  // Corporation Code. The old copy claimed "1953-2024" (72 years we have never
  // held) and "Republic Acts" plural.
  //
  // They are pinned here because the same two claims had drifted across six
  // files; a claim nothing asserts is a claim that silently comes back. The
  // wording is kept identical to apps/mobile/store.config.json so the web page
  // and the App Store listing cannot disagree.

  it('states the bar-exam year range the corpus actually covers', () => {
    const stat = DEFAULT_HOMEPAGE_CONTENT.stats.items.find((s) => s.value === '97');
    expect(stat?.label).toBe('Bar sittings, 2006–2022');

    const pastBar = DEFAULT_HOMEPAGE_CONTENT.featuresAccordion.items.find(
      (i) => i.label === 'PAST BAR EXAMS',
    );
    expect(pastBar?.detail).toContain('2006–2022');
  });

  it('never claims a bar-exam range wider than the corpus', () => {
    const copy = JSON.stringify(DEFAULT_HOMEPAGE_CONTENT);
    expect(copy).not.toContain('1953');
    expect(copy).not.toContain('2024');
  });

  it('names the codes the corpus holds instead of "Republic Acts"', () => {
    const codal = DEFAULT_HOMEPAGE_CONTENT.featuresAccordion.items.find(
      (i) => i.label === 'CODAL READER',
    );
    expect(codal?.detail).toBe(
      'The Civil Code, Revised Penal Code, Labor Code, Family Code, Tax Code, ' +
        'the 1987 Constitution, and the Rules of Court — organized by bar subject ' +
        'with cross-references.',
    );
    // Exactly one Republic Act is in the corpus, so the plural must not return.
    expect(JSON.stringify(DEFAULT_HOMEPAGE_CONTENT)).not.toContain('Republic Acts');
  });
});

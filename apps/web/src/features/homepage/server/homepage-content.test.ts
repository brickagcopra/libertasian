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

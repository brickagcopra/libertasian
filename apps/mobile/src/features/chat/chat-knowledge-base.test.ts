import { FAQ_ENTRIES, matchFaq } from './chat-knowledge-base';
import { FALLBACK_ANSWER, resolveAnswer } from './components/ChatScreen';

describe('chat-knowledge-base', () => {
  it('ships the 11 FAQ entries', () => {
    expect(FAQ_ENTRIES).toHaveLength(11);
  });

  it('answers a pricing-shaped question with the usage entry', () => {
    const usage = FAQ_ENTRIES.find((entry) => entry.id === 'usage');
    expect(usage).toBeDefined();
    expect(matchFaq('pricing')?.id).toBe('usage');
    expect(matchFaq('how much does it cost?')?.answer).toBe(usage?.answer);
    expect(matchFaq('what plan am i on')?.id).toBe('usage');
    expect(matchFaq('how much of my quota is remaining')?.id).toBe('usage');
  });

  it('has no plans-and-pricing entry left', () => {
    expect(FAQ_ENTRIES.find((entry) => entry.id === 'pricing')).toBeUndefined();
  });

  it('matches a privacy question', () => {
    expect(matchFaq('is my data private')?.id).toBe('privacy');
  });

  it('returns null for gibberish and empty input', () => {
    expect(matchFaq('asdfghjkl qwertyuiop')).toBeNull();
    expect(matchFaq('')).toBeNull();
    expect(matchFaq('   !!! ???')).toBeNull();
  });
});

/**
 * REGRESSION GUARD — this is the point of the PR.
 *
 * App Review rejected build 20 under Guideline 2.1(b) for referencing
 * purchasable tiers, then build 23 under 3.1.1 for the paywall itself. PR #412
 * deleted the plan screens but missed this in-app help chat, which is reachable
 * at Settings → Help & FAQ. Nothing a user can READ in the FAQ (topic,
 * question, or answer) may name a tier, a plan, a price, an upgrade, or
 * anything else that implies something is for sale. Keywords are exempt on
 * purpose: they are never rendered, and keeping them is what lets a pricing
 * question still get an answer instead of the support-email fallback.
 */
describe('no purchasable-tier surface in user-visible FAQ copy', () => {
  const FORBIDDEN = [
    'Pro',
    'Edu',
    'Team',
    'Enterprise',
    'Premium',
    // Singular: the `s?` below covers 'plans' too. Listing only 'plans' left a
    // hole exactly where the regression is likeliest — "your plan" is the
    // phrasing of the answer this guard exists to keep deleted.
    'plan',
    'pricing',
    'upgrade',
    // Added with the 3.1.1 sweep: the full word list the whole mobile app is
    // now held to, not just the tier nouns.
    'subscription',
    'tier',
    'paid',
    'billing',
    'price',
    'unlock',
    '$',
    '₱',
  ];

  // Word-boundary for the tier nouns (so 'provenance' does not read as 'Pro'),
  // plain substring for the currency symbols.
  const matcher = (term: string) =>
    /^[a-z]+$/i.test(term)
      ? (text: string) => new RegExp('\\b' + term + 's?\\b', 'i').test(text)
      : (text: string) => text.includes(term);

  it.each(FORBIDDEN)('never renders %s', (term) => {
    const hits = matcher(term);
    for (const entry of FAQ_ENTRIES) {
      for (const field of ['topic', 'question', 'answer'] as const) {
        expect({ id: entry.id, field, hit: hits(entry[field]) }).toEqual({
          id: entry.id,
          field,
          hit: false,
        });
      }
    }
  });
});

describe('FAQ answers point only at screens that exist', () => {
  // Every `Settings → X` in an answer must be a row on the settings screen.
  // `Your plan` was one until PR #412 deleted it; that is the bug this catches.
  const SETTINGS_ROWS = [
    'Digests',
    'Study',
    'Feed',
    'Workspace',
    'Usage & quotas',
    'Admin dashboard',
    'API keys',
    'Security',
    'Notifications',
    'Blocked users',
    'Help & FAQ',
  ];

  it('references no deleted settings screen', () => {
    const dangling = FAQ_ENTRIES.flatMap((entry) =>
      entry.answer
        .split('Settings → ')
        .slice(1)
        .filter((tail) => !SETTINGS_ROWS.some((row) => tail.startsWith(row)))
        .map((tail) => `${entry.id}: Settings → ${tail}`),
    );
    expect(dangling).toEqual([]);
  });

  it('never sends a mobile user to a web URL path', () => {
    for (const entry of FAQ_ENTRIES) {
      expect(entry.answer).not.toMatch(/(^|\s)\/[a-z][a-z-]*/);
    }
  });
});

describe('resolveAnswer (Phase-1 rule-based seam)', () => {
  it('resolves a matched FAQ answer', async () => {
    const usage = FAQ_ENTRIES.find((entry) => entry.id === 'usage');
    await expect(resolveAnswer('pricing')).resolves.toBe(usage?.answer);
  });

  it('falls back to the support-email answer for gibberish', async () => {
    await expect(resolveAnswer('asdfghjkl qwertyuiop')).resolves.toBe(FALLBACK_ANSWER);
    expect(FALLBACK_ANSWER).toContain('info.libertasian@gmail.com');
  });
});

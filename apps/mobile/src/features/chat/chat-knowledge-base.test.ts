import { FAQ_ENTRIES, matchFaq } from './chat-knowledge-base';
import { FALLBACK_ANSWER, resolveAnswer } from './components/ChatScreen';

describe('chat-knowledge-base (parity with web)', () => {
  it('ships the 11 FAQ entries', () => {
    expect(FAQ_ENTRIES).toHaveLength(11);
  });

  it('matches a pricing question to the pricing answer', () => {
    const pricing = FAQ_ENTRIES.find((entry) => entry.id === 'pricing');
    expect(pricing).toBeDefined();
    expect(matchFaq('pricing')?.id).toBe('pricing');
    expect(matchFaq('how much does it cost?')?.answer).toBe(pricing?.answer);
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

describe('resolveAnswer (Phase-1 rule-based seam)', () => {
  it('resolves a matched FAQ answer', async () => {
    const pricing = FAQ_ENTRIES.find((entry) => entry.id === 'pricing');
    await expect(resolveAnswer('pricing')).resolves.toBe(pricing?.answer);
  });

  it('falls back to the support-email answer for gibberish', async () => {
    await expect(resolveAnswer('asdfghjkl qwertyuiop')).resolves.toBe(FALLBACK_ANSWER);
    expect(FALLBACK_ANSWER).toContain('info.libertasian@gmail.com');
  });
});

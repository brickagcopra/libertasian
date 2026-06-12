import { describe, expect, it } from 'vitest';

import { FAQ_ENTRIES, matchFaq } from './chat-knowledge-base';

describe('matchFaq', () => {
  it('matches pricing questions', () => {
    expect(matchFaq('how much does it cost?')?.id).toBe('pricing');
    expect(matchFaq('what are your plans')?.id).toBe('pricing');
  });

  it('matches privacy questions', () => {
    expect(matchFaq('is my data private and confidential')?.id).toBe('privacy');
  });

  it('matches search and digest topics', () => {
    expect(matchFaq('how do I search for a case')?.id).toBe('search');
    expect(matchFaq('tell me about case digests')?.id).toBe('digests');
  });

  it('matches each seed entry on its own question text', () => {
    for (const entry of FAQ_ENTRIES) {
      expect(matchFaq(entry.question)).not.toBeNull();
    }
  });

  it('returns null on gibberish', () => {
    expect(matchFaq('asdfghjkl qwerty')).toBeNull();
  });

  it('returns null on empty / stop-word-only input', () => {
    expect(matchFaq('')).toBeNull();
    expect(matchFaq('the a is to of')).toBeNull();
  });
});

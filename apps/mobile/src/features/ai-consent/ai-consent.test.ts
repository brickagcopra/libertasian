jest.unmock('./ai-consent');

const mockStore = new Map<string, unknown>();

jest.mock('../../storage/mmkv', () => ({
  STORAGE_KEYS: { AI_DATA_CONSENT: 'ai_data_consent' },
  mmkvStorage: {
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    setBoolean: (k: string, v: boolean) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
  },
}));

import {
  answerAiConsent,
  getAiConsentSnapshot,
  hasAiConsent,
  requestAiConsent,
  requiresAiConsent,
  setAiConsent,
} from './ai-consent';

describe('requiresAiConsent', () => {
  it.each([
    ['POST', '/ai-answers'],
    ['POST', '/ai-answers/stream'],
    ['POST', '/deep-research'],
    ['POST', '/deep-research/stream'],
    ['POST', '/digests/generate'],
    ['POST', '/memos/generate'],
    ['POST', '/pleadings/generate'],
    ['POST', '/hearing-prep/generate'],
    ['POST', '/timelines/generate'],
    ['POST', '/uploads/u1/generate-digest'],
    ['POST', '/uploads/u1/generate-flashcards?x=1'],
  ])('%s %s needs consent', (method, path) => {
    expect(requiresAiConsent(method, path)).toBe(true);
  });

  it.each([
    ['GET', '/deep-research'],
    ['GET', '/ai-answers/history'],
    ['POST', '/search'],
    ['POST', '/feed/posts'],
    ['POST', '/uploads/camera-scan'],
    ['DELETE', '/deep-research/abc'],
    [undefined, '/digests/generate'],
  ])('%s %s does not', (method, path) => {
    expect(requiresAiConsent(method, path)).toBe(false);
  });
});

describe('consent flow', () => {
  beforeEach(() => {
    mockStore.clear();
    setAiConsent(false);
  });

  it('resolves true at once when already granted', async () => {
    setAiConsent(true);
    await expect(requestAiConsent()).resolves.toBe(true);
    expect(getAiConsentSnapshot().prompting).toBe(false);
  });

  it('prompts once for concurrent callers and persists a grant', async () => {
    const a = requestAiConsent();
    const b = requestAiConsent();
    expect(a).toBe(b);
    expect(getAiConsentSnapshot().prompting).toBe(true);
    answerAiConsent(true);
    await expect(a).resolves.toBe(true);
    expect(getAiConsentSnapshot()).toEqual({ granted: true, prompting: false });
    expect(mockStore.get('ai_data_consent')).toBe(true);
  });

  it('does not remember "Not now" and asks again next time', async () => {
    const first = requestAiConsent();
    answerAiConsent(false);
    await expect(first).resolves.toBe(false);
    expect(hasAiConsent()).toBe(false);
    void requestAiConsent();
    expect(getAiConsentSnapshot().prompting).toBe(true);
    answerAiConsent(false);
  });

  it('withdrawing removes the stored grant', () => {
    setAiConsent(true);
    setAiConsent(false);
    expect(mockStore.has('ai_data_consent')).toBe(false);
    expect(hasAiConsent()).toBe(false);
  });

  it('notices a grant cleared by an account switch', () => {
    setAiConsent(true);
    mockStore.delete('ai_data_consent');
    expect(hasAiConsent()).toBe(false);
    expect(getAiConsentSnapshot().granted).toBe(false);
  });
});

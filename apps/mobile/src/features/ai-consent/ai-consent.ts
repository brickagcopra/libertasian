import { mmkvStorage, STORAGE_KEYS } from '../../storage/mmkv';

/**
 * Consent to send user content to a third-party AI provider (OpenAI).
 *
 * App Store Guideline 5.1.2(i): an app must clearly disclose when personal
 * data is shared with a third party, including a third-party AI, and obtain
 * explicit permission before doing so. Every request that hands user-provided
 * content to the AI pipeline goes through `requestAiConsent()` first: the
 * transports call it (`api-client.ts`, `stream-ai-answer.ts`,
 * `stream-deep-research.ts`), so no screen can reach the AI without it.
 *
 * Only a grant is persisted. "Not now" is not remembered as a refusal; it
 * just stops this request, and the next AI action asks again. The grant can
 * be withdrawn at any time from Settings > AI data sharing.
 *
 * The stored value is ACCOUNT-scoped (see `ACCOUNT_SCOPED_KEYS`): one person's
 * grant must not carry over to the next account signed in on the device.
 */

/** The text shown on every surface that refuses an AI request without consent. */
export const AI_CONSENT_DECLINED_MESSAGE =
  'AI features need your permission to send content to our AI provider. You can allow it in Settings > AI data sharing.';

/** Requests that send user-provided content to the AI pipeline. */
const AI_POST_PATTERNS: readonly RegExp[] = [
  /^\/ai-answers(\/|$)/,
  /^\/deep-research(\/stream)?$/,
  // /digests/generate, /memos/generate, /pleadings/generate,
  // /hearing-prep/generate, /timelines/generate,
  // /uploads/:id/generate-digest|-flashcards|-outline
  /\/generate(-[a-z]+)?$/,
];

export function requiresAiConsent(method: string | undefined, endpoint: string): boolean {
  if ((method ?? 'GET').toUpperCase() !== 'POST') return false;
  const path = endpoint.split('?')[0];
  return AI_POST_PATTERNS.some((pattern) => pattern.test(path));
}

interface ConsentSnapshot {
  granted: boolean;
  /** True while the consent sheet is waiting for an answer. */
  prompting: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
// Read lazily, not at import: storage may not be ready when this module loads.
let snapshotCache: ConsentSnapshot | null = null;
function current(): ConsentSnapshot {
  if (!snapshotCache) snapshotCache = { granted: readGrant(), prompting: false };
  return snapshotCache;
}
let pending: Promise<boolean> | null = null;
let resolvePending: ((granted: boolean) => void) | null = null;

function readGrant(): boolean {
  return mmkvStorage.getBoolean(STORAGE_KEYS.AI_DATA_CONSENT) === true;
}

function publish(next: ConsentSnapshot): void {
  snapshotCache = next;
  listeners.forEach((listener) => listener());
}

export function subscribeAiConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAiConsentSnapshot(): ConsentSnapshot {
  return current();
}

export function hasAiConsent(): boolean {
  // Re-read storage: an account switch clears the key behind our back.
  const granted = readGrant();
  if (granted !== current().granted) publish({ ...current(), granted });
  return granted;
}

export function setAiConsent(granted: boolean): void {
  if (granted) {
    mmkvStorage.setBoolean(STORAGE_KEYS.AI_DATA_CONSENT, true);
  } else {
    mmkvStorage.delete(STORAGE_KEYS.AI_DATA_CONSENT);
  }
  publish({ ...current(), granted });
}

/**
 * Resolve true if the user has granted (or now grants) consent, false if they
 * decline. Concurrent callers share one prompt. Requires `<AiConsentHost />`
 * to be mounted; it is, at the app root.
 */
export function requestAiConsent(): Promise<boolean> {
  if (hasAiConsent()) return Promise.resolve(true);
  if (pending) return pending;

  pending = new Promise<boolean>((resolve) => {
    resolvePending = resolve;
  });
  publish({ ...current(), prompting: true });
  return pending;
}

/** Called by the consent sheet with the user's answer. */
export function answerAiConsent(granted: boolean): void {
  if (granted) setAiConsent(true);
  const resolve = resolvePending;
  pending = null;
  resolvePending = null;
  publish({ ...current(), granted: granted || current().granted, prompting: false });
  resolve?.(granted);
}

import { mmkvStorage, STORAGE_KEYS } from '../../storage/mmkv';

/**
 * One-time agreement to the Community Guidelines (App Store Guideline 1.2).
 *
 * An app with user-generated content must require users to agree to terms
 * that leave no tolerance for objectionable content or abusive users before
 * they can contribute. Every surface that publishes a feed post or comment
 * calls `requestCommunityAgreement()` at submit time and aborts the submit
 * when it resolves false.
 *
 * Only an acceptance is persisted. "Cancel" just stops that submit; the next
 * one asks again. The stored value is ACCOUNT-scoped (see
 * `ACCOUNT_SCOPED_KEYS`): one person's agreement does not carry over to the
 * next account signed in on the device.
 */

interface AgreementSnapshot {
  accepted: boolean;
  /** True while the agreement sheet is waiting for an answer. */
  prompting: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
// Read lazily, not at import: storage may not be ready when this module loads.
let snapshotCache: AgreementSnapshot | null = null;
function current(): AgreementSnapshot {
  if (!snapshotCache) snapshotCache = { accepted: readAcceptance(), prompting: false };
  return snapshotCache;
}
let pending: Promise<boolean> | null = null;
let resolvePending: ((accepted: boolean) => void) | null = null;

function readAcceptance(): boolean {
  return mmkvStorage.getBoolean(STORAGE_KEYS.COMMUNITY_GUIDELINES_ACCEPTED) === true;
}

function publish(next: AgreementSnapshot): void {
  snapshotCache = next;
  listeners.forEach((listener) => listener());
}

export function subscribeCommunityAgreement(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCommunityAgreementSnapshot(): AgreementSnapshot {
  return current();
}

export function hasCommunityAgreement(): boolean {
  // Re-read storage: an account switch clears the key behind our back.
  const accepted = readAcceptance();
  if (accepted !== current().accepted) publish({ ...current(), accepted });
  return accepted;
}

export function setCommunityAgreement(accepted: boolean): void {
  if (accepted) {
    mmkvStorage.setBoolean(STORAGE_KEYS.COMMUNITY_GUIDELINES_ACCEPTED, true);
  } else {
    mmkvStorage.delete(STORAGE_KEYS.COMMUNITY_GUIDELINES_ACCEPTED);
  }
  publish({ ...current(), accepted });
}

/**
 * Resolve true if the user has agreed (or now agrees) to the Community
 * Guidelines, false if they cancel. Concurrent callers share one prompt.
 * Requires `<CommunityAgreementHost />` to be mounted; it is, at the app root.
 */
export function requestCommunityAgreement(): Promise<boolean> {
  if (hasCommunityAgreement()) return Promise.resolve(true);
  if (pending) return pending;

  pending = new Promise<boolean>((resolve) => {
    resolvePending = resolve;
  });
  publish({ ...current(), prompting: true });
  return pending;
}

/** Called by the agreement sheet with the user's answer. */
export function answerCommunityAgreement(accepted: boolean): void {
  if (accepted) setCommunityAgreement(true);
  const resolve = resolvePending;
  pending = null;
  resolvePending = null;
  publish({ ...current(), accepted: accepted || current().accepted, prompting: false });
  resolve?.(accepted);
}

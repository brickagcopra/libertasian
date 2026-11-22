/** Error code the API answers (409) when this device lost its in-use slot. */
export const SESSION_DISPLACED_CODE = 'session_displaced';

type Listener = () => void;

let displaced = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeSessionDisplaced(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSessionDisplacedSnapshot(): boolean {
  return displaced;
}

export function setSessionDisplaced(value: boolean): void {
  if (displaced === value) return;
  displaced = value;
  emit();
}

/** True for an error body of the API's 409 session_displaced response. */
export function isSessionDisplacedBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as { code?: unknown; error?: unknown };
  return b.code === SESSION_DISPLACED_CODE || b.error === SESSION_DISPLACED_CODE;
}

/**
 * Inspect a failed response; when it is session_displaced (the plan's
 * concurrent-use cap and another device took this one's slot), raise the
 * "Use it here" sheet. Returns whether it was.
 */
export function noteIfSessionDisplaced(status: number, body: unknown): boolean {
  if (status !== 409 || !isSessionDisplacedBody(body)) return false;
  setSessionDisplaced(true);
  return true;
}

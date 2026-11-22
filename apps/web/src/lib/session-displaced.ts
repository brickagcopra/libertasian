import { create } from 'zustand';

/** Error code the API answers (409) when this device lost its in-use slot. */
export const SESSION_DISPLACED_CODE = 'session_displaced';

interface SessionDisplacedState {
  /** True once any request came back 409 session_displaced. */
  displaced: boolean;
  setDisplaced: (displaced: boolean) => void;
}

/**
 * Ephemeral UI state for the concurrent-use cap (device limits phase 2): the
 * plan allows only so many devices in use at once, and another one took this
 * device's slot. SessionDisplacedDialog reads it; the api client sets it.
 */
export const useSessionDisplacedStore = create<SessionDisplacedState>((set) => ({
  displaced: false,
  setDisplaced: (displaced) => set({ displaced }),
}));

/** True for an error body of the API's 409 session_displaced response. */
export function isSessionDisplacedBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as { code?: unknown; error?: unknown };
  return b.code === SESSION_DISPLACED_CODE || b.error === SESSION_DISPLACED_CODE;
}

/**
 * Inspect a failed response; when it is session_displaced, raise the dialog.
 * Returns whether it was.
 */
export function noteIfSessionDisplaced(status: number, body: unknown): boolean {
  if (status !== 409 || !isSessionDisplacedBody(body)) return false;
  useSessionDisplacedStore.getState().setDisplaced(true);
  return true;
}

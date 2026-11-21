import { ApiClientError } from '../../../lib/api-client';

/**
 * The text to show when a feed write (post, comment, report) fails.
 *
 * A 4xx from the feed API carries a message written for the user — "Your
 * comment contains language that isn't allowed under our Community
 * Guidelines…", "You have already reported this comment" — so it is shown as
 * is. Anything else (network, timeout, 5xx, a 401 that is about to sign the
 * user out) falls back to the caller's generic text. 402/403 bodies are
 * already replaced with a neutral message inside `ApiClientError`.
 */
export function feedErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof ApiClientError &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    error.statusCode !== 401 &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }
  return fallback;
}

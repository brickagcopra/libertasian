import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV({
  id: 'libertasian-storage',
});

// Typed storage helpers
export const mmkvStorage = {
  getString: (key: string): string | undefined => storage.getString(key),
  setString: (key: string, value: string): void => storage.set(key, value),
  getBoolean: (key: string): boolean | undefined => storage.getBoolean(key),
  setBoolean: (key: string, value: boolean): void => storage.set(key, value),
  getNumber: (key: string): number | undefined => storage.getNumber(key),
  setNumber: (key: string, value: number): void => storage.set(key, value),
  delete: (key: string): void => storage.delete(key),
  contains: (key: string): boolean => storage.contains(key),
  clearAll: (): void => storage.clearAll(),
};

// Storage keys
export const STORAGE_KEYS = {
  RECENTLY_VIEWED: 'recently_viewed_docs',
  SEARCH_HISTORY: 'search_history',
  USER_PREFERENCES: 'user_preferences',
  CACHED_DIGESTS: 'cached_digests',
  STUDY_STATS: 'study_stats',
  FLASHCARD_PROGRESS: 'flashcard_progress',
  LAST_STUDY_SUBJECT: 'last_study_subject',
  OFFLINE_CODAL_IDS: 'offline_codal_ids',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  CACHED_BLOG_POSTS: 'cached_blog_posts',
  AD_DISMISSED_IDS: 'ad_dismissed_ids',
  AD_SESSION_ID: 'ad_session_id',
  AD_IMPRESSED_IDS: 'ad_impressed_ids',
  /**
   * Last resolved answer from `useFreemiumSurfaces()`. Cached so a cold start
   * does not flash the pre-resolution default at an entitled account.
   */
  ENTITLED_SURFACES: 'entitled_surfaces',
} as const;

/**
 * Keys whose value belongs to the signed-in ACCOUNT, not to the device.
 *
 * Everything here is either fetched per user (`ENTITLED_SURFACES` comes from
 * `/quotas/usage`) or accumulated by one user's activity. Carrying any of it
 * across an account switch shows one user another user's state.
 *
 * Deliberately NOT here:
 * - `USER_PREFERENCES` — no reader or writer exists in the app; the one
 *   preference that is actually persisted (theme) uses its own `theme_choice`
 *   key, which is device-level and must survive a switch.
 * - `AD_SESSION_ID` — a per-launch device id, not account state.
 * - `CACHED_BLOG_POSTS` — public content, identical for every account.
 */
const ACCOUNT_SCOPED_KEYS: readonly string[] = [
  STORAGE_KEYS.ENTITLED_SURFACES,
  STORAGE_KEYS.RECENTLY_VIEWED,
  STORAGE_KEYS.SEARCH_HISTORY,
  STORAGE_KEYS.CACHED_DIGESTS,
  STORAGE_KEYS.STUDY_STATS,
  STORAGE_KEYS.FLASHCARD_PROGRESS,
  STORAGE_KEYS.LAST_STUDY_SUBJECT,
  STORAGE_KEYS.OFFLINE_CODAL_IDS,
  STORAGE_KEYS.ONBOARDING_COMPLETED,
  STORAGE_KEYS.AD_DISMISSED_IDS,
  STORAGE_KEYS.AD_IMPRESSED_IDS,
];

/**
 * Drop every account-scoped key. Called from BOTH sides of an account switch
 * (`signIn` and `signOut` in `providers/auth-provider.tsx`) so the list lives
 * in exactly one place.
 *
 * Not `clearAll()`: that would also take device-level state (theme, ad session)
 * which has nothing to do with which account is signed in. `clearAll()` stays
 * the right call in `app/settings/delete-account.tsx`, where the whole device
 * copy of the account is meant to go.
 */
export function clearAccountScopedStorage(): void {
  for (const key of ACCOUNT_SCOPED_KEYS) {
    storage.delete(key);
  }
}

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

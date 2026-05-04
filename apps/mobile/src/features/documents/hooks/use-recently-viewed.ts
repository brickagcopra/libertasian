import { useState, useCallback } from 'react';
import { mmkvStorage, STORAGE_KEYS } from '../../../storage/mmkv';

const MAX_ENTRIES = 15;

export interface RecentlyViewedItem {
  id: string;
  title: string;
  shortTitle: string | null;
  documentType: string;
  grNo: string | null;
  court: string | null;
  viewedAt: string;
}

function readRecent(): RecentlyViewedItem[] {
  const raw = mmkvStorage.getString(STORAGE_KEYS.RECENTLY_VIEWED);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop entries persisted under PR #113 where the api-client returned the
    // envelope and `id`/`documentType` got stored as undefined.
    return (parsed as RecentlyViewedItem[]).filter(
      (e) => typeof e?.id === 'string' && typeof e?.documentType === 'string',
    );
  } catch {
    return [];
  }
}

function writeRecent(entries: RecentlyViewedItem[]): void {
  mmkvStorage.setString(STORAGE_KEYS.RECENTLY_VIEWED, JSON.stringify(entries));
}

export function useRecentlyViewed() {
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedItem[]>(
    () => readRecent(),
  );

  const addEntry = useCallback(
    (doc: Omit<RecentlyViewedItem, 'viewedAt'>) => {
      // Refuse to persist garbage so we don't poison the cache the way PR #113 did.
      if (typeof doc.id !== 'string' || typeof doc.documentType !== 'string') {
        return;
      }
      setRecentlyViewed((prev) => {
        const filtered = prev.filter((d) => d.id !== doc.id);
        const entry: RecentlyViewedItem = {
          ...doc,
          viewedAt: new Date().toISOString(),
        };
        const next = [entry, ...filtered].slice(0, MAX_ENTRIES);
        writeRecent(next);
        return next;
      });
    },
    [],
  );

  const clearAll = useCallback(() => {
    writeRecent([]);
    setRecentlyViewed([]);
  }, []);

  return { recentlyViewed, addEntry, clearAll };
}

import { useState, useCallback } from 'react';
import { mmkvStorage, STORAGE_KEYS } from '../../../storage/mmkv';

const MAX_ENTRIES = 20;

function readHistory(): string[] {
  const raw = mmkvStorage.getString(STORAGE_KEYS.SEARCH_HISTORY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
    return [];
  } catch {
    return [];
  }
}

function writeHistory(entries: string[]): void {
  mmkvStorage.setString(STORAGE_KEYS.SEARCH_HISTORY, JSON.stringify(entries));
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(() => readHistory());

  const addEntry = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setHistory((prev) => {
      const filtered = prev.filter((q) => q !== trimmed);
      const next = [trimmed, ...filtered].slice(0, MAX_ENTRIES);
      writeHistory(next);
      return next;
    });
  }, []);

  const removeEntry = useCallback((query: string) => {
    setHistory((prev) => {
      const next = prev.filter((q) => q !== query);
      writeHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    writeHistory([]);
    setHistory([]);
  }, []);

  return { history, addEntry, removeEntry, clearHistory };
}

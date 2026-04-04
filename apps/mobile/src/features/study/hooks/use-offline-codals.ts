import { useState, useCallback, useEffect, useRef } from 'react';
import { apiClient } from '../../../lib/api-client';
import { mmkvStorage, STORAGE_KEYS } from '../../../storage/mmkv';
import {
  saveCodal,
  removeCachedCodal,
  getCachedCodal,
  getCachedSections,
  cleanStaleCodals,
  getAllCachedCodalIds,
  type CachedCodal,
  type CachedCodalSection,
} from '../../../storage/sqlite';

interface DocumentSection {
  id: string;
  sectionType: string;
  sectionLabel: string | null;
  ordering: number;
  plainText: string | null;
  pageStart: number | null;
  pageEnd: number | null;
}

interface DocumentDetail {
  id: string;
  title: string;
  shortTitle: string | null;
  documentType: string;
  citationText: string | null;
  promulgationDate: string | null;
  isOfficial: boolean;
}

/** Maximum age in days before a cached codal is considered stale and cleaned up */
const STALE_CACHE_DAYS = 30;

function getOfflineIds(): Set<string> {
  const raw = mmkvStorage.getString(STORAGE_KEYS.OFFLINE_CODAL_IDS);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function setOfflineIds(ids: Set<string>): void {
  mmkvStorage.setString(
    STORAGE_KEYS.OFFLINE_CODAL_IDS,
    JSON.stringify([...ids]),
  );
}

export function useOfflineCodals() {
  const [offlineIds, setOfflineIdsState] = useState<Set<string>>(getOfflineIds);
  const [saving, setSaving] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const cleanupRan = useRef(false);

  // On mount: sync MMKV with SQLite and clean stale data
  useEffect(() => {
    async function initAndClean() {
      // Prevent running cleanup more than once per app session
      if (cleanupRan.current) return;
      cleanupRan.current = true;

      try {
        // Clean stale codals from SQLite
        const removedCount = await cleanStaleCodals(STALE_CACHE_DAYS);

        // Reconcile MMKV with SQLite (source of truth)
        const sqliteIds = await getAllCachedCodalIds();
        const reconciled = new Set(sqliteIds);
        setOfflineIds(reconciled);
        setOfflineIdsState(reconciled);

        if (removedCount > 0) {
          setLastError(null);
        }
      } catch {
        // Non-fatal — just use MMKV IDs as-is
        setOfflineIdsState(getOfflineIds());
      }
    }

    initAndClean();
  }, []);

  const isOffline = useCallback(
    (codalId: string): boolean => offlineIds.has(codalId),
    [offlineIds],
  );

  const saveForOffline = useCallback(
    async (codalId: string, subject: string): Promise<boolean> => {
      setSaving(codalId);
      setLastError(null);
      try {
        // Fetch document + sections from API
        const [doc, sections] = await Promise.all([
          apiClient.get<DocumentDetail>(`/documents/${codalId}`),
          apiClient.get<DocumentSection[]>(`/documents/${codalId}/sections`),
        ]);

        const cachedCodal: CachedCodal = {
          id: doc.id,
          subject,
          title: doc.title,
          shortTitle: doc.shortTitle,
          documentType: doc.documentType,
          citationText: doc.citationText,
          promulgationDate: doc.promulgationDate,
          isOfficial: doc.isOfficial,
          sectionCount: sections.length,
          cachedAt: new Date().toISOString(),
        };

        const cachedSections: CachedCodalSection[] = sections.map((s) => ({
          id: s.id,
          codalId: doc.id,
          sectionType: s.sectionType,
          sectionLabel: s.sectionLabel,
          ordering: s.ordering,
          plainText: s.plainText,
          pageStart: s.pageStart,
          pageEnd: s.pageEnd,
        }));

        await saveCodal(cachedCodal, cachedSections);

        // Update MMKV ID set
        const newIds = new Set(offlineIds);
        newIds.add(codalId);
        setOfflineIds(newIds);
        setOfflineIdsState(newIds);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to download for offline use';
        setLastError(message);
        return false;
      } finally {
        setSaving(null);
      }
    },
    [offlineIds],
  );

  const removeOffline = useCallback(
    async (codalId: string): Promise<void> => {
      await removeCachedCodal(codalId);

      const newIds = new Set(offlineIds);
      newIds.delete(codalId);
      setOfflineIds(newIds);
      setOfflineIdsState(newIds);
    },
    [offlineIds],
  );

  const getOfflineCodal = useCallback(
    async (
      codalId: string,
    ): Promise<{
      codal: CachedCodal;
      sections: CachedCodalSection[];
    } | null> => {
      const codal = await getCachedCodal(codalId);
      if (!codal) return null;
      const sections = await getCachedSections(codalId);
      return { codal, sections };
    },
    [],
  );

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  return {
    offlineIds,
    isOffline,
    saveForOffline,
    removeOffline,
    getOfflineCodal,
    saving,
    lastError,
    clearError,
  };
}

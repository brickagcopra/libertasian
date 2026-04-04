import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  db = await SQLite.openDatabaseAsync('libertasian.db');

  // Enable WAL mode per CLAUDE.md
  await db.execAsync('PRAGMA journal_mode = WAL;');

  // Create tables for offline codal caching
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS codals_cache (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      title TEXT NOT NULL,
      short_title TEXT,
      document_type TEXT NOT NULL,
      citation_text TEXT,
      promulgation_date TEXT,
      is_official INTEGER NOT NULL DEFAULT 0,
      section_count INTEGER NOT NULL DEFAULT 0,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codal_sections_cache (
      id TEXT PRIMARY KEY,
      codal_id TEXT NOT NULL,
      section_type TEXT NOT NULL,
      section_label TEXT,
      ordering INTEGER NOT NULL DEFAULT 0,
      plain_text TEXT,
      page_start INTEGER,
      page_end INTEGER,
      FOREIGN KEY (codal_id) REFERENCES codals_cache(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_codals_cache_subject ON codals_cache(subject);
    CREATE INDEX IF NOT EXISTS idx_codal_sections_codal_id ON codal_sections_cache(codal_id);
  `);

  return db;
}

export interface CachedCodal {
  id: string;
  subject: string;
  title: string;
  shortTitle: string | null;
  documentType: string;
  citationText: string | null;
  promulgationDate: string | null;
  isOfficial: boolean;
  sectionCount: number;
  cachedAt: string;
}

export interface CachedCodalSection {
  id: string;
  codalId: string;
  sectionType: string;
  sectionLabel: string | null;
  ordering: number;
  plainText: string | null;
  pageStart: number | null;
  pageEnd: number | null;
}

// Internal row types for SQLite queries
interface CodalRow {
  id: string;
  subject: string;
  title: string;
  short_title: string | null;
  document_type: string;
  citation_text: string | null;
  promulgation_date: string | null;
  is_official: number;
  section_count: number;
  cached_at: string;
}

interface SectionRow {
  id: string;
  codal_id: string;
  section_type: string;
  section_label: string | null;
  ordering: number;
  plain_text: string | null;
  page_start: number | null;
  page_end: number | null;
}

export async function saveCodal(
  codal: CachedCodal,
  sections: CachedCodalSection[],
): Promise<void> {
  const database = await getDb();

  await database.runAsync(
    `INSERT OR REPLACE INTO codals_cache
      (id, subject, title, short_title, document_type, citation_text, promulgation_date, is_official, section_count, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    codal.id,
    codal.subject,
    codal.title,
    codal.shortTitle,
    codal.documentType,
    codal.citationText,
    codal.promulgationDate,
    codal.isOfficial ? 1 : 0,
    codal.sectionCount,
    codal.cachedAt,
  );

  // Delete existing sections and re-insert
  await database.runAsync(
    'DELETE FROM codal_sections_cache WHERE codal_id = ?',
    codal.id,
  );

  for (const section of sections) {
    await database.runAsync(
      `INSERT INTO codal_sections_cache
        (id, codal_id, section_type, section_label, ordering, plain_text, page_start, page_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      section.id,
      section.codalId,
      section.sectionType,
      section.sectionLabel,
      section.ordering,
      section.plainText,
      section.pageStart,
      section.pageEnd,
    );
  }
}

export async function getCachedCodal(
  id: string,
): Promise<CachedCodal | null> {
  const database = await getDb();
  const row = (await database.getFirstAsync(
    'SELECT * FROM codals_cache WHERE id = ?',
    id,
  )) as CodalRow | null;

  if (!row) return null;

  return {
    id: row.id,
    subject: row.subject,
    title: row.title,
    shortTitle: row.short_title,
    documentType: row.document_type,
    citationText: row.citation_text,
    promulgationDate: row.promulgation_date,
    isOfficial: row.is_official === 1,
    sectionCount: row.section_count,
    cachedAt: row.cached_at,
  };
}

export async function getCachedSections(
  codalId: string,
): Promise<CachedCodalSection[]> {
  const database = await getDb();
  const rows: SectionRow[] = await database.getAllAsync(
    'SELECT * FROM codal_sections_cache WHERE codal_id = ? ORDER BY ordering',
    codalId,
  );

  return rows.map((row) => ({
    id: row.id,
    codalId: row.codal_id,
    sectionType: row.section_type,
    sectionLabel: row.section_label,
    ordering: row.ordering,
    plainText: row.plain_text,
    pageStart: row.page_start,
    pageEnd: row.page_end,
  }));
}

export async function getCachedCodalsBySubject(
  subject: string,
): Promise<CachedCodal[]> {
  const database = await getDb();
  const rows: CodalRow[] = await database.getAllAsync(
    'SELECT * FROM codals_cache WHERE subject = ? ORDER BY title',
    subject,
  );

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    title: row.title,
    shortTitle: row.short_title,
    documentType: row.document_type,
    citationText: row.citation_text,
    promulgationDate: row.promulgation_date,
    isOfficial: row.is_official === 1,
    sectionCount: row.section_count,
    cachedAt: row.cached_at,
  }));
}

export async function removeCachedCodal(id: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM codal_sections_cache WHERE codal_id = ?', id);
  await database.runAsync('DELETE FROM codals_cache WHERE id = ?', id);
}

export async function isCodalCached(id: string): Promise<boolean> {
  const database = await getDb();
  const row = (await database.getFirstAsync(
    'SELECT COUNT(*) as cnt FROM codals_cache WHERE id = ?',
    id,
  )) as { cnt: number } | null;
  return (row?.cnt ?? 0) > 0;
}

export interface CacheStats {
  totalCodals: number;
  totalSections: number;
  oldestCachedAt: string | null;
  newestCachedAt: string | null;
}

export async function getCacheStats(): Promise<CacheStats> {
  const database = await getDb();

  const codalCount = (await database.getFirstAsync(
    'SELECT COUNT(*) as cnt FROM codals_cache',
  )) as { cnt: number } | null;

  const sectionCount = (await database.getFirstAsync(
    'SELECT COUNT(*) as cnt FROM codal_sections_cache',
  )) as { cnt: number } | null;

  const oldest = (await database.getFirstAsync(
    'SELECT MIN(cached_at) as val FROM codals_cache',
  )) as { val: string | null } | null;

  const newest = (await database.getFirstAsync(
    'SELECT MAX(cached_at) as val FROM codals_cache',
  )) as { val: string | null } | null;

  return {
    totalCodals: codalCount?.cnt ?? 0,
    totalSections: sectionCount?.cnt ?? 0,
    oldestCachedAt: oldest?.val ?? null,
    newestCachedAt: newest?.val ?? null,
  };
}

/**
 * Remove codals cached more than `maxAgeDays` ago.
 * Returns the number of codals removed.
 */
export async function cleanStaleCodals(maxAgeDays = 30): Promise<number> {
  const database = await getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffIso = cutoff.toISOString();

  // Get stale IDs before deleting (for MMKV sync)
  const staleRows: { id: string }[] = await database.getAllAsync(
    'SELECT id FROM codals_cache WHERE cached_at < ?',
    cutoffIso,
  );

  if (staleRows.length === 0) return 0;

  const staleIds = staleRows.map((r) => r.id);

  // Delete sections first (FK constraint), then codals
  for (const id of staleIds) {
    await database.runAsync(
      'DELETE FROM codal_sections_cache WHERE codal_id = ?',
      id,
    );
    await database.runAsync('DELETE FROM codals_cache WHERE id = ?', id);
  }

  return staleIds.length;
}

/**
 * Returns IDs of all currently cached codals in SQLite.
 * Useful for reconciling with MMKV offline ID set.
 */
export async function getAllCachedCodalIds(): Promise<string[]> {
  const database = await getDb();
  const rows: { id: string }[] = await database.getAllAsync(
    'SELECT id FROM codals_cache ORDER BY cached_at DESC',
  );
  return rows.map((r) => r.id);
}

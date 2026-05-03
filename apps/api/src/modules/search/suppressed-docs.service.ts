import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Redis key holding the set of legal_documents.id values that the search
 * pipeline must hide from results because the dedup engine flagged them as
 * non-canonical duplicates / older versions.
 */
export const SUPPRESSED_DOCS_KEY = 'cache:search:suppressed_doc_ids';

/**
 * Sentinel key proving the set was populated from Postgres at some point in
 * the last TTL window. We need this because an empty Redis set is a valid
 * answer (no docs to suppress) and is indistinguishable from a cold cache
 * via SMEMBERS alone. Sentinel present → trust the (possibly empty) set.
 * Sentinel missing → treat as a cache miss and re-populate from Postgres.
 */
export const SUPPRESSED_DOCS_POPULATED_KEY =
  'cache:search:suppressed_doc_ids:populated';

/** Read-through cache TTL (seconds). */
const SUPPRESSED_DOCS_TTL = 60 * 60;

/**
 * Cap on how many suppressed IDs we will inject into a single OpenSearch
 * `must_not.terms` clause. OpenSearch defaults `index.max_terms_count` to
 * 65_536, but huge `must_not` lists also degrade query plans. If the set
 * grows past this we should switch to a materialized `is_canonical` flag
 * on `legal_documents`. See TODO below.
 */
const MAX_TERMS_INLINE = 5_000;

/**
 * Read-through cache for the "suppressed document IDs" set used by the
 * search dedup post-filter. Postgres `document_similarities` is the system
 * of record; Redis is a 1h cache.
 *
 * Suppression rules (preserved from the original PR #103 implementation):
 *   - exact_duplicate / mirror_duplicate (any status): suppress every
 *     documentId in the cluster that is NOT canonical_document_id.
 *   - version_update: suppress the document with the lower `version_no`.
 *   - title (only): never suppressed.
 *
 * Public API:
 *   - getSuppressedDocIds(): hot-path read, returns the cached Set or
 *     populates from Postgres on miss.
 *   - refresh(): forced-invalidate — DEL both keys then re-warm. Used by
 *     the admin diagnostics endpoint.
 *   - getCount(): cardinality for diagnostics.
 *
 * TODO(search-dedup): replace with `is_canonical` field on `legal_documents`
 * + reindex; remove this service and the Redis hop.
 */
@Injectable()
export class SuppressedDocsService {
  private readonly logger = new Logger(SuppressedDocsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Return the suppressed-doc set for query-time injection. Redis is read
   * first; on miss (sentinel absent) the set is recomputed from Postgres
   * and written back. Defensive on every failure path: search MUST NOT
   * 500 because of this filter.
   */
  async getSuppressedDocIds(): Promise<Set<string>> {
    const cached = await this.readFromCache();
    if (cached) {
      return cached;
    }

    let ids: Set<string>;
    try {
      ids = await this.loadFromPostgres();
    } catch (err) {
      this.logger.warn(
        `Failed to load suppressed-docs from Postgres (${(err as Error).message}); ` +
          'search will run without dedup filter',
      );
      return new Set();
    }

    await this.writeToCache(ids);
    return ids;
  }

  /**
   * Force-invalidate the cache and re-populate from Postgres. Returns the
   * new cardinality. Safe to run any time; idempotent.
   */
  async refresh(): Promise<{ count: number }> {
    try {
      const client = this.redis.getClient();
      await client.del(SUPPRESSED_DOCS_KEY, SUPPRESSED_DOCS_POPULATED_KEY);
    } catch (err) {
      this.logger.warn(
        `Failed to clear suppressed-docs cache during refresh: ${(err as Error).message}`,
      );
    }
    const ids = await this.getSuppressedDocIds();
    this.logger.log(`Suppressed-docs cache refreshed: ${ids.size} document IDs`);
    return { count: ids.size };
  }

  /**
   * Diagnostics counter. Triggers a populate on miss so admins always see
   * the live number. Returns 0 if both Redis and Postgres are unreachable.
   */
  async getCount(): Promise<number> {
    const ids = await this.getSuppressedDocIds();
    return ids.size;
  }

  /**
   * Read-side cache lookup. Returns `null` on cache miss (no sentinel) or
   * any Redis error — the caller falls through to Postgres.
   */
  private async readFromCache(): Promise<Set<string> | null> {
    try {
      const client = this.redis.getClient();
      const populated = await client.get(SUPPRESSED_DOCS_POPULATED_KEY);
      if (!populated) {
        return null;
      }
      const cardinality = await client.scard(SUPPRESSED_DOCS_KEY);
      if (cardinality > MAX_TERMS_INLINE) {
        this.logger.warn(
          `Suppressed-docs set has ${cardinality} entries, exceeding inline cap ${MAX_TERMS_INLINE}. ` +
            'Skipping must_not.terms — switch to materialized is_canonical filter (TODO).',
        );
        return new Set();
      }
      if (cardinality === 0) {
        return new Set();
      }
      const members = await client.smembers(SUPPRESSED_DOCS_KEY);
      return new Set(members);
    } catch (err) {
      this.logger.warn(
        `Failed to read suppressed-docs from Redis (${(err as Error).message}); ` +
          'falling through to Postgres',
      );
      return null;
    }
  }

  /**
   * Write the freshly-loaded set to Redis with a TTL on both the set and
   * the sentinel. Failures are logged but never propagate — the caller
   * already has the Postgres result.
   */
  private async writeToCache(ids: Set<string>): Promise<void> {
    try {
      const client = this.redis.getClient();
      const pipeline = client.multi();
      pipeline.del(SUPPRESSED_DOCS_KEY);
      if (ids.size > 0) {
        pipeline.sadd(SUPPRESSED_DOCS_KEY, ...Array.from(ids));
        pipeline.expire(SUPPRESSED_DOCS_KEY, SUPPRESSED_DOCS_TTL);
      }
      pipeline.set(SUPPRESSED_DOCS_POPULATED_KEY, '1', 'EX', SUPPRESSED_DOCS_TTL);
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(
        `Failed to write suppressed-docs to Redis (${(err as Error).message}); ` +
          'returning Postgres result without caching',
      );
    }
  }

  /**
   * Compute the suppressed-doc set from `document_similarities` using the
   * three-rule policy. This is the system of record; Redis is just a cache.
   */
  private async loadFromPostgres(): Promise<Set<string>> {
    const ids = new Set<string>();

    const dupes = await this.prisma.documentSimilarity.findMany({
      where: {
        similarityType: { in: ['exact_duplicate', 'mirror_duplicate'] },
        canonicalDocumentId: { not: null },
      },
      select: {
        documentAId: true,
        documentBId: true,
        canonicalDocumentId: true,
      },
    });
    for (const row of dupes) {
      if (row.documentAId !== row.canonicalDocumentId) {
        ids.add(row.documentAId);
      }
      if (row.documentBId !== row.canonicalDocumentId) {
        ids.add(row.documentBId);
      }
    }

    const versions = await this.prisma.documentSimilarity.findMany({
      where: { similarityType: 'version_update' },
      select: {
        documentA: { select: { id: true, versionNo: true } },
        documentB: { select: { id: true, versionNo: true } },
      },
    });
    for (const row of versions) {
      const a = row.documentA;
      const b = row.documentB;
      if (a.versionNo > b.versionNo) {
        ids.add(b.id);
      } else if (b.versionNo > a.versionNo) {
        ids.add(a.id);
      }
    }

    return ids;
  }
}

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
 * TTL on the Redis set (seconds). The set is regenerated on each refresh
 * call, but a TTL provides a safety net if a refresh ever fails to run.
 */
const SUPPRESSED_DOCS_TTL = 24 * 60 * 60;

/**
 * Cap on how many suppressed IDs we will inject into a single OpenSearch
 * `must_not.terms` clause. OpenSearch defaults `index.max_terms_count` to
 * 65_536, but huge `must_not` lists also degrade query plans. If the set
 * grows past this we should switch to approach (a) — a materialized
 * `is_canonical` flag on `legal_documents`. See TODO below.
 */
const MAX_TERMS_INLINE = 5_000;

/**
 * Service that maintains a Redis set of "suppressed" document IDs (rows the
 * dedup engine identified as non-canonical duplicates or stale versions),
 * and exposes them to the search query layer for `must_not` filtering.
 *
 * Approach (b): query-time filter via Redis set. Cheap to deploy, instantly
 * revertible. Once the corpus stabilises we should migrate to approach (a)
 * — store an `is_canonical` boolean on `legal_documents` that the indexer
 * writes at index time and the search query references as a single `term`
 * filter. That avoids the Redis hop and the `must_not.terms` size ceiling.
 *
 * TODO(search-dedup): replace with `is_canonical` field on `legal_documents`
 * + reindex; remove this service and the Redis hop. Tracked in follow-up PR.
 */
@Injectable()
export class SuppressedDocsService {
  private readonly logger = new Logger(SuppressedDocsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Recompute the suppressed-doc set from `document_similarities` and write
   * it to Redis. Suppression rules:
   *   - exact_duplicate / mirror_duplicate (any status): suppress every
   *     documentId in the cluster that is NOT canonical_document_id.
   *   - version_update: suppress the document with the lower `version_no`.
   *   - title (only): do NOT suppress — these are sometimes legitimately
   *     distinct documents.
   *
   * Returns the number of distinct doc IDs written to the set.
   */
  async refresh(): Promise<{ count: number }> {
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

    const client = this.redis.getClient();
    await client.del(SUPPRESSED_DOCS_KEY);
    if (ids.size > 0) {
      await client.sadd(SUPPRESSED_DOCS_KEY, ...Array.from(ids));
      await client.expire(SUPPRESSED_DOCS_KEY, SUPPRESSED_DOCS_TTL);
    }

    this.logger.log(
      `Suppressed-docs set refreshed: ${ids.size} document IDs`,
    );
    return { count: ids.size };
  }

  /**
   * Return suppressed doc IDs for query-time injection. Defensive: if Redis
   * is down, the set is missing, or the cap is exceeded, returns [] and
   * logs a warning. Search MUST NOT 500 when this fails.
   */
  async getSuppressedIds(): Promise<string[]> {
    try {
      const client = this.redis.getClient();
      const cardinality = await client.scard(SUPPRESSED_DOCS_KEY);
      if (cardinality === 0) {
        this.logger.debug(
          'Suppressed-docs set is empty; search will run without dedup filter',
        );
        return [];
      }
      if (cardinality > MAX_TERMS_INLINE) {
        this.logger.warn(
          `Suppressed-docs set has ${cardinality} entries, exceeding inline cap ${MAX_TERMS_INLINE}. ` +
            'Skipping must_not.terms — switch to materialized is_canonical filter (TODO).',
        );
        return [];
      }
      return await client.smembers(SUPPRESSED_DOCS_KEY);
    } catch (err) {
      this.logger.warn(
        `Failed to read suppressed-docs set (${(err as Error).message}); falling back to no filter`,
      );
      return [];
    }
  }

  /**
   * Diagnostics counter — used by the admin diagnostics endpoint. Returns
   * 0 if Redis is unreachable so the endpoint stays usable during outages.
   */
  async getCount(): Promise<number> {
    try {
      const client = this.redis.getClient();
      return await client.scard(SUPPRESSED_DOCS_KEY);
    } catch (err) {
      this.logger.warn(
        `Failed to read suppressed-docs count: ${(err as Error).message}`,
      );
      return 0;
    }
  }
}

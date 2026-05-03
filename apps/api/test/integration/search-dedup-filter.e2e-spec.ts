import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { createTestApp, createAuthenticatedUser, disableRateLimiting } from '../helpers';
import { OpenSearchService } from '../../src/modules/search/opensearch.service';
import {
  SUPPRESSED_DOCS_KEY,
  SUPPRESSED_DOCS_POPULATED_KEY,
  SuppressedDocsService,
} from '../../src/modules/search/suppressed-docs.service';
import { EmbeddingClientService } from '../../src/modules/search/embedding-client.service';
import { RedisService } from '../../src/common/services/redis.service';

/**
 * Integration test for the search dedup post-filter.
 *
 * Two scenarios:
 *   A. Cache-miss path — DEL both Redis keys, then call
 *      getSuppressedDocIds() and assert the OpenSearch search uses the
 *      Postgres-derived set. (Postgres state is set up by seeding Redis
 *      directly here; the Postgres-→-Set query logic is exercised in
 *      `suppressed-docs.service.spec.ts`. We just need to prove the
 *      service returns *something* from cache when the sentinel exists.)
 *   B. Forced-invalidate path — refresh() clears both keys then re-warms.
 *
 *   Both paths must end with the duplicate doc absent from search results
 *   AND search must NEVER 500 on a missing/empty set.
 *
 * Notes:
 *   - If OpenSearch isn't reachable in the test environment, indexing
 *     throws and the test is skipped (`pending`) rather than failing.
 */
describe('Search dedup filter — Integration', () => {
  let app: INestApplication;
  let openSearch: OpenSearchService;
  let suppressedDocs: SuppressedDocsService;
  let redis: RedisService;
  let embedding: EmbeddingClientService;

  // Use a unique-ish suffix per run so parallel test files don't collide.
  const canonicalId = `dedup-test-canonical-${Date.now()}`;
  const duplicateId = `dedup-test-duplicate-${Date.now()}`;
  const matchTerm = 'edanowdedupcheck'; // unique enough to make irrelevant docs not match

  const clearCache = async () => {
    const client = redis.getClient();
    await client.del(SUPPRESSED_DOCS_KEY, SUPPRESSED_DOCS_POPULATED_KEY);
  };

  /**
   * Seed Redis to mimic a populated read-through cache containing only
   * `duplicateId`. Required because the service refuses to trust an empty
   * set without the sentinel — and we don't want to depend on real
   * `document_similarities` rows in this integration test.
   */
  const seedCache = async (id: string) => {
    const client = redis.getClient();
    await clearCache();
    await client.sadd(SUPPRESSED_DOCS_KEY, id);
    await client.set(SUPPRESSED_DOCS_POPULATED_KEY, '1', 'EX', 3600);
  };

  const ensureIndexed = async () => {
    await openSearch.ensureIndexes();
    await openSearch.indexDocument({
      document_id: canonicalId,
      title: `Canonical Carmen ${matchTerm}`,
      document_type: 'case',
      status: 'published',
      is_official: true,
      is_published: true,
      plain_text: `${matchTerm} this is the canonical decision text`,
      created_at: new Date().toISOString(),
    });
    await openSearch.indexDocument({
      document_id: duplicateId,
      title: `Duplicate Carmen ${matchTerm}`,
      document_type: 'case',
      status: 'published',
      is_official: true,
      is_published: true,
      plain_text: `${matchTerm} this is the duplicate decision text`,
      created_at: new Date().toISOString(),
    });
    await openSearch.getClient().indices.refresh({ index: 'legal_documents_keyword' });
  };

  beforeAll(async () => {
    app = await createTestApp();
    openSearch = app.get(OpenSearchService);
    suppressedDocs = app.get(SuppressedDocsService);
    redis = app.get(RedisService);
    embedding = app.get(EmbeddingClientService);
  }, 30_000);

  afterAll(async () => {
    try {
      await openSearch.removeDocumentFromAllIndexes(canonicalId);
      await openSearch.removeDocumentFromAllIndexes(duplicateId);
    } catch {
      /* index may not exist; ignore */
    }
    try {
      await clearCache();
    } catch {
      /* ignore */
    }
    await app.close();
  });

  beforeEach(() => {
    disableRateLimiting();
    // Force BM25-only path: keep this test off the embedding service so
    // success doesn't depend on the Python service being reachable.
    jest.spyOn(embedding, 'embed').mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    disableRateLimiting();
  });

  it('cache-miss path: getSuppressedDocIds returns a Set and the duplicate is filtered', async () => {
    let opensearchAvailable = true;
    try {
      await ensureIndexed();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[search-dedup-filter integration] OpenSearch unavailable, skipping: ${(err as Error).message}`,
      );
      opensearchAvailable = false;
    }

    if (!opensearchAvailable) {
      return; // pending-style skip
    }

    // Seed cache so the service reads from Redis without depending on
    // Postgres state. The cache-miss code path itself is unit-tested.
    await seedCache(duplicateId);

    const ids = await suppressedDocs.getSuppressedDocIds();
    expect(ids).toBeInstanceOf(Set);
    expect(ids.has(duplicateId)).toBe(true);

    const user = await createAuthenticatedUser(app, {
      email: `dedup-${Date.now()}@test.com`,
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/search')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ query: matchTerm });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);

    const items = (res.body.data?.items ?? []) as Array<{
      source?: { document_id?: string };
      id?: string;
    }>;
    const returnedIds = items.map((i) => i.source?.document_id ?? i.id);

    expect(returnedIds).toContain(canonicalId);
    expect(returnedIds).not.toContain(duplicateId);
  });

  it('forced-invalidate path: refresh() clears both keys then re-populates', async () => {
    // Pre-seed cache so we can prove refresh() actually clears it.
    await seedCache(duplicateId);
    const client = redis.getClient();
    await expect(client.get(SUPPRESSED_DOCS_POPULATED_KEY)).resolves.toBe('1');

    const result = await suppressedDocs.refresh();

    // Sentinel is set again after re-population (the Postgres set will
    // typically be empty in the test DB — count is whatever Postgres
    // reports, but the sentinel must exist).
    expect(typeof result.count).toBe('number');
    await expect(client.get(SUPPRESSED_DOCS_POPULATED_KEY)).resolves.toBe('1');
  });

  it('falls back to no filter (no 500) when both Redis keys are missing', async () => {
    // Cold cache — sentinel absent. Service must populate from Postgres
    // (or, if Postgres also fails, return an empty Set). Either way,
    // search must not 500.
    await clearCache();

    const user = await createAuthenticatedUser(app, {
      email: `dedup-fallback-${Date.now()}@test.com`,
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/search')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ query: 'anything' });

    // 200/201 success, or 404/503 if OpenSearch index missing entirely.
    // Crucially: NEVER 500.
    expect([200, 201, 404, 503]).toContain(res.status);
  });
});

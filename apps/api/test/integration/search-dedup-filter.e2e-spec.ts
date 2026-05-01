import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { createTestApp, createAuthenticatedUser, disableRateLimiting } from '../helpers';
import { OpenSearchService } from '../../src/modules/search/opensearch.service';
import { SuppressedDocsService } from '../../src/modules/search/suppressed-docs.service';
import { EmbeddingClientService } from '../../src/modules/search/embedding-client.service';
import { RedisService } from '../../src/common/services/redis.service';

/**
 * Integration test for the search dedup post-filter (PR fix/search-dedup-filter).
 *
 * Scenario:
 *   1. Indexes two documents (canonical + non-canonical) into OpenSearch.
 *   2. Seeds the suppression Redis set with the non-canonical doc ID.
 *   3. Issues a keyword search and asserts only the canonical comes back.
 *
 * Notes:
 *   - We bypass Prisma here and seed Redis directly. The DB-driven path
 *     (`SuppressedDocsService.refresh()`) is covered in
 *     `suppressed-docs.service.spec.ts` to keep this test focused on the
 *     OpenSearch query-side filter.
 *   - If OpenSearch isn't reachable in the test environment, indexing
 *     throws and the test is skipped (`pending`) rather than failing —
 *     consistent with how `search.e2e-spec.ts` tolerates a missing index.
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

  beforeAll(async () => {
    app = await createTestApp();
    openSearch = app.get(OpenSearchService);
    suppressedDocs = app.get(SuppressedDocsService);
    redis = app.get(RedisService);
    embedding = app.get(EmbeddingClientService);
  }, 30_000);

  afterAll(async () => {
    // Best-effort cleanup of test docs and Redis state.
    try {
      await openSearch.removeDocumentFromAllIndexes(canonicalId);
      await openSearch.removeDocumentFromAllIndexes(duplicateId);
    } catch {
      /* index may not exist; ignore */
    }
    try {
      await redis.del('cache:search:suppressed_doc_ids');
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

  it('returns only the canonical document when its duplicate is suppressed', async () => {
    // 1. Try to ensure index exists. If OpenSearch is down, skip.
    let opensearchAvailable = true;
    try {
      await openSearch.ensureIndexes();
      // Index canonical
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
      // Index duplicate (same content body, same searchable term)
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
      // Force a refresh so the search call sees the new docs
      await openSearch.getClient().indices.refresh({ index: 'legal_documents_keyword' });
    } catch (err) {
      // OpenSearch not reachable — bail out without failing the suite.
      // eslint-disable-next-line no-console
      console.warn(
        `[search-dedup-filter integration] OpenSearch unavailable, skipping: ${(err as Error).message}`,
      );
      opensearchAvailable = false;
    }

    if (!opensearchAvailable) {
      return; // pending-style skip
    }

    // 2. Seed suppression set: only the duplicate is non-canonical.
    const client = redis.getClient();
    await client.del('cache:search:suppressed_doc_ids');
    await client.sadd('cache:search:suppressed_doc_ids', duplicateId);

    // Sanity check the service reads what we just wrote.
    const ids = await suppressedDocs.getSuppressedIds();
    expect(ids).toContain(duplicateId);

    // 3. Authenticated search via the gateway. Search returns only canonical.
    const user = await createAuthenticatedUser(app, {
      email: `dedup-${Date.now()}@test.com`,
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/search')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ query: matchTerm });

    // Service may return 200 or 201 depending on Nest defaults
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

  it('falls back to no filter (no 500) when the suppression set is missing', async () => {
    // Force a missing key — search must still respond.
    await redis.del('cache:search:suppressed_doc_ids');

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

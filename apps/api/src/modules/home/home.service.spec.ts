import { Test, TestingModule } from '@nestjs/testing';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HomeService } from './home.service';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_ORG_ID = '33333333-3333-3333-3333-333333333333';

function makeDigest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `digest-${Math.random().toString(36).slice(2, 8)}`,
    title: 'A test digest',
    digestType: 'case_digest',
    summary: 'Summary text',
    facts: null,
    issues: null,
    ruling: null,
    doctrine: null,
    dispositive: null,
    visibility: 'public_editorial',
    reviewStatus: 'approved',
    organizationId: null,
    createdAt: new Date('2026-05-08T12:00:00Z'),
    legalDocument: {
      id: 'doc-1',
      title: 'People v. Test',
      shortTitle: 'People v. Test',
      citationText: 'G.R. No. 12345',
      documentType: 'case',
      ponente: 'Justice Test',
    },
    ...overrides,
  };
}

function makeDocument(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `doc-${Math.random().toString(36).slice(2, 8)}`,
    title: 'A bar review outline',
    shortTitle: 'Outline X',
    citationText: 'LIBERTASIAN · 2026',
    documentType: 'outline',
    ponente: null,
    isPublished: true,
    createdAt: new Date('2026-05-07T12:00:00Z'),
    updatedAt: new Date('2026-05-07T12:00:00Z'),
    ...overrides,
  };
}

describe('HomeService', () => {
  let service: HomeService;
  let prisma: {
    digest: { findMany: jest.Mock };
    legalDocument: { findMany: jest.Mock };
  };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    prisma = {
      digest: { findMany: jest.fn() },
      legalDocument: { findMany: jest.fn() },
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HomeService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(HomeService);
  });

  it('returns todaysBrief + forYou and merges sources by createdAt desc', async () => {
    const digestNew = makeDigest({
      id: 'digest-new',
      createdAt: new Date('2026-05-10T00:00:00Z'),
    });
    const digestOld = makeDigest({
      id: 'digest-old',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const article = makeDocument({
      id: 'doc-article',
      documentType: 'article',
      createdAt: new Date('2026-05-05T00:00:00Z'),
    });

    prisma.digest.findMany
      // todaysBrief query
      .mockResolvedValueOnce([digestNew])
      // forYou digests query
      .mockResolvedValueOnce([digestNew, digestOld]);
    prisma.legalDocument.findMany.mockResolvedValueOnce([article]);

    const result = await service.getFeed(USER_ID, ORG_ID, { limit: 10 });

    expect(result.todaysBrief).toHaveLength(1);
    expect(result.todaysBrief[0]?.id).toBe('digest-new');
    expect(result.todaysBrief[0]?.kind).toBe('digest');

    // Merged forYou order: digest-new (May 10) > article (May 5) > digest-old (May 1)
    expect(result.forYou.map((i) => i.id)).toEqual([
      'digest-new',
      'doc-article',
      'digest-old',
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it('tenant-scopes the digest query: caller org passed to Prisma WHERE clause', async () => {
    prisma.digest.findMany.mockResolvedValue([]);
    prisma.legalDocument.findMany.mockResolvedValue([]);

    await service.getFeed(USER_ID, ORG_ID, {});

    // Both digest queries (todaysBrief + forYou) must restrict to caller's org.
    const calls = prisma.digest.findMany.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [args] of calls) {
      const where = args.where as { OR: Array<Record<string, unknown>> };
      const orgScopedClause = where.OR.find(
        (clause) => 'organizationId' in clause,
      );
      expect(orgScopedClause).toBeDefined();
      expect(orgScopedClause).toMatchObject({ organizationId: ORG_ID });
      // Critically, never the other org.
      expect(orgScopedClause).not.toMatchObject({ organizationId: OTHER_ORG_ID });
    }
  });

  it('only includes approved + public_editorial digests in the public OR-arm', async () => {
    prisma.digest.findMany.mockResolvedValue([]);
    prisma.legalDocument.findMany.mockResolvedValue([]);

    await service.getFeed(USER_ID, ORG_ID, {});

    const [args] = prisma.digest.findMany.mock.calls[0]!;
    const where = args.where as { OR: Array<Record<string, unknown>> };
    const publicArm = where.OR.find(
      (clause) => clause['visibility'] === 'public_editorial' && 'reviewStatus' in clause,
    );
    expect(publicArm).toMatchObject({
      visibility: 'public_editorial',
      reviewStatus: 'approved',
    });
  });

  it('returns a nextCursor when more rows exist than the page limit', async () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeDigest({
        id: `d${i}`,
        createdAt: new Date(2026, 4, 10 - i),
      }),
    );

    prisma.digest.findMany
      .mockResolvedValueOnce([items[0]!]) // todaysBrief
      .mockResolvedValueOnce(items); // forYou (6 items)
    prisma.legalDocument.findMany.mockResolvedValueOnce([]);

    const result = await service.getFeed(USER_ID, ORG_ID, { limit: 5 });

    expect(result.forYou).toHaveLength(5);
    expect(result.nextCursor).not.toBeNull();
    // Cursor should be the last returned item's createdAt.
    const lastReturnedDate = items[4]!.createdAt.toISOString();
    expect(result.nextCursor).toBe(lastReturnedDate);
  });

  it('returns null nextCursor on the last page', async () => {
    prisma.digest.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeDigest()]);
    prisma.legalDocument.findMany.mockResolvedValueOnce([]);

    const result = await service.getFeed(USER_ID, ORG_ID, { limit: 20 });
    expect(result.nextCursor).toBeNull();
  });

  it('caches the first page (cursor=null) under cache:feed:{userId} with 300s TTL', async () => {
    prisma.digest.findMany.mockResolvedValue([]);
    prisma.legalDocument.findMany.mockResolvedValue([]);

    await service.getFeed(USER_ID, ORG_ID, {});

    expect(redis.set).toHaveBeenCalledWith(
      `cache:feed:${USER_ID}`,
      expect.any(String),
      300,
    );
  });

  it('returns the cached payload on a hit and skips Prisma', async () => {
    const cached = {
      todaysBrief: [
        {
          id: 'cached-1',
          kind: 'digest' as const,
          category: 'CASE DIGEST',
          headline: 'Cached headline',
          minutes: 4,
        },
      ],
      forYou: [],
      nextCursor: null,
    };
    redis.get.mockResolvedValueOnce(JSON.stringify(cached));

    const result = await service.getFeed(USER_ID, ORG_ID, {});

    expect(result).toEqual(cached);
    expect(prisma.digest.findMany).not.toHaveBeenCalled();
    expect(prisma.legalDocument.findMany).not.toHaveBeenCalled();
  });

  it('does NOT cache subsequent pages (cursor present)', async () => {
    prisma.digest.findMany.mockResolvedValue([]);
    prisma.legalDocument.findMany.mockResolvedValue([]);

    await service.getFeed(USER_ID, ORG_ID, {
      cursor: '2026-05-01T00:00:00.000Z',
    });

    expect(redis.set).not.toHaveBeenCalled();
    // And on a cursor request we never read from cache (would otherwise return
    // the first page in place of the requested page).
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('passes the cursor as a createdAt < filter to Prisma', async () => {
    prisma.digest.findMany.mockResolvedValue([]);
    prisma.legalDocument.findMany.mockResolvedValue([]);

    const cursor = '2026-05-01T00:00:00.000Z';
    await service.getFeed(USER_ID, ORG_ID, { cursor });

    // First call is todaysBrief (no cursor); second is the forYou digest query.
    const [, forYouCall] = prisma.digest.findMany.mock.calls;
    expect(forYouCall![0].where.createdAt).toEqual({ lt: new Date(cursor) });

    const [docCall] = prisma.legalDocument.findMany.mock.calls;
    expect(docCall![0].where.createdAt).toEqual({ lt: new Date(cursor) });
  });

  it('invalidate() deletes the per-user cache key', async () => {
    await service.invalidate(USER_ID);
    expect(redis.del).toHaveBeenCalledWith(`cache:feed:${USER_ID}`);
  });

  it('falls through to DB when cache JSON is corrupted', async () => {
    redis.get.mockResolvedValueOnce('{not valid json');
    prisma.digest.findMany.mockResolvedValue([]);
    prisma.legalDocument.findMany.mockResolvedValue([]);

    const result = await service.getFeed(USER_ID, ORG_ID, {});
    expect(result.todaysBrief).toEqual([]);
    expect(prisma.digest.findMany).toHaveBeenCalled();
  });

  it('maps documents to feed items with category derived from documentType', async () => {
    prisma.digest.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.legalDocument.findMany.mockResolvedValueOnce([
      makeDocument({ id: 'art-1', documentType: 'article' }),
      makeDocument({
        id: 'out-1',
        documentType: 'outline',
        createdAt: new Date('2026-05-06'),
      }),
    ]);

    const result = await service.getFeed(USER_ID, ORG_ID, {});
    const article = result.forYou.find((i) => i.id === 'art-1');
    const outline = result.forYou.find((i) => i.id === 'out-1');
    expect(article?.category).toBe('ARTICLE');
    expect(article?.kind).toBe('document');
    expect(outline?.category).toBe('OUTLINE');
    expect(outline?.kind).toBe('document');
  });
});

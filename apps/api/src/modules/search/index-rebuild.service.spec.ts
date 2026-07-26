import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import {
  DERIVATIVES_INDEX,
  DERIVATIVES_INDEX_PHYSICAL,
  KEYWORD_INDEX,
  KEYWORD_INDEX_PHYSICAL,
  USER_UPLOADS_INDEX,
  USER_UPLOADS_INDEX_PHYSICAL,
  VECTOR_INDEX,
  VECTOR_INDEX_PHYSICAL,
} from './index-mappings';
import {
  INDEX_REBUILD_QUEUE,
  IndexRebuildService,
  type IndexRebuildProgress,
} from './index-rebuild.service';
import { OpenSearchService } from './opensearch.service';

/**
 * Ordered log of every side-effecting OpenSearch call the rebuild makes. The
 * safety property under test is a statement about this sequence: no destructive
 * call may appear before a successful verification.
 */
type CallLog = string[];

interface OpenSearchMock {
  embeddingDimension: number;
  indexExists: jest.Mock;
  aliasExists: jest.Mock;
  resolveAliasTargets: jest.Mock;
  createPhysicalIndex: jest.Mock;
  bulkIndexDocuments: jest.Mock;
  bulkIndexDerivatives: jest.Mock;
  setRefreshInterval: jest.Mock;
  reindexInto: jest.Mock;
  refreshIndex: jest.Mock;
  countIndex: jest.Mock;
  swapAlias: jest.Mock;
  deleteIndex: jest.Mock;
}

interface PrismaMock {
  legalDocument: { count: jest.Mock; findMany: jest.Mock };
  derivativeArtifact: { count: jest.Mock; findMany: jest.Mock };
}

/** A `derivative_artifacts` row as the rebuild job selects it. */
function buildDerivative(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    derivativeType: 'case_digest',
    title: `Digest ${id}`,
    contentJson: {
      summary: 'Petitioner challenges the validity of a warrantless search.',
      ruling: 'The Court held the search invalid.',
    },
    sourceDocumentId: 'doc-1',
    organizationId: null,
    visibility: 'public_editorial',
    audience: 'both',
    language: 'en',
    taxonomyVersion: 'study_8',
    confidenceScore: 0.91,
    publishedAt: new Date('2026-05-01T00:00:00.000Z'),
    createdAt: new Date('2026-04-20T00:00:00.000Z'),
    subjectAssignments: [{ subject: { code: 'criminal_law' } }],
    ...overrides,
  };
}

function buildDocument(id: string) {
  return {
    id,
    title: `People v. Subject ${id}`,
    shortTitle: null,
    citationText: 'G.R. No. 246999',
    documentType: 'decision',
    court: 'supreme_court',
    ponente: 'HERNANDO',
    jurisdiction: 'PH',
    language: 'en',
    status: 'published',
    grNo: 'G.R. No. 246999',
    docketNo: null,
    isOfficial: true,
    isPublished: true,
    decisionDate: new Date('2026-01-21T00:00:00.000Z'),
    promulgationDate: null,
    publicationDate: null,
    createdAt: new Date('2026-01-22T00:00:00.000Z'),
    source: { id: 'source-1', trustLevel: 'official' },
    sections: [
      { id: `${id}-s1`, sectionType: 'facts', plainText: 'Facts of the case.' },
      { id: `${id}-s2`, sectionType: 'ruling', plainText: null },
    ],
    tagMaps: [{ tag: { code: 'criminal_law', tagType: 'bar_subject' } }],
  };
}

describe('IndexRebuildService', () => {
  let service: IndexRebuildService;
  let calls: CallLog;
  let openSearch: OpenSearchMock;
  let prisma: PrismaMock;
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let verifiedCount: number;
  let pushedCount: number;
  /** Count returned for the derivatives destination index. */
  let derivativeDestCount: number;
  /** What a mocked `reindexInto` reports as measured on both sides. */
  let copyCounts: { reportedCreated: number | null; sourceCount: number; destCount: number };

  beforeEach(async () => {
    calls = [];
    verifiedCount = 2; // 1 doc payload + 1 section payload
    pushedCount = 2;
    derivativeDestCount = 1; // one derivative row in the default fixture
    // The production shape: `_reindex` claims created: 0 while the copy in fact
    // moved every document. The counts are the truth.
    copyCounts = { reportedCreated: 0, sourceCount: 12_196, destCount: 12_196 };

    openSearch = {
      embeddingDimension: 384,
      indexExists: jest.fn(async () => false),
      aliasExists: jest.fn(async () => false),
      resolveAliasTargets: jest.fn(async () => []),
      createPhysicalIndex: jest.fn(async (name: string) => {
        calls.push(`create:${name}`);
      }),
      bulkIndexDocuments: jest.fn(async (docs: unknown[], target: string) => {
        calls.push(`bulk:${target}:${docs.length}`);
        return { indexed: pushedCount, errors: 0 };
      }),
      bulkIndexDerivatives: jest.fn(async (docs: unknown[], target: string) => {
        calls.push(`bulkDerivatives:${target}:${docs.length}`);
        return { indexed: docs.length };
      }),
      setRefreshInterval: jest.fn(async (name: string, interval: string) => {
        calls.push(`refreshInterval:${name}:${interval}`);
      }),
      reindexInto: jest.fn(async (source: string, dest: string) => {
        calls.push(`reindex:${source}->${dest}`);
        return copyCounts;
      }),
      refreshIndex: jest.fn(async (name: string) => {
        calls.push(`refresh:${name}`);
      }),
      countIndex: jest.fn(async (name: string) => {
        calls.push(`count:${name}`);
        return name.startsWith(DERIVATIVES_INDEX) ? derivativeDestCount : verifiedCount;
      }),
      swapAlias: jest.fn(async (options: { alias: string; target: string; removeConcreteIndex?: boolean }) => {
        calls.push(
          `swap:${options.alias}->${options.target}${
            options.removeConcreteIndex ? ':removeConcrete' : ''
          }`,
        );
      }),
      deleteIndex: jest.fn(async (name: string) => {
        calls.push(`delete:${name}`);
      }),
    };

    prisma = {
      legalDocument: {
        count: jest.fn(async () => 1),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([buildDocument('doc-1')])
          .mockResolvedValue([]),
      },
      derivativeArtifact: {
        count: jest.fn(async () => 1),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([buildDerivative('der-1')])
          .mockResolvedValue([]),
      },
    };

    queue = { add: jest.fn(), getJob: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexRebuildService,
        { provide: PrismaService, useValue: prisma },
        { provide: OpenSearchService, useValue: openSearch },
        { provide: getQueueToken(INDEX_REBUILD_QUEUE), useValue: queue },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, fallback?: unknown) => fallback) },
        },
      ],
    }).compile();

    service = module.get(IndexRebuildService);
  });

  const run = async (dryRun = false) => {
    const progress: IndexRebuildProgress[] = [];
    const result = await service.runRebuild(
      { triggeredByUserId: 'user-1', organizationId: 'org-1', dryRun },
      async (p) => {
        progress.push(p);
      },
    );
    return { result, progress };
  };

  describe('ordering safety', () => {
    it('never swaps or deletes before a successful verification', async () => {
      const { result } = await run();

      const verifyAt = calls.indexOf(`count:${KEYWORD_INDEX_PHYSICAL}`);
      const firstDestructive = calls.findIndex(
        (call) => call.startsWith('swap:') || call.startsWith('delete:'),
      );

      expect(verifyAt).toBeGreaterThanOrEqual(0);
      expect(firstDestructive).toBeGreaterThan(verifyAt);
      expect(result.aliasSwapped).toBe(true);
    });

    it('creates → reindexes → refreshes → verifies → swaps, in that order', async () => {
      await run();

      expect(calls).toEqual([
        `create:${KEYWORD_INDEX_PHYSICAL}`,
        `create:${VECTOR_INDEX_PHYSICAL}`,
        `create:${USER_UPLOADS_INDEX_PHYSICAL}`,
        `create:${DERIVATIVES_INDEX_PHYSICAL}`,
        `bulk:${KEYWORD_INDEX_PHYSICAL}:2`,
        // Derivative phase: relax refresh, bulk, restore refresh, then measure.
        `refreshInterval:${DERIVATIVES_INDEX_PHYSICAL}:30s`,
        `bulkDerivatives:${DERIVATIVES_INDEX_PHYSICAL}:1`,
        `refreshInterval:${DERIVATIVES_INDEX_PHYSICAL}:5s`,
        `refresh:${DERIVATIVES_INDEX_PHYSICAL}`,
        `count:${DERIVATIVES_INDEX_PHYSICAL}`,
        `refresh:${KEYWORD_INDEX_PHYSICAL}`,
        `count:${KEYWORD_INDEX_PHYSICAL}`,
        `swap:${KEYWORD_INDEX}->${KEYWORD_INDEX_PHYSICAL}`,
        `swap:${VECTOR_INDEX}->${VECTOR_INDEX_PHYSICAL}`,
        `swap:${USER_UPLOADS_INDEX}->${USER_UPLOADS_INDEX_PHYSICAL}`,
        `swap:${DERIVATIVES_INDEX}->${DERIVATIVES_INDEX_PHYSICAL}`,
      ]);
    });

    it('aborts without deleting anything when the count check fails', async () => {
      verifiedCount = 0;

      await expect(run()).rejects.toThrow(/aborted before alias swap/);

      expect(calls.some((call) => call.startsWith('swap:'))).toBe(false);
      expect(calls.some((call) => call.startsWith('delete:'))).toBe(false);
      expect(openSearch.swapAlias).not.toHaveBeenCalled();
    });

    it('aborts when PostgreSQL yields no documents at all', async () => {
      prisma.legalDocument.findMany.mockReset();
      prisma.legalDocument.findMany.mockResolvedValue([]);
      verifiedCount = 0;

      await expect(run()).rejects.toThrow(/aborted before alias swap/);
      expect(openSearch.swapAlias).not.toHaveBeenCalled();
    });

    // The self-referential trap: a bulk pass that silently drops most payloads
    // leaves `pushed` and `verifiedCount` agreeing at a low number, so the
    // round-trip check passes. Only the source-derived floor catches it.
    it('aborts when far fewer entries are pushed than there are source documents', async () => {
      prisma.legalDocument.count.mockResolvedValue(17_135);
      pushedCount = 12; // bulk silently dropped the rest
      verifiedCount = 12; // ...and OpenSearch faithfully reports the same

      await expect(run()).rejects.toThrow(
        /only 12 entries were indexed for 17135 PostgreSQL documents/,
      );

      expect(calls.some((call) => call.startsWith('swap:'))).toBe(false);
      expect(openSearch.swapAlias).not.toHaveBeenCalled();
    });

    it('accepts a run where every document contributed at least one entry', async () => {
      prisma.legalDocument.count.mockResolvedValue(1);
      pushedCount = 2; // 1 doc-level entry + 1 section entry
      verifiedCount = 2;

      const { result } = await run();

      expect(result.aliasSwapped).toBe(true);
    });

    it('tolerates a shortfall inside the 1% window', async () => {
      prisma.legalDocument.count.mockResolvedValue(1);
      pushedCount = 1000;
      verifiedCount = 995;

      const { result } = await run();

      expect(result.aliasSwapped).toBe(true);
      expect(result.verifiedCount).toBe(995);
    });

    it('rejects a shortfall outside the 1% window', async () => {
      pushedCount = 1000;
      verifiedCount = 980;

      await expect(run()).rejects.toThrow(/aborted before alias swap/);
    });
  });

  describe('alias swap', () => {
    it('deletes the legacy concrete index in the same updateAliases call', async () => {
      // Production state: `legal_documents_keyword` exists as a real index and
      // is NOT an alias, so it must be removed atomically with the alias add.
      openSearch.indexExists.mockImplementation(async (name: string) =>
        [KEYWORD_INDEX, VECTOR_INDEX, USER_UPLOADS_INDEX].includes(name),
      );
      openSearch.aliasExists.mockResolvedValue(false);

      await run();

      expect(openSearch.swapAlias).toHaveBeenCalledWith({
        alias: KEYWORD_INDEX,
        target: KEYWORD_INDEX_PHYSICAL,
        removeConcreteIndex: true,
      });
      expect(openSearch.deleteIndex).not.toHaveBeenCalled();
    });

    it('detaches the previous physical index when the alias already exists', async () => {
      openSearch.aliasExists.mockImplementation(async (name: string) =>
        name === KEYWORD_INDEX,
      );
      openSearch.resolveAliasTargets.mockImplementation(async (name: string) =>
        name === KEYWORD_INDEX ? [`${KEYWORD_INDEX}_v1`] : [],
      );

      await run();

      expect(openSearch.swapAlias).toHaveBeenCalledWith({
        alias: KEYWORD_INDEX,
        target: KEYWORD_INDEX_PHYSICAL,
        detachFrom: [`${KEYWORD_INDEX}_v1`],
      });
    });

    it('allocates a suffixed name when the preferred physical index is taken', async () => {
      openSearch.indexExists.mockImplementation(async (name: string) =>
        name === KEYWORD_INDEX_PHYSICAL,
      );

      const { result } = await run();

      expect(result.keywordTarget).toBe(`${KEYWORD_INDEX_PHYSICAL}_r1`);
    });
  });

  describe('dry run', () => {
    it('builds and verifies but leaves every alias untouched', async () => {
      const { result } = await run(true);

      expect(result.aliasSwapped).toBe(false);
      expect(openSearch.swapAlias).not.toHaveBeenCalled();
      expect(calls).toContain(`count:${KEYWORD_INDEX_PHYSICAL}`);
    });
  });

  describe('copied index verification', () => {
    const sourceExists = () =>
      openSearch.indexExists.mockImplementation(async (name: string) =>
        [VECTOR_INDEX, USER_UPLOADS_INDEX].includes(name),
      );

    it('copies the existing vector index instead of re-embedding', async () => {
      sourceExists();

      await run();

      expect(openSearch.reindexInto).toHaveBeenCalledWith(
        VECTOR_INDEX,
        VECTOR_INDEX_PHYSICAL,
      );
    });

    // The production bug: `_reindex` returned created: 0 for a copy that landed
    // all 12,196 embeddings, and the job dutifully reported `vectorsCopied: 0`.
    // The reported number is now diagnostic only — the counts decide.
    it('reports the counted destination total, not the _reindex claim', async () => {
      sourceExists();
      copyCounts = { reportedCreated: 0, sourceCount: 12_196, destCount: 12_196 };

      const { result } = await run();

      expect(result.vectorsCopied).toBe(12_196);
      expect(result.vectorCopy).toMatchObject({
        status: 'verified',
        sourceCount: 12_196,
        destCount: 12_196,
        reportedCreated: 0,
      });
      expect(result.aliasesSkipped).toEqual([]);
    });

    // The other half: 0 used to mean both "copied fine" and "the copy threw and
    // was swallowed". These two cases must now be distinguishable.
    it('reports a missing source as source_missing, not as zero copied', async () => {
      openSearch.indexExists.mockResolvedValue(false);

      const { result } = await run();

      expect(result.vectorCopy).toMatchObject({
        status: 'source_missing',
        destCount: 0,
      });
      // Nothing to lose, so the fresh empty index may take the alias.
      expect(result.aliasesSkipped).toEqual([]);
    });

    it('reports a swallowed copy error as failed, not as zero copied', async () => {
      sourceExists();
      openSearch.reindexInto.mockRejectedValue(new Error('knn plugin missing'));

      const { result } = await run();

      expect(result.vectorCopy).toMatchObject({
        status: 'failed',
        destCount: 0,
        error: expect.stringContaining('knn plugin missing'),
      });
    });

    it('does not fail the whole rebuild when a copy errors', async () => {
      sourceExists();
      openSearch.reindexInto.mockRejectedValue(new Error('knn plugin missing'));

      const { result } = await run();

      // The keyword index is the one that fixes search — it still ships.
      expect(result.aliasSwapped).toBe(true);
      expect(
        calls.some((call) => call === `swap:${KEYWORD_INDEX}->${KEYWORD_INDEX_PHYSICAL}`),
      ).toBe(true);
    });

    it('leaves the alias on its old target when a copy cannot be verified', async () => {
      sourceExists();
      openSearch.reindexInto.mockRejectedValue(new Error('knn plugin missing'));

      const { result } = await run();

      expect(result.aliasesSkipped).toEqual([VECTOR_INDEX, USER_UPLOADS_INDEX]);
      expect(calls.some((call) => call.startsWith(`swap:${VECTOR_INDEX}->`))).toBe(false);
      expect(calls.some((call) => call.startsWith(`swap:${USER_UPLOADS_INDEX}->`))).toBe(
        false,
      );
    });

    // Swapping the alias here would point every kNN query at an index holding
    // 8% of the embeddings — degraded silently, exactly like the original bug.
    it('refuses to swap onto a short copy', async () => {
      sourceExists();
      copyCounts = { reportedCreated: 1_000, sourceCount: 12_196, destCount: 1_000 };

      const { result } = await run();

      expect(result.vectorCopy).toMatchObject({ status: 'mismatch', destCount: 1_000 });
      expect(result.aliasesSkipped).toContain(VECTOR_INDEX);
      expect(calls.some((call) => call.startsWith(`swap:${VECTOR_INDEX}->`))).toBe(false);
    });

    it('tolerates a shortfall inside the 1% window — the source takes live writes', async () => {
      sourceExists();
      copyCounts = { reportedCreated: null, sourceCount: 1_000, destCount: 995 };

      const { result } = await run();

      expect(result.vectorCopy).toMatchObject({ status: 'verified' });
      expect(result.aliasesSkipped).toEqual([]);
      expect(
        calls.some((call) => call.startsWith(`swap:${VECTOR_INDEX}->${VECTOR_INDEX_PHYSICAL}`)),
      ).toBe(true);
    });
  });

  describe('derivative ingestion', () => {
    /** The payload the service handed to `_bulk` for the first derivative. */
    const firstPayload = (): Record<string, unknown> => {
      const [docs] = openSearch.bulkIndexDerivatives.mock.calls[0] as [
        Record<string, unknown>[],
        string,
      ];
      return docs[0]!;
    };

    it('paginates by keyset, never OFFSET, and excludes soft-deleted rows', async () => {
      prisma.derivativeArtifact.findMany.mockReset();
      prisma.derivativeArtifact.findMany
        .mockResolvedValueOnce([buildDerivative('der-1'), buildDerivative('der-2')])
        .mockResolvedValueOnce([buildDerivative('der-3')])
        .mockResolvedValue([]);
      prisma.derivativeArtifact.count.mockResolvedValue(3);
      derivativeDestCount = 3;

      await run();

      const [first, second] = prisma.derivativeArtifact.findMany.mock.calls as [
        [Record<string, unknown>],
        [Record<string, unknown>],
      ];
      // No `skip` on the first page; cursor + skip:1 thereafter. `skip` as an
      // OFFSET (skip: n for page n) would be the anti-pattern.
      expect(first[0]['skip']).toBeUndefined();
      expect(first[0]['cursor']).toBeUndefined();
      expect(first[0]['orderBy']).toEqual({ id: 'asc' });
      expect(second[0]['cursor']).toEqual({ id: 'der-2' });
      expect(second[0]['skip']).toBe(1);

      for (const [args] of prisma.derivativeArtifact.findMany.mock.calls as [
        Record<string, unknown>,
      ][]) {
        expect(args['where']).toEqual({ deletedAt: null });
      }
      expect(prisma.derivativeArtifact.count).toHaveBeenCalledWith({
        where: { deletedAt: null },
      });
    });

    it('reads and writes in batches of 500 (CLAUDE.md bulk size)', async () => {
      await run();

      const [args] = prisma.derivativeArtifact.findMany.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(args['take']).toBe(500);

      const [, target] = openSearch.bulkIndexDerivatives.mock.calls[0] as [
        unknown[],
        string,
      ];
      expect(target).toBe(DERIVATIVES_INDEX_PHYSICAL);
    });

    it('restores the refresh interval even when the bulk write throws', async () => {
      openSearch.bulkIndexDerivatives.mockRejectedValue(
        new Error('strict_dynamic_mapping_exception: [rationale]'),
      );

      await run();

      expect(calls).toContain(`refreshInterval:${DERIVATIVES_INDEX_PHYSICAL}:30s`);
      expect(calls).toContain(`refreshInterval:${DERIVATIVES_INDEX_PHYSICAL}:5s`);
    });

    it('takes body text from the C1 extractor', async () => {
      await run();
      const payload = firstPayload();
      expect(payload['body_text']).toContain(
        'Petitioner challenges the validity of a warrantless search.',
      );
      expect(payload['body_text']).toContain('The Court held the search invalid.');
    });

    it('OMITS organization_id entirely when the row has none', async () => {
      await run();
      const payload = firstPayload();
      // Not null, not '', not a sentinel — the key must be absent, because the
      // public branch of the visibility filter is `must_not exists`.
      expect(Object.prototype.hasOwnProperty.call(payload, 'organization_id')).toBe(false);
    });

    it('sets organization_id when the row has one', async () => {
      prisma.derivativeArtifact.findMany.mockReset();
      prisma.derivativeArtifact.findMany
        .mockResolvedValueOnce([buildDerivative('der-1', { organizationId: 'org-a' })])
        .mockResolvedValue([]);

      await run();
      expect(firstPayload()['organization_id']).toBe('org-a');
    });

    it('derives is_published from publishedAt', async () => {
      prisma.derivativeArtifact.findMany.mockReset();
      prisma.derivativeArtifact.findMany
        .mockResolvedValueOnce([
          buildDerivative('der-1'),
          buildDerivative('der-2', { publishedAt: null }),
        ])
        .mockResolvedValue([]);
      prisma.derivativeArtifact.count.mockResolvedValue(2);
      derivativeDestCount = 2;

      await run();
      const [docs] = openSearch.bulkIndexDerivatives.mock.calls[0] as [
        Record<string, unknown>[],
        string,
      ];
      expect(docs[0]!['is_published']).toBe(true);
      expect(docs[1]!['is_published']).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(docs[1]!, 'published_at')).toBe(false);
    });

    it('reports verified counts measured on both sides', async () => {
      prisma.derivativeArtifact.count.mockResolvedValue(99_994);
      derivativeDestCount = 99_994;
      prisma.derivativeArtifact.findMany.mockReset();
      prisma.derivativeArtifact.findMany
        .mockResolvedValueOnce([buildDerivative('der-1')])
        .mockResolvedValue([]);

      const { result } = await run();

      expect(result.derivativeCopy).toMatchObject({
        source: 'postgres:derivative_artifacts',
        dest: DERIVATIVES_INDEX_PHYSICAL,
        status: 'verified',
        sourceCount: 99_994,
        destCount: 99_994,
      });
      expect(result.derivativesTotal).toBe(99_994);
      expect(result.aliasesSkipped).toEqual([]);
    });

    it('reports mismatch and does NOT swap the alias when the count is short', async () => {
      prisma.derivativeArtifact.count.mockResolvedValue(1_000);
      derivativeDestCount = 10;

      const { result } = await run();

      expect(result.derivativeCopy?.status).toBe('mismatch');
      expect(result.aliasesSkipped).toEqual([DERIVATIVES_INDEX]);
      expect(calls).not.toContain(
        `swap:${DERIVATIVES_INDEX}->${DERIVATIVES_INDEX_PHYSICAL}`,
      );
      // The keyword index still went live — a derivative failure must not
      // block the index that actually fixes search.
      expect(calls).toContain(`swap:${KEYWORD_INDEX}->${KEYWORD_INDEX_PHYSICAL}`);
      expect(result.aliasSwapped).toBe(true);
    });

    it('treats a per-item bulk rejection as failure, not as partial success', async () => {
      openSearch.bulkIndexDerivatives.mockRejectedValue(
        new Error('rejected 1 of 500 derivative(s): strict_dynamic_mapping_exception'),
      );

      const { result } = await run();

      expect(result.derivativeCopy?.status).toBe('failed');
      expect(result.derivativeCopy?.error).toMatch(/strict_dynamic_mapping_exception/);
      expect(result.aliasesSkipped).toEqual([DERIVATIVES_INDEX]);
      expect(calls).not.toContain(
        `swap:${DERIVATIVES_INDEX}->${DERIVATIVES_INDEX_PHYSICAL}`,
      );
    });

    it('reports source_missing rather than mismatch when there are no rows', async () => {
      prisma.derivativeArtifact.count.mockResolvedValue(0);
      prisma.derivativeArtifact.findMany.mockReset();
      prisma.derivativeArtifact.findMany.mockResolvedValue([]);

      const { result } = await run();

      expect(result.derivativeCopy?.status).toBe('source_missing');
      // source_missing is a legitimate empty, so the alias DOES swap.
      expect(result.aliasesSkipped).toEqual([]);
      expect(calls).toContain(`swap:${DERIVATIVES_INDEX}->${DERIVATIVES_INDEX_PHYSICAL}`);
    });

    it('streams derivative progress alongside the document counters', async () => {
      const { progress } = await run();
      const derivativePhase = progress.filter(
        (entry) => entry.phase === 'reindexing_derivatives',
      );
      expect(derivativePhase.length).toBeGreaterThan(0);

      const last = progress[progress.length - 1]!;
      expect(last.derivativesTotal).toBe(1);
      expect(last.derivativesProcessed).toBe(1);
      expect(last.derivativesPushed).toBe(1);
      // The pre-existing counters are still reported.
      expect(last.documentsTotal).toBe(1);
      expect(last.docsPushed).toBe(2);
    });
  });

  describe('rollbackAlias', () => {
    it('rejects an alias outside the known topology', async () => {
      await expect(service.rollbackAlias('some_other_index', 'x_v1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a target that does not exist', async () => {
      openSearch.indexExists.mockResolvedValue(false);
      await expect(
        service.rollbackAlias(KEYWORD_INDEX, `${KEYWORD_INDEX}_v1`),
      ).rejects.toThrow(/does not exist/);
    });

    it('rejects a target that is itself an alias', async () => {
      openSearch.indexExists.mockResolvedValue(true);
      openSearch.aliasExists.mockResolvedValue(true);
      await expect(
        service.rollbackAlias(KEYWORD_INDEX, `${KEYWORD_INDEX}_v1`),
      ).rejects.toThrow(/is an alias, not a physical index/);
    });

    it('repoints the alias and reports the previous target', async () => {
      openSearch.indexExists.mockResolvedValue(true);
      openSearch.aliasExists.mockResolvedValue(false);
      openSearch.resolveAliasTargets.mockResolvedValue([KEYWORD_INDEX_PHYSICAL]);

      const result = await service.rollbackAlias(KEYWORD_INDEX, `${KEYWORD_INDEX}_v1`);

      expect(result.previousTargets).toEqual([KEYWORD_INDEX_PHYSICAL]);
      expect(openSearch.swapAlias).toHaveBeenCalledWith({
        alias: KEYWORD_INDEX,
        target: `${KEYWORD_INDEX}_v1`,
        detachFrom: [KEYWORD_INDEX_PHYSICAL],
      });
    });
  });

  describe('enqueueRebuild', () => {
    it('returns the BullMQ job id', async () => {
      queue.add.mockResolvedValue({ id: 'job-42' });

      await expect(
        service.enqueueRebuild({
          triggeredByUserId: 'u',
          organizationId: 'o',
          dryRun: false,
        }),
      ).resolves.toEqual({ jobId: 'job-42' });
    });

    it('throws when BullMQ returns a job without an id', async () => {
      queue.add.mockResolvedValue({});

      await expect(
        service.enqueueRebuild({
          triggeredByUserId: 'u',
          organizationId: 'o',
          dryRun: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

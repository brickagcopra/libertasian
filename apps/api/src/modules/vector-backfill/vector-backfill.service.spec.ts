import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingClientService } from '../search/embedding-client.service';
import { OpenSearchService } from '../search/opensearch.service';
import { FAILURE_REASONS, SKIP_REASONS, VECTOR_BACKFILL_QUEUE } from './vector-backfill.constants';
import {
  VectorBackfillService,
  type VectorBackfillProgress,
} from './vector-backfill.service';

/**
 * A stand-in for the OpenSearch vector index: a set of `_id`s that already
 * exist, plus a record of everything written to it. The interesting properties
 * of this job are all statements about that set — what it is diffed against,
 * what gets added to it, and what a second run does once it is partly full.
 */
class FakeVectorIndex {
  readonly ids = new Set<string>();
  readonly writes: string[][] = [];
  /** Ids the next bulk call should reject, simulating a mapping error. */
  rejectIds = new Set<string>();
  /** When set, the next bulk call throws instead of returning. */
  throwOnce: Error | null = null;

  findExistingVectorIds = jest.fn(async (ids: readonly string[]) => {
    return new Set(ids.filter((id) => this.ids.has(id)));
  });

  bulkIndexVectorDocuments = jest.fn(
    async (docs: { document_id: string; section_id?: string }[]) => {
      if (this.throwOnce) {
        const err = this.throwOnce;
        this.throwOnce = null;
        throw err;
      }
      const written: string[] = [];
      const failedIds: string[] = [];
      for (const doc of docs) {
        const id = doc.section_id ?? doc.document_id;
        if (this.rejectIds.has(id)) {
          failedIds.push(id);
          continue;
        }
        this.ids.add(id);
        written.push(id);
      }
      this.writes.push(written);
      return {
        indexed: written.length,
        errors: failedIds.length,
        failedIds,
        ...(failedIds.length > 0 ? { firstErrorReason: 'mapper_parsing_exception' } : {}),
      };
    },
  );
}

interface SeedDocument {
  id: string;
  documentType: string;
  title?: string;
  decisionDate?: Date | null;
  createdAt?: Date;
  sections: { id: string; plainText: string | null }[];
}

/** The subset of Prisma call shapes the service actually uses. */
interface FakeArgs {
  where?: {
    id?: string | { in?: string[] };
    documentType?: { in?: string[]; notIn?: string[] };
    status?: { in?: string[] };
  };
  data?: Record<string, unknown> | Record<string, unknown>[];
}

/** A `vector_backfill_runs` row, loose enough to accept partial seeds. */
interface FakeRunRow {
  id: string;
  status: string;
  dryRun: boolean;
  documentTypes: string[];
  batchSize: number;
  batchDelayMs: number;
  maxDocuments: number | null;
  controlSignal: string | null;
  jobId: string | null;
  createdAt: Date;
  [extra: string]: unknown;
}

/** A `vector_backfill_document_status` row. */
interface FakeStatusRow {
  runId: string;
  legalDocumentId: string;
  documentType: string;
  status: string;
  reason: string | null;
  chunksAttempted: number;
  chunksIndexed: number;
  chunksFailed: number;
}

/**
 * A Prisma stand-in backed by plain arrays. Enough of `legalDocument`,
 * `vectorBackfillRun` and `vectorBackfillDocumentStatus` to run the job
 * end-to-end without a database.
 */
class FakePrisma {
  documents: SeedDocument[] = [];
  runs: FakeRunRow[] = [];
  statuses: FakeStatusRow[] = [];
  private runSeq = 0;

  legalDocument = {
    findMany: jest.fn(async (args: FakeArgs) => {
      const where = args?.where ?? {};
      let rows = this.documents;
      const idIn = typeof where.id === 'object' ? where.id?.in : undefined;
      if (idIn) rows = rows.filter((d) => idIn.includes(d.id));
      const typeIn = where.documentType?.in;
      if (typeIn) rows = rows.filter((d) => typeIn.includes(d.documentType));
      const typeNotIn = where.documentType?.notIn;
      if (typeNotIn) rows = rows.filter((d) => !typeNotIn.includes(d.documentType));
      return rows.map((d) => ({
        id: d.id,
        title: d.title ?? `Document ${d.id}`,
        citationText: null,
        documentType: d.documentType,
        court: null,
        isOfficial: true,
        isPublished: true,
        decisionDate: d.decisionDate ?? null,
        promulgationDate: null,
        createdAt: d.createdAt ?? new Date('2020-01-01'),
        source: { trustLevel: 'official' },
        sections: d.sections,
      }));
    }),
  };

  vectorBackfillRun = {
    findFirst: jest.fn(async (args: FakeArgs) => {
      const statuses = args?.where?.status?.in ?? [];
      return this.runs.find((r) => statuses.includes(r.status)) ?? null;
    }),
    findUnique: jest.fn(async (args: FakeArgs) => {
      return this.runs.find((r) => r.id === args.where?.id) ?? null;
    }),
    findMany: jest.fn(async () => [...this.runs].reverse()),
    create: jest.fn(async (args: FakeArgs) => {
      const row: FakeRunRow = {
        id: `run-${++this.runSeq}`,
        status: 'queued',
        jobId: null,
        documentTypes: [],
        batchSize: 64,
        batchDelayMs: 0,
        maxDocuments: null,
        dryRun: false,
        controlSignal: null,
        createdAt: new Date(),
        ...(args.data as Record<string, unknown>),
      };
      this.runs.push(row);
      return row;
    }),
    update: jest.fn(async (args: FakeArgs) => {
      const row = this.runs.find((r) => r.id === args.where?.id);
      if (!row) throw new Error(`no run ${String(args.where?.id)}`);
      Object.assign(row, args.data);
      return row;
    }),
  };

  vectorBackfillDocumentStatus = {
    createMany: jest.fn(async (args: FakeArgs) => {
      const rows = args.data as unknown as FakeStatusRow[];
      this.statuses.push(...rows);
      return { count: rows.length };
    }),
    findMany: jest.fn(async () => []),
  };
}

const NOOP_REPORT = async (_progress: VectorBackfillProgress) => {};

/** A section long enough to clear the 50-character minimum. */
const body = (n: number) => 'The provision reads as follows. '.repeat(n);

describe('VectorBackfillService', () => {
  let service: VectorBackfillService;
  let prisma: FakePrisma;
  let index: FakeVectorIndex;
  let embed: { embedBatch: jest.Mock };
  let queue: { add: jest.Mock; getJob: jest.Mock };

  beforeEach(async () => {
    prisma = new FakePrisma();
    index = new FakeVectorIndex();
    embed = {
      embedBatch: jest.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
    };
    queue = {
      add: jest.fn(async () => ({ id: 'job-1' })),
      getJob: jest.fn(async () => null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VectorBackfillService,
        { provide: PrismaService, useValue: prisma },
        { provide: OpenSearchService, useValue: index },
        { provide: EmbeddingClientService, useValue: embed },
        { provide: getQueueToken(VECTOR_BACKFILL_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get(VectorBackfillService);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  // -------------------------------------------------------------------
  // Gap enumeration
  // -------------------------------------------------------------------

  describe('gap enumeration', () => {
    it('returns only the ids the vector index does not already hold', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'codal',
          sections: [
            { id: 'sec-a', plainText: body(3) },
            { id: 'sec-b', plainText: body(3) },
            { id: 'sec-c', plainText: body(3) },
          ],
        },
      ];
      // The document-level vector and one section are already indexed.
      index.ids.add('doc-1');
      index.ids.add('sec-b');

      const [gap] = await service.computeGapForDocuments(['doc-1']);

      expect(gap!.expected).toBe(4); // doc-level + 3 sections
      expect(gap!.missing.map((m) => m.sectionId ?? m.documentId)).toEqual([
        'sec-a',
        'sec-c',
      ]);
    });

    it('reports no gap when every chunk is present', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'codal',
          sections: [{ id: 'sec-a', plainText: body(3) }],
        },
      ];
      index.ids.add('doc-1');
      index.ids.add('sec-a');

      const [gap] = await service.computeGapForDocuments(['doc-1']);
      expect(gap!.missing).toEqual([]);
    });

    it('excludes a section under 50 characters from the gap entirely', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'codal',
          sections: [
            { id: 'sec-short', plainText: 'Article 1.' },
            { id: 'sec-long', plainText: body(3) },
          ],
        },
      ];

      const [gap] = await service.computeGapForDocuments(['doc-1']);
      const ids = gap!.missing.map((m) => m.sectionId ?? m.documentId);

      expect(ids).toContain('sec-long');
      expect(ids).not.toContain('sec-short');
      // A short section is never "missing" — it was never supposed to be there,
      // so it must not sit in the gap report inflating the work estimate for ever.
      expect(gap!.expected).toBe(2);
    });

    it('preserves the caller ordering so priority documents stay first', async () => {
      prisma.documents = [
        { id: 'doc-b', documentType: 'codal', sections: [{ id: 's-b', plainText: body(3) }] },
        { id: 'doc-a', documentType: 'codal', sections: [{ id: 's-a', plainText: body(3) }] },
      ];

      const gaps = await service.computeGapForDocuments(['doc-a', 'doc-b']);
      expect(gaps.map((g) => g.documentId)).toEqual(['doc-a', 'doc-b']);
    });

    it('aggregates the gap per document type', async () => {
      prisma.documents = [
        {
          id: 'doc-codal',
          documentType: 'codal',
          sections: [{ id: 'sc-1', plainText: body(3) }],
        },
        {
          id: 'doc-decision',
          documentType: 'decision',
          sections: [{ id: 'sd-1', plainText: body(3) }],
        },
      ];
      index.ids.add('doc-decision');
      index.ids.add('sd-1');

      const report = await service.enumerateGap();

      expect(report.documentsScanned).toBe(2);
      expect(report.documentsWithGap).toBe(1);
      expect(report.byType['codal']).toMatchObject({
        documents: 1,
        documentsWithGap: 1,
        missingChunks: 2,
      });
      expect(report.byType['decision']).toMatchObject({
        documents: 1,
        documentsWithGap: 0,
        missingChunks: 0,
      });
    });
  });

  // -------------------------------------------------------------------
  // Ordering
  // -------------------------------------------------------------------

  describe('enumerateDocumentOrder', () => {
    it('puts the statutory types first, in the declared priority order', async () => {
      prisma.documents = [
        { id: 'd-decision', documentType: 'decision', sections: [] },
        { id: 'd-codal', documentType: 'codal', sections: [] },
        { id: 'd-const', documentType: 'constitution', sections: [] },
        { id: 'd-ra', documentType: 'republic_act', sections: [] },
      ];

      const order = await service.enumerateDocumentOrder();

      expect(order.map((o) => o.documentType)).toEqual([
        'constitution',
        'codal',
        'republic_act',
        'decision',
      ]);
    });

    it('orders the non-priority tail by recency, newest first', async () => {
      prisma.documents = [
        {
          id: 'old',
          documentType: 'decision',
          decisionDate: new Date('2001-01-01'),
          sections: [],
        },
        {
          id: 'new',
          documentType: 'decision',
          decisionDate: new Date('2024-01-01'),
          sections: [],
        },
      ];

      const order = await service.enumerateDocumentOrder();
      expect(order.map((o) => o.documentId)).toEqual(['new', 'old']);
    });

    it('still reaches a document type nobody listed', async () => {
      prisma.documents = [
        { id: 'd-am', documentType: 'administrative_matter', sections: [] },
      ];
      const order = await service.enumerateDocumentOrder();
      expect(order.map((o) => o.documentId)).toEqual(['d-am']);
    });

    it('honours a document-type restriction', async () => {
      prisma.documents = [
        { id: 'd-codal', documentType: 'codal', sections: [] },
        { id: 'd-decision', documentType: 'decision', sections: [] },
      ];
      const order = await service.enumerateDocumentOrder(['codal']);
      expect(order.map((o) => o.documentId)).toEqual(['d-codal']);
    });
  });

  // -------------------------------------------------------------------
  // The run
  // -------------------------------------------------------------------

  describe('runBackfill', () => {
    const seedRun = async (overrides: Record<string, unknown> = {}) => {
      const run = await prisma.vectorBackfillRun.create({
        data: { status: 'queued', dryRun: false, batchSize: 2, batchDelayMs: 0, ...overrides },
      });
      return run['id'] as string;
    };

    it('embeds only the missing chunks and records each document as indexed', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'codal',
          sections: [
            { id: 'sec-a', plainText: body(3) },
            { id: 'sec-b', plainText: body(3) },
          ],
        },
      ];
      index.ids.add('sec-a'); // already indexed

      const runId = await seedRun();
      const result = await service.runBackfill({ runId }, NOOP_REPORT);

      expect(result.status).toBe('completed');
      expect(result.chunksIndexed).toBe(2); // doc-level + sec-b
      expect(result.documentsIndexed).toBe(1);
      expect(index.ids.has('doc-1')).toBe(true);
      expect(index.ids.has('sec-b')).toBe(true);

      const [status] = prisma.statuses;
      expect(status).toMatchObject({
        legalDocumentId: 'doc-1',
        status: 'indexed',
        chunksAttempted: 2,
        chunksIndexed: 2,
        chunksFailed: 0,
        reason: null,
      });
    });

    it('records a fully-indexed document as skipped: already_indexed', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'codal',
          sections: [{ id: 'sec-a', plainText: body(3) }],
        },
      ];
      index.ids.add('doc-1');
      index.ids.add('sec-a');

      const runId = await seedRun();
      const result = await service.runBackfill({ runId }, NOOP_REPORT);

      expect(result.documentsSkipped).toBe(1);
      expect(embed.embedBatch).not.toHaveBeenCalled();
      expect(prisma.statuses[0]).toMatchObject({
        status: 'skipped',
        reason: SKIP_REASONS.ALREADY_INDEXED,
      });
    });

    it('records a document with only sub-50-character sections as skipped with a reason', async () => {
      prisma.documents = [
        {
          id: 'doc-empty',
          documentType: 'codal',
          sections: [
            { id: 'sec-null', plainText: null },
            { id: 'sec-blank', plainText: '' },
          ],
        },
      ];

      const runId = await seedRun();
      const result = await service.runBackfill({ runId }, NOOP_REPORT);

      expect(result.documentsSkipped).toBe(1);
      expect(prisma.statuses[0]).toMatchObject({
        status: 'skipped',
        reason: SKIP_REASONS.NO_EMBEDDABLE_TEXT,
      });
    });

    it('records a batch failure with its reason and keeps going', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'codal',
          sections: [{ id: 'sec-a', plainText: body(3) }],
        },
        {
          id: 'doc-2',
          documentType: 'codal',
          sections: [{ id: 'sec-b', plainText: body(3) }],
        },
      ];

      // The embedding service fails for the first batch only.
      embed.embedBatch
        .mockImplementationOnce(async () => null)
        .mockImplementation(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));

      const runId = await seedRun({ batchSize: 2 });
      const result = await service.runBackfill({ runId }, NOOP_REPORT);

      // The run finished — it did not abort on the failed batch.
      expect(result.status).toBe('completed');
      expect(result.batchesFailed).toBe(1);
      expect(result.batchesCompleted).toBeGreaterThan(0);
      expect(result.documentsFailed).toBe(1);
      expect(result.documentsIndexed).toBe(1);

      const failed = prisma.statuses.find((s) => s['status'] === 'failed');
      expect(failed!['reason']).toContain(FAILURE_REASONS.EMBEDDING_UNAVAILABLE);

      const indexed = prisma.statuses.find((s) => s['status'] === 'indexed');
      expect(indexed!['legalDocumentId']).toBe('doc-2');
    });

    it('attributes a per-item OpenSearch rejection to the document that owned the chunk', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'codal',
          sections: [{ id: 'sec-a', plainText: body(3) }],
        },
      ];
      index.rejectIds.add('sec-a');

      const runId = await seedRun({ batchSize: 8 });
      const result = await service.runBackfill({ runId }, NOOP_REPORT);

      expect(result.status).toBe('completed');
      expect(result.chunksIndexed).toBe(1); // doc-level landed
      expect(result.chunksFailed).toBe(1); // sec-a did not
      expect(prisma.statuses[0]).toMatchObject({
        status: 'failed',
        chunksIndexed: 1,
        chunksFailed: 1,
      });
      expect(prisma.statuses[0]!['reason']).toContain(FAILURE_REASONS.BULK_INDEX_ERROR);
    });

    it('survives a bulk call that throws', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'codal',
          sections: [{ id: 'sec-a', plainText: body(3) }],
        },
      ];
      index.throwOnce = new Error('connect ECONNREFUSED');

      const runId = await seedRun({ batchSize: 8 });
      const result = await service.runBackfill({ runId }, NOOP_REPORT);

      expect(result.status).toBe('completed');
      expect(result.documentsFailed).toBe(1);
      expect(prisma.statuses[0]!['reason']).toContain('connect ECONNREFUSED');
    });

    it('is resumable: a second run over a partly filled index does only the remainder', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'codal',
          sections: [
            { id: 'sec-a', plainText: body(3) },
            { id: 'sec-b', plainText: body(3) },
          ],
        },
        {
          id: 'doc-2',
          documentType: 'codal',
          sections: [{ id: 'sec-c', plainText: body(3) }],
        },
      ];

      // First run: doc-2's chunks are rejected, so they stay missing.
      index.rejectIds.add('doc-2');
      index.rejectIds.add('sec-c');

      const firstRunId = await seedRun({ batchSize: 8 });
      const first = await service.runBackfill({ runId: firstRunId }, NOOP_REPORT);
      expect(first.chunksIndexed).toBe(3); // doc-1 + sec-a + sec-b
      expect(first.chunksFailed).toBe(2); // doc-2 + sec-c

      // Second run over the same corpus, with OpenSearch healthy again.
      index.rejectIds.clear();
      embed.embedBatch.mockClear();

      const secondRunId = await seedRun({ batchSize: 8 });
      const second = await service.runBackfill({ runId: secondRunId }, NOOP_REPORT);

      // Only doc-2's two chunks were embedded — doc-1 was diffed out.
      const embeddedTexts = embed.embedBatch.mock.calls.flatMap((call) => call[0] as string[]);
      expect(embeddedTexts).toHaveLength(2);
      expect(second.chunksIndexed).toBe(2);
      expect(second.documentsIndexed).toBe(1);

      const secondStatuses = prisma.statuses.filter((s) => s['runId'] === secondRunId);
      expect(
        secondStatuses.find((s) => s['legalDocumentId'] === 'doc-1'),
      ).toMatchObject({ status: 'skipped', reason: SKIP_REASONS.ALREADY_INDEXED });
      expect(
        secondStatuses.find((s) => s['legalDocumentId'] === 'doc-2'),
      ).toMatchObject({ status: 'indexed' });
    });

    it('a third run over a fully filled index embeds nothing at all', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'codal',
          sections: [{ id: 'sec-a', plainText: body(3) }],
        },
      ];

      await service.runBackfill({ runId: await seedRun() }, NOOP_REPORT);
      embed.embedBatch.mockClear();

      const result = await service.runBackfill({ runId: await seedRun() }, NOOP_REPORT);
      expect(embed.embedBatch).not.toHaveBeenCalled();
      expect(result.chunksIndexed).toBe(0);
      expect(result.documentsSkipped).toBe(1);
    });

    it('a dry run measures the gap and embeds nothing', async () => {
      prisma.documents = [
        {
          id: 'doc-1',
          documentType: 'constitution',
          sections: [{ id: 'sec-a', plainText: body(3) }],
        },
      ];

      const runId = await seedRun({ dryRun: true });
      const result = await service.runBackfill({ runId }, NOOP_REPORT);

      expect(embed.embedBatch).not.toHaveBeenCalled();
      expect(index.bulkIndexVectorDocuments).not.toHaveBeenCalled();
      expect(result.chunksIndexed).toBe(0);
      expect(result.gapByType['constitution']).toMatchObject({ missingChunks: 2 });
      expect(prisma.statuses[0]).toMatchObject({
        status: 'skipped',
        reason: SKIP_REASONS.DRY_RUN,
        chunksAttempted: 2,
      });
    });

    it('stops between batches when an operator pauses, and reports paused', async () => {
      prisma.documents = Array.from({ length: 6 }, (_, i) => ({
        id: `doc-${i}`,
        documentType: 'codal',
        sections: [{ id: `sec-${i}`, plainText: body(3) }],
      }));

      const runId = await seedRun({ batchSize: 2 });
      // Arm the pause as soon as the run marks itself running.
      const originalUpdate = prisma.vectorBackfillRun.update.getMockImplementation()!;
      let batchUpdates = 0;
      prisma.vectorBackfillRun.update.mockImplementation(async (args: FakeArgs) => {
        const row = (await originalUpdate(args)) as FakeRunRow;
        const data = args.data as Record<string, unknown> | undefined;
        if (data?.['batchesCompleted'] !== undefined && ++batchUpdates === 1) {
          row.controlSignal = 'pause';
        }
        return row;
      });

      const result = await service.runBackfill({ runId }, NOOP_REPORT);

      expect(result.status).toBe('paused');
      expect(result.documentsProcessed).toBeLessThan(6);
      // Whatever it did embed is still recorded, not thrown away.
      expect(result.chunksIndexed).toBeGreaterThan(0);
    });

    it('honours maxDocuments', async () => {
      prisma.documents = Array.from({ length: 5 }, (_, i) => ({
        id: `doc-${i}`,
        documentType: 'codal',
        sections: [{ id: `sec-${i}`, plainText: body(3) }],
      }));

      const runId = await seedRun({ maxDocuments: 2 });
      const result = await service.runBackfill({ runId }, NOOP_REPORT);

      expect(result.documentsTotal).toBe(2);
      expect(result.documentsProcessed).toBe(2);
    });

    it('throws when the run row does not exist', async () => {
      await expect(
        service.runBackfill({ runId: 'nope' }, NOOP_REPORT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------
  // Enqueue / control
  // -------------------------------------------------------------------

  describe('enqueueRun', () => {
    it('creates a run and enqueues its job', async () => {
      const run = await service.enqueueRun({ batchSize: 32, triggeredByUserId: 'user-1' });

      expect(run.jobId).toBe('job-1');
      expect(queue.add).toHaveBeenCalledWith(
        'backfill',
        expect.objectContaining({ runId: run.id, triggeredByUserId: 'user-1' }),
        expect.objectContaining({ attempts: 1 }),
      );
    });

    it('refuses while another run is queued or running', async () => {
      await service.enqueueRun({});
      await expect(service.enqueueRun({})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('clamps an out-of-range batch size and delay instead of trusting the caller', async () => {
      const run = await service.enqueueRun({ batchSize: 100_000, batchDelayMs: -5 });
      expect(run.batchSize).toBe(256);
      expect(run.batchDelayMs).toBe(0);
    });

    it('defaults the batch size to the measured-throughput value', async () => {
      const run = await service.enqueueRun({});
      expect(run.batchSize).toBe(64);
    });
  });

  describe('signal', () => {
    it('sets the control signal a running job polls for', async () => {
      const run = await service.enqueueRun({});
      await prisma.vectorBackfillRun.update({
        where: { id: run.id },
        data: { status: 'running' },
      });

      const updated = await service.signal(run.id, 'pause');
      expect(updated['controlSignal']).toBe('pause');
    });

    it('refuses to signal a finished run', async () => {
      const run = await service.enqueueRun({});
      await prisma.vectorBackfillRun.update({
        where: { id: run.id },
        data: { status: 'completed' },
      });

      await expect(service.signal(run.id, 'pause')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404s on an unknown run', async () => {
      await expect(service.signal('nope', 'cancel')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('resume', () => {
    it('starts a new run carrying the stopped run\'s options', async () => {
      const first = await service.enqueueRun({
        batchSize: 16,
        batchDelayMs: 250,
        documentTypes: ['codal'],
      });
      await prisma.vectorBackfillRun.update({
        where: { id: first.id },
        data: { status: 'paused' },
      });

      const second = await service.resume(first.id, { userId: 'user-2' });

      expect(second.id).not.toBe(first.id);
      expect(second.batchSize).toBe(16);
      expect(second.batchDelayMs).toBe(250);
      expect(second.documentTypes).toEqual(['codal']);
    });

    it('refuses to resume a run that is still active', async () => {
      const run = await service.enqueueRun({});
      await expect(service.resume(run.id, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});

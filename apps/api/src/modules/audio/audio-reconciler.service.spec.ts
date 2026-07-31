import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { statfs } from 'fs/promises';

import { PrismaService } from '../../prisma/prisma.service';
import { AudioReconcilerService } from './audio-reconciler.service';
import { AudioRenditionService } from './audio-rendition.service';
import { AudioStorageService } from './audio-storage.service';

// Mocked so the disk guard is deterministic. Without this the suite reads the
// real filesystem and its behaviour depends on the machine it runs on.
jest.mock('fs/promises', () => ({ statfs: jest.fn() }));
const statfsMock = statfs as unknown as jest.Mock;

const GB = 1024 ** 3;
/** statfs result for a volume with `gb` free (bsize 4096). */
const freeSpace = (gb: number) => ({ bavail: (gb * GB) / 4096, bsize: 4096 });

/**
 * Queues a scripted sequence of $queryRaw results. The reconciler issues, in
 * order: the cumulative-volume query, then per enabled tier a COUNT followed
 * by an id list.
 */
function build(
  env: Record<string, string>,
  results: unknown[][],
  /** Storage location. Local (the default) is what every environment runs. */
  isRemote = false,
  /** Rows `audioRendition.findMany` returns — the permanently-refused lookup. */
  failedRows: Array<{ contentId: string; failureReason: string | null }> = [],
) {
  const queryRaw = jest.fn();
  results.forEach((rows) => queryRaw.mockResolvedValueOnce(rows));
  queryRaw.mockResolvedValue([]);

  const findMany = jest.fn().mockResolvedValue(failedRows);
  const prisma = { $queryRaw: queryRaw, audioRendition: { findMany } };
  // The reconciler no longer touches the queue: it enqueues through the single
  // path on AudioRenditionService, so the job id and retry policy cannot drift
  // from what the on-demand read path produces.
  const renditions = {
    voiceId: 'af_heart',
    requestGeneration: jest.fn().mockResolvedValue(undefined),
  };
  const storage = { isRemote };
  const config = {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as unknown as ConfigService;

  const service = new AudioReconcilerService(
    prisma as unknown as PrismaService,
    renditions as unknown as AudioRenditionService,
    storage as unknown as AudioStorageService,
    config,
  );
  return { service, renditions, queryRaw, findMany };
}

/** contentIds handed to requestGeneration, in enqueue order. */
const enqueuedIds = (renditions: { requestGeneration: jest.Mock }): string[] =>
  renditions.requestGeneration.mock.calls.map((call) => call[1] as string);

/** contentId → priority, as passed to requestGeneration. */
const enqueuedPriorities = (renditions: {
  requestGeneration: jest.Mock;
}): Map<string, number> =>
  new Map(
    renditions.requestGeneration.mock.calls.map((call) => [
      call[1] as string,
      call[4] as number,
    ]),
  );

const VOLUME = [{ count: 0n, duration_ms: 0n }];
// $queryRaw results are scripted POSITIONALLY, in the TIERS array order:
// volume, then a COUNT + id list per enabled tier — 1 (digests), 2 (codals),
// 4 (statutory sections), 3 (decisions). Tier 4 sits before tier 3 so 4,857
// sections are not queued behind a 15,464-document decision backfill.
const ON = { AUDIO_RECONCILER_ENABLED: 'true' };
const ON_WITH_DECISIONS = {
  AUDIO_RECONCILER_ENABLED: 'true',
  AUDIO_RECONCILE_DECISIONS: 'true',
};

describe('AudioReconcilerService', () => {
  beforeEach(() => {
    // Healthy volume by default; individual tests override.
    statfsMock.mockReset();
    statfsMock.mockResolvedValue(freeSpace(100));
  });

  it('does nothing when the reconciler flag is false', async () => {
    const { service, renditions, queryRaw } = build({}, []);
    await service.reconcile();
    expect(renditions.requestGeneration).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('skips tier 3 when only AUDIO_RECONCILER_ENABLED is true', async () => {
    const { service, renditions } = build(ON, [
      VOLUME,
      [{ count: 1n }], // tier 1 count
      [{ id: 'digest-1' }], // tier 1 ids
      [{ count: 1n }], // tier 2 count
      [{ id: 'codal-1' }], // tier 2 ids
    ]);

    await service.reconcile();

    const enqueued = enqueuedIds(renditions);
    expect(enqueued).toEqual(['digest-1', 'codal-1']);
  });

  it('enqueues tier 3 only when BOTH flags are true', async () => {
    const { service, renditions } = build(ON_WITH_DECISIONS, [
      VOLUME,
      [{ count: 0n }],
      [],
      [{ count: 0n }],
      [],
      [{ count: 0n }], // tier 4 runs BEFORE tier 3 (see the TIERS array)
      [],
      [{ count: 1n }],
      [{ id: 'decision-1' }],
    ]);

    await service.reconcile();

    expect(renditions.requestGeneration).toHaveBeenCalledWith(
      'legal_document',
      'decision-1',
      'en',
      false,
      10,
    );
  });

  it('gives tier 3 a lower priority than tier 1 so a backfill cannot starve it', async () => {
    const { service, renditions } = build(ON_WITH_DECISIONS, [
      VOLUME,
      [{ count: 1n }],
      [{ id: 'digest-1' }],
      [{ count: 0n }],
      [],
      [{ count: 0n }], // tier 4
      [],
      [{ count: 1n }],
      [{ id: 'decision-1' }],
    ]);

    await service.reconcile();

    const priorities = enqueuedPriorities(renditions);
    expect(priorities.get('digest-1')).toBeDefined();
    expect(priorities.get('decision-1')).toBeDefined();
    expect(priorities.get('digest-1') as number).toBeLessThan(
      priorities.get('decision-1') as number,
    );
  });

  it('caps total enqueues at AUDIO_RECONCILE_BATCH per tick', async () => {
    const { service, renditions } = build({ ...ON, AUDIO_RECONCILE_BATCH: '2' }, [
      VOLUME,
      [{ count: 3n }],
      [{ id: 'a' }, { id: 'b' }],
      [{ count: 5n }],
      [],
    ]);

    await service.reconcile();

    expect(renditions.requestGeneration).toHaveBeenCalledTimes(2);
  });

  describe('disk guard', () => {
    it('enqueues nothing when free disk is measured and below the threshold', async () => {
      statfsMock.mockResolvedValue(freeSpace(5));
      const { service, renditions, queryRaw } = build(ON_WITH_DECISIONS, [VOLUME]);

      await service.reconcile();

      expect(renditions.requestGeneration).not.toHaveBeenCalled();
      // Bails before even the cumulative-volume query.
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('refuses ONLY tier 3 when free disk cannot be measured', async () => {
      statfsMock.mockRejectedValue(new Error('ENOSYS'));
      const { service, renditions } = build(ON_WITH_DECISIONS, [
        VOLUME,
        [{ count: 1n }], // tier 1 count
        [{ id: 'digest-1' }], // tier 1 ids
        [{ count: 1n }], // tier 2 count
        [{ id: 'codal-1' }], // tier 2 ids
      ]);

      await service.reconcile();

      const enqueued = enqueuedIds(renditions);
      // Tiers 1-2 need ~12 GB and proceed; tier 3 is the case the guard exists for.
      expect(enqueued).toContain('digest-1');
      expect(enqueued).toContain('codal-1');
      expect(enqueued).not.toContain('decision-1');
    });

    it('still enqueues tier 3 when free disk is measured and healthy', async () => {
      statfsMock.mockResolvedValue(freeSpace(200));
      const { service, renditions } = build(ON_WITH_DECISIONS, [
        VOLUME,
        [{ count: 0n }],
        [],
        [{ count: 0n }],
        [],
        [{ count: 0n }], // tier 4
        [],
        [{ count: 1n }],
        [{ id: 'decision-1' }],
      ]);

      await service.reconcile();

      const enqueued = enqueuedIds(renditions);
      expect(enqueued).toContain('decision-1');
    });
  });

  // Once AUDIO_S3_ENDPOINT routes renditions to a remote bucket, nothing
  // audio-related touches the local volume, so a local free-space number no
  // longer describes the real limit and must not be able to halt the backfill.
  describe('disk guard with remote storage', () => {
    const REMOTE = true;

    it('does not consult the local filesystem at all', async () => {
      statfsMock.mockResolvedValue(freeSpace(1));
      const { service, renditions } = build(
        ON_WITH_DECISIONS,
        [VOLUME, [{ count: 1n }], [{ id: 'digest-1' }], [{ count: 0n }], []],
        REMOTE,
      );

      await service.reconcile();

      expect(statfsMock).not.toHaveBeenCalled();
      // 1 GB free would have bailed before the first query in local mode.
      expect(enqueuedIds(renditions)).toContain('digest-1');
    });

    it('logs the skip once per tick', async () => {
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const { service } = build(ON, [VOLUME, [{ count: 0n }], [], [{ count: 0n }], []], REMOTE);

      await service.reconcile();

      const skips = logSpy.mock.calls
        .map(([arg]) => arg as Record<string, unknown>)
        .filter((arg) => arg?.['event'] === 'audio_reconcile_disk_guard_skipped');
      expect(skips).toHaveLength(1);
      expect(String(skips[0]?.['message'])).toContain('remote');

      logSpy.mockRestore();
    });

    it('still enqueues tier 3 when the local volume is unmeasurable', async () => {
      // In local mode this is the ONE case tier 3 is refused for. Remote storage
      // is exactly the fix for that constraint, so it must no longer apply.
      statfsMock.mockRejectedValue(new Error('ENOSYS'));
      const { service, renditions } = build(
        ON_WITH_DECISIONS,
        [
          VOLUME,
          [{ count: 0n }],
          [],
          [{ count: 0n }],
          [],
          [{ count: 0n }], // tier 4
          [],
          [{ count: 1n }],
          [{ id: 'decision-1' }],
        ],
        REMOTE,
      );

      await service.reconcile();

      expect(enqueuedIds(renditions)).toContain('decision-1');
    });

    it('leaves the two feature flags as the only gate on tier 3', async () => {
      // Remote storage removes the disk constraint, NOT the flag requirement.
      const { service, renditions } = build(
        ON,
        [VOLUME, [{ count: 0n }], [], [{ count: 0n }], []],
        REMOTE,
      );

      await service.reconcile();

      expect(enqueuedIds(renditions)).not.toContain('decision-1');
    });
  });

  describe('dry run', () => {
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
    });
    afterEach(() => logSpy.mockRestore());

    const dryRunLogs = () =>
      logSpy.mock.calls
        .map(([arg]) => arg as Record<string, unknown>)
        .filter((arg) => arg?.['event'] === 'audio_reconcile_dry_run');

    it('runs every query and logs tiers 1-2 but enqueues nothing', async () => {
      const { service, renditions, queryRaw } = build(
        { ...ON, AUDIO_RECONCILE_DRY_RUN: 'true' },
        [
          VOLUME,
          [{ count: 13058n }], // tier 1 count — the real prod digest gap
          [{ id: 'digest-1' }],
          [{ count: 24n }], // tier 2 count
          [{ id: 'codal-1' }],
        ],
      );

      await service.reconcile();

      expect(renditions.requestGeneration).not.toHaveBeenCalled();
      // The whole point of the dry run: the gap queries still ran.
      expect(queryRaw).toHaveBeenCalled();

      const logs = dryRunLogs();
      // Tier 4 (statutory sections) reports too; tier 3 stays flag-gated off.
      expect(logs.map((l) => l['tier'])).toEqual([1, 2, 4]);
      expect(logs[0]).toEqual(
        expect.objectContaining({
          wouldEnqueue: 1,
          remainingGap: 13058,
          sampleIds: ['digest-1'],
          // 13,058 × 116 s / 3600 — arithmetic, pinned so a constant edit shows
          // up. 116 s/item comes from the MEASURED 13.7 chars/audio-second on
          // Kokoro's af_heart (prod 2026-07-29).
          estimatedHoursForTier: 420.8,
        }),
      );
    });

    it('enqueues normally when DRY_RUN is false', async () => {
      const { service, renditions } = build(
        { ...ON, AUDIO_RECONCILE_DRY_RUN: 'false' },
        [VOLUME, [{ count: 1n }], [{ id: 'digest-1' }], [{ count: 0n }], []],
      );

      await service.reconcile();

      expect(renditions.requestGeneration).toHaveBeenCalledTimes(1);
      expect(dryRunLogs()).toHaveLength(0);
    });

    it('does nothing at all when DRY_RUN is set but the reconciler is off', async () => {
      const { service, renditions, queryRaw } = build(
        { AUDIO_RECONCILE_DRY_RUN: 'true' },
        [],
      );

      await service.reconcile();

      expect(renditions.requestGeneration).not.toHaveBeenCalled();
      expect(queryRaw).not.toHaveBeenCalled();
      expect(dryRunLogs()).toHaveLength(0);
    });
  });

  /**
   * Once terminal job ids stop blocking re-enqueue, nothing else stops the tick
   * from retrying content that can never succeed. Prod has 4 such codals
   * (374,364 / 535,553 / 796,129 / 810,815 chars), all `output_too_large` —
   * the stale-id block was accidentally suppressing those retries.
   */
  describe('permanently refused content', () => {
    const failed = (contentId: string, failureReason: string | null) => ({
      contentId,
      failureReason,
    });

    /** Tier 2 (codals) gap of two ids, with `failedRows` behind them. */
    const withCodalGap = (
      rows: Array<{ contentId: string; failureReason: string | null }>,
    ) =>
      build(
        ON,
        [
          VOLUME,
          [{ count: 0n }], // tier 1 count
          [], // tier 1 ids
          [{ count: 2n }], // tier 2 count
          [{ id: 'codal-big' }, { id: 'codal-ok' }],
        ],
        false,
        rows,
      );

    it.each(['output_too_large', 'text_too_long'])(
      'skips a row failed with %s',
      async (reason) => {
        const { service, renditions } = withCodalGap([
          failed('codal-big', `${reason}: 810815 chars, above the ceiling`),
        ]);

        await service.reconcile();

        expect(enqueuedIds(renditions)).toEqual(['codal-ok']);
      },
    );

    it.each(['transient', 'timeout', 'error', 'permanent'])(
      'still enqueues a row failed with %s — re-running can change the outcome',
      async (reason) => {
        const { service, renditions } = withCodalGap([
          failed('codal-big', `${reason}: tts-service returned 500`),
        ]);

        await service.reconcile();

        expect(enqueuedIds(renditions)).toEqual(['codal-big', 'codal-ok']);
      },
    );

    it('queries the failed rows on the ACTIVE voice and language', async () => {
      const { service, findMany } = withCodalGap([]);

      await service.reconcile();

      const where = (findMany.mock.calls.at(-1)?.[0] as { where: unknown })
        .where as Record<string, unknown>;
      expect(where).toMatchObject({
        contentType: 'legal_document',
        language: 'en',
        voiceId: 'af_heart',
        status: 'failed',
      });
      expect(where['contentId']).toEqual({
        in: ['codal-big', 'codal-ok'],
      });
    });

    it('logs the skipped count ONCE per tick', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { service } = withCodalGap([
        failed('codal-big', 'output_too_large: 810815 chars'),
      ]);

      await service.reconcile();

      const logs = warnSpy.mock.calls
        .map(([arg]) => arg as Record<string, unknown>)
        .filter(
          (arg) => arg?.['event'] === 'audio_reconcile_permanently_refused',
        );
      // The gap query counts these forever, so an unexplained residual reads as
      // a stalled backfill.
      expect(logs).toHaveLength(1);
      expect(logs[0]?.['skipped']).toBe(1);
      expect(logs[0]?.['reasons']).toEqual([
        'text_too_long',
        'output_too_large',
      ]);

      warnSpy.mockRestore();
    });

    it('says nothing when nothing was refused', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { service } = withCodalGap([]);

      await service.reconcile();

      expect(
        warnSpy.mock.calls
          .map(([arg]) => arg as Record<string, unknown>)
          .filter(
            (arg) => arg?.['event'] === 'audio_reconcile_permanently_refused',
          ),
      ).toHaveLength(0);

      warnSpy.mockRestore();
    });

    it('does not let refused ids consume the tick batch budget', async () => {
      const { service, renditions } = build(
        { ...ON, AUDIO_RECONCILE_BATCH: '2' },
        [
          VOLUME,
          [{ count: 2n }], // tier 1 count
          [{ id: 'digest-refused' }, { id: 'digest-ok' }],
          [{ count: 1n }], // tier 2 count
          [{ id: 'codal-ok' }],
        ],
        false,
        [failed('digest-refused', 'output_too_large: 810815 chars')],
      );

      await service.reconcile();

      // One of the two tier-1 ids was refused, so a slot is left for tier 2
      // rather than being burned reproducing a known refusal.
      expect(enqueuedIds(renditions)).toEqual(['digest-ok', 'codal-ok']);
    });

    it('reports refusals in the dry run instead of counting them as work', async () => {
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const { service, renditions } = build(
        { ...ON, AUDIO_RECONCILE_DRY_RUN: 'true' },
        [
          VOLUME,
          [{ count: 0n }],
          [],
          [{ count: 2n }],
          [{ id: 'codal-big' }, { id: 'codal-ok' }],
        ],
        false,
        [failed('codal-big', 'output_too_large: 810815 chars')],
      );

      await service.reconcile();

      const tier2 = logSpy.mock.calls
        .map(([arg]) => arg as Record<string, unknown>)
        .find(
          (arg) =>
            arg?.['event'] === 'audio_reconcile_dry_run' && arg?.['tier'] === 2,
        );
      expect(tier2?.['wouldEnqueue']).toBe(1);
      expect(tier2?.['sampleIds']).toEqual(['codal-ok']);
      expect(renditions.requestGeneration).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });

  /**
   * The four large statutory documents cannot be narrated whole (one 159-344
   * MiB file of 7-16 h audio each), so tier 4 narrates their 4,857 sections
   * individually. The danger is counting the same text twice — once as a
   * document in tier 2 and again as N sections in tier 4.
   */
  describe('tier 4 — statutory sections', () => {
    /** VOLUME, tier 1, tier 2, tier 4, tier 3 — the array order of TIERS. */
    const sequence = (tier4: unknown[][]) => [
      VOLUME,
      [{ count: 0n }], // tier 1 count
      [], // tier 1 ids
      [{ count: 0n }], // tier 2 count
      [], // tier 2 ids
      ...tier4,
    ];

    it('enqueues sections as legal_document_section', async () => {
      const { service, renditions } = build(
        ON,
        sequence([[{ count: 2n }], [{ id: 'sec-1' }, { id: 'sec-2' }]]),
      );

      await service.reconcile();

      expect(renditions.requestGeneration.mock.calls).toEqual([
        ['legal_document_section', 'sec-1', 'en', false, 3],
        ['legal_document_section', 'sec-2', 'en', false, 3],
      ]);
    });

    it('runs on AUDIO_RECONCILER_ENABLED alone, like digests', async () => {
      // Sections belong to statutory documents, so the decision storage flag
      // has nothing to say about them.
      const { service, renditions } = build(ON, sequence([[{ count: 1n }], [{ id: 'sec-1' }]]));

      await service.reconcile();

      expect(enqueuedIds(renditions)).toEqual(['sec-1']);
    });

    it('gives sections a LOWER priority than digests', async () => {
      const { service, renditions } = build(ON, [
        VOLUME,
        [{ count: 1n }],
        [{ id: 'digest-1' }],
        [{ count: 0n }],
        [],
        [{ count: 1n }],
        [{ id: 'sec-1' }],
      ]);

      await service.reconcile();

      const priorities = enqueuedPriorities(renditions);
      // A 4,857-item backfill must never starve a publish.
      expect(priorities.get('digest-1') as number).toBeLessThan(
        priorities.get('sec-1') as number,
      );
    });

    it('leaves tier 2 no statutory document types to count', async () => {
      const { service, queryRaw } = build(
        ON,
        sequence([[{ count: 0n }], []]),
      );

      await service.reconcile();

      // $queryRaw calls: 0 volume, 1 tier-1 count, 2 tier-1 ids, 3 tier-2
      // count, 4 tier-2 ids, 5 tier-4 count, 6 tier-4 ids. The FIRST bound
      // value of a legal-document query is its document_type array.
      const tier2Types = queryRaw.mock.calls[3]?.[1] as string[];
      const tier4Types = queryRaw.mock.calls[5]?.[1] as string[];

      // THE double-count guard: every type tier 4 claims is subtracted from
      // tier 2, so no document is both one whole item and N section items.
      expect(tier4Types).toEqual(
        expect.arrayContaining(['codal', 'constitution', 'republic_act']),
      );
      expect(tier2Types).toEqual([]);
      expect(
        tier2Types.filter((t) => tier4Types.includes(t)),
      ).toEqual([]);
    });

    it('never enqueues a statutory document and its sections in one tick', async () => {
      // What a real tick looks like for the Civil Code: tier 2 finds nothing
      // because its type list is empty, tier 4 finds the sections.
      const { service, renditions } = build(
        ON,
        sequence([[{ count: 2n }], [{ id: 'civil-sec-1' }, { id: 'civil-sec-2' }]]),
      );

      await service.reconcile();

      const types = renditions.requestGeneration.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(types).toEqual([
        'legal_document_section',
        'legal_document_section',
      ]);
      expect(types).not.toContain('legal_document');
    });

    it('counts only published parents with non-empty section text', async () => {
      const { service, queryRaw } = build(ON, sequence([[{ count: 5n }], []]));

      await service.reconcile();

      const countSql = String(queryRaw.mock.calls[5]?.[0]);
      expect(countSql).toContain('legal_document_sections');
      expect(countSql).toContain("ld.status = 'published'");
      expect(countSql).toContain('btrim(s.plain_text)');
      expect(countSql).toContain("ar.content_type = 'legal_document_section'");
      // Uncapped, like every other tier's gap count.
      expect(countSql).not.toContain('LIMIT');
    });

    it('orders the backfill front to back within a document', async () => {
      const { service, queryRaw } = build(ON, sequence([[{ count: 5n }], []]));

      await service.reconcile();

      // A partially-narrated document should be playable from its first
      // article, not pocked with gaps.
      expect(String(queryRaw.mock.calls[6]?.[0])).toContain('s.ordering ASC');
    });

    it('skips a section permanently refused, like every other tier', async () => {
      const { service, renditions } = build(
        ON,
        sequence([[{ count: 2n }], [{ id: 'sec-huge' }, { id: 'sec-ok' }]]),
        false,
        [
          {
            contentId: 'sec-huge',
            failureReason: 'output_too_large: 38479 chars',
          },
        ],
      );

      await service.reconcile();

      expect(enqueuedIds(renditions)).toEqual(['sec-ok']);
    });
  });

  it('counts the UNCAPPED gap separately from the capped id list', async () => {
    const { service, queryRaw } = build({ ...ON, AUDIO_RECONCILE_BATCH: '2' }, [
      VOLUME,
      [{ count: 15464n }], // real remaining gap, far above the batch size
      [{ id: 'a' }, { id: 'b' }],
      [{ count: 0n }],
      [],
    ]);

    await service.reconcile();

    // The COUNT query must not carry a LIMIT — that is what made the logged
    // gap read as a flat, stalled number.
    const countSql = String(queryRaw.mock.calls[1]?.[0]);
    expect(countSql).toContain('COUNT(*)');
    expect(countSql).not.toContain('LIMIT');
  });
});

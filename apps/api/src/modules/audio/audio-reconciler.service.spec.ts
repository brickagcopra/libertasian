import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { statfs } from 'fs/promises';

import { PrismaService } from '../../prisma/prisma.service';
import { AudioReconcilerService } from './audio-reconciler.service';
import { AudioRenditionService } from './audio-rendition.service';

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
function build(env: Record<string, string>, results: unknown[][]) {
  const queryRaw = jest.fn();
  results.forEach((rows) => queryRaw.mockResolvedValueOnce(rows));
  queryRaw.mockResolvedValue([]);

  const prisma = { $queryRaw: queryRaw };
  const queue = { add: jest.fn() };
  const renditions = { voiceId: 'af_heart' };
  const config = {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as unknown as ConfigService;

  const service = new AudioReconcilerService(
    prisma as unknown as PrismaService,
    renditions as unknown as AudioRenditionService,
    config,
    queue as unknown as Queue,
  );
  return { service, queue, queryRaw };
}

const VOLUME = [{ count: 0n, duration_ms: 0n }];
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
    const { service, queue, queryRaw } = build({}, []);
    await service.reconcile();
    expect(queue.add).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('skips tier 3 when only AUDIO_RECONCILER_ENABLED is true', async () => {
    const { service, queue } = build(ON, [
      VOLUME,
      [{ count: 1n }], // tier 1 count
      [{ id: 'digest-1' }], // tier 1 ids
      [{ count: 1n }], // tier 2 count
      [{ id: 'codal-1' }], // tier 2 ids
    ]);

    await service.reconcile();

    const enqueued = queue.add.mock.calls.map(
      ([, data]) => (data as { contentId: string }).contentId,
    );
    expect(enqueued).toEqual(['digest-1', 'codal-1']);
  });

  it('enqueues tier 3 only when BOTH flags are true', async () => {
    const { service, queue } = build(ON_WITH_DECISIONS, [
      VOLUME,
      [{ count: 0n }],
      [],
      [{ count: 0n }],
      [],
      [{ count: 1n }],
      [{ id: 'decision-1' }],
    ]);

    await service.reconcile();

    expect(queue.add).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contentId: 'decision-1' }),
      expect.objectContaining({ priority: 10 }),
    );
  });

  it('gives tier 3 a lower priority than tier 1 so a backfill cannot starve it', async () => {
    const { service, queue } = build(ON_WITH_DECISIONS, [
      VOLUME,
      [{ count: 1n }],
      [{ id: 'digest-1' }],
      [{ count: 0n }],
      [],
      [{ count: 1n }],
      [{ id: 'decision-1' }],
    ]);

    await service.reconcile();

    const priorities = new Map<string, number>(
      queue.add.mock.calls.map(([, data, opts]) => [
        (data as { contentId: string }).contentId,
        (opts as { priority: number }).priority,
      ]),
    );
    expect(priorities.get('digest-1')).toBeDefined();
    expect(priorities.get('decision-1')).toBeDefined();
    expect(priorities.get('digest-1') as number).toBeLessThan(
      priorities.get('decision-1') as number,
    );
  });

  it('caps total enqueues at AUDIO_RECONCILE_BATCH per tick', async () => {
    const { service, queue } = build({ ...ON, AUDIO_RECONCILE_BATCH: '2' }, [
      VOLUME,
      [{ count: 3n }],
      [{ id: 'a' }, { id: 'b' }],
      [{ count: 5n }],
      [],
    ]);

    await service.reconcile();

    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  describe('disk guard', () => {
    it('enqueues nothing when free disk is measured and below the threshold', async () => {
      statfsMock.mockResolvedValue(freeSpace(5));
      const { service, queue, queryRaw } = build(ON_WITH_DECISIONS, [VOLUME]);

      await service.reconcile();

      expect(queue.add).not.toHaveBeenCalled();
      // Bails before even the cumulative-volume query.
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('refuses ONLY tier 3 when free disk cannot be measured', async () => {
      statfsMock.mockRejectedValue(new Error('ENOSYS'));
      const { service, queue } = build(ON_WITH_DECISIONS, [
        VOLUME,
        [{ count: 1n }], // tier 1 count
        [{ id: 'digest-1' }], // tier 1 ids
        [{ count: 1n }], // tier 2 count
        [{ id: 'codal-1' }], // tier 2 ids
      ]);

      await service.reconcile();

      const enqueued = queue.add.mock.calls.map(
        ([, data]) => (data as { contentId: string }).contentId,
      );
      // Tiers 1-2 need ~12 GB and proceed; tier 3 is the case the guard exists for.
      expect(enqueued).toContain('digest-1');
      expect(enqueued).toContain('codal-1');
      expect(enqueued).not.toContain('decision-1');
    });

    it('still enqueues tier 3 when free disk is measured and healthy', async () => {
      statfsMock.mockResolvedValue(freeSpace(200));
      const { service, queue } = build(ON_WITH_DECISIONS, [
        VOLUME,
        [{ count: 0n }],
        [],
        [{ count: 0n }],
        [],
        [{ count: 1n }],
        [{ id: 'decision-1' }],
      ]);

      await service.reconcile();

      const enqueued = queue.add.mock.calls.map(
        ([, data]) => (data as { contentId: string }).contentId,
      );
      expect(enqueued).toContain('decision-1');
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
      const { service, queue, queryRaw } = build(
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

      expect(queue.add).not.toHaveBeenCalled();
      // The whole point of the dry run: the gap queries still ran.
      expect(queryRaw).toHaveBeenCalled();

      const logs = dryRunLogs();
      expect(logs.map((l) => l['tier'])).toEqual([1, 2]);
      expect(logs[0]).toEqual(
        expect.objectContaining({
          wouldEnqueue: 1,
          remainingGap: 13058,
          sampleIds: ['digest-1'],
          // 13,058 × 135 s / 3600 — arithmetic, pinned so a constant edit shows up.
          estimatedHoursForTier: 489.7,
        }),
      );
    });

    it('enqueues normally when DRY_RUN is false', async () => {
      const { service, queue } = build(
        { ...ON, AUDIO_RECONCILE_DRY_RUN: 'false' },
        [VOLUME, [{ count: 1n }], [{ id: 'digest-1' }], [{ count: 0n }], []],
      );

      await service.reconcile();

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(dryRunLogs()).toHaveLength(0);
    });

    it('does nothing at all when DRY_RUN is set but the reconciler is off', async () => {
      const { service, queue, queryRaw } = build(
        { AUDIO_RECONCILE_DRY_RUN: 'true' },
        [],
      );

      await service.reconcile();

      expect(queue.add).not.toHaveBeenCalled();
      expect(queryRaw).not.toHaveBeenCalled();
      expect(dryRunLogs()).toHaveLength(0);
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

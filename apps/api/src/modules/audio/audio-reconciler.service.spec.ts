import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { AudioReconcilerService } from './audio-reconciler.service';
import { AudioRenditionService } from './audio-rendition.service';

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

import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { AudioReconcilerService } from './audio-reconciler.service';
import { AudioRenditionService } from './audio-rendition.service';
import { AudioStorageService } from './audio-storage.service';
import { audioJobId } from './audio.types';
import type { TtsClient } from './tts.client';

/**
 * The job-id contract, tested against BullMQ ITSELF rather than a mock.
 *
 * Every other audio spec mocks the queue, and a mock accepts any string — which
 * is exactly why `${contentType}:${contentId}:...` shipped and threw on every
 * real enqueue while the suite stayed green. These tests exist so the next
 * separator change is validated by the library that has to accept it.
 */

/**
 * BullMQ's real validator. `Job.prototype.validateOptions` is synchronous and
 * touches no Redis — it reads only `this.opts` — so it can be invoked directly
 * on a bare object. This is the same code path `queue.add` runs
 * (bullmq 5.71.0, `classes/job.js`), not a reimplementation of its rules.
 */
function assertBullMqAccepts(jobId: string): void {
  const validate = (
    Job.prototype as unknown as {
      validateOptions(jobData: { data: string }): void;
    }
  ).validateOptions;
  validate.call({ opts: { jobId }, name: 'generate-audio' }, { data: '{}' });
}

describe('audio job id', () => {
  // Sanity-check the harness itself: if this stops throwing, BullMQ relaxed the
  // rule and assertBullMqAccepts is no longer testing anything.
  it('BullMQ rejects the colon-separated id that shipped to prod', () => {
    expect(() => assertBullMqAccepts('digest:d1:en:Matthew')).toThrow(
      'Custom Id cannot contain :',
    );
  });

  it('is accepted by BullMQ', () => {
    expect(() =>
      assertBullMqAccepts(audioJobId('digest', 'd1', 'en', 'Matthew')),
    ).not.toThrow();
  });

  // Asserted on the CHARACTER, not a golden string, so replacing '__' with
  // something else stays honest instead of just updating an expected literal.
  it('contains no colon', () => {
    expect(audioJobId('legal_document', 'abc-123', 'en', 'af_heart')).not.toContain(':');
  });

  it('holds for every content type and for uuid-shaped ids', () => {
    const ids = [
      audioJobId('digest', '3f8a1c2e-1b4d-4c9a-9f2e-6d5b7a8c9d0e', 'en', 'af_heart'),
      audioJobId('bar_exam_answer', 'ans-1', 'fil', 'Matthew'),
      audioJobId('legal_document', 'doc-1', 'en', 'bm_george'),
    ];
    for (const id of ids) {
      expect(id).not.toContain(':');
      expect(() => assertBullMqAccepts(id)).not.toThrow();
    }
  });

  it('stays distinct across every field, so nothing dedupes by accident', () => {
    const base = audioJobId('digest', 'd1', 'en', 'af_heart');
    expect(audioJobId('legal_document', 'd1', 'en', 'af_heart')).not.toBe(base);
    expect(audioJobId('digest', 'd2', 'en', 'af_heart')).not.toBe(base);
    expect(audioJobId('digest', 'd1', 'fil', 'af_heart')).not.toBe(base);
    expect(audioJobId('digest', 'd1', 'en', 'Matthew')).not.toBe(base);
  });

  /**
   * The two enqueue sites must agree, because the id IS the dedupe key: a
   * backfill job and a concurrent user request for the same content have to
   * collide, or the same audio is synthesized twice. They drifted apart once
   * already — the reconciler hardcoded 'en' while the rendition service passed
   * `language` — so this drives the REAL services rather than comparing two
   * calls to the helper, which would pass even if a call site stopped using it.
   */
  describe('both enqueue sites', () => {
    const CONTENT_ID = 'd1';

    async function reconcilerJobId(): Promise<string | undefined> {
      const queue = { add: jest.fn() };
      const queryRaw = jest.fn();
      // volume, tier-1 count, tier-1 ids, then empty for tiers 2-3.
      queryRaw
        .mockResolvedValueOnce([{ count: 0n, duration_ms: 0n }])
        .mockResolvedValueOnce([{ count: 1n }])
        .mockResolvedValueOnce([{ id: CONTENT_ID }])
        .mockResolvedValue([]);

      const service = new AudioReconcilerService(
        { $queryRaw: queryRaw } as unknown as PrismaService,
        { voiceId: 'Matthew' } as unknown as AudioRenditionService,
        { isRemote: false } as unknown as AudioStorageService,
        {
          get: (key: string, fallback?: string) =>
            key === 'AUDIO_RECONCILER_ENABLED' ? 'true' : fallback,
        } as unknown as ConfigService,
        queue as unknown as Queue,
      );

      await service.reconcile();
      const opts = queue.add.mock.calls[0]?.[2] as { jobId?: string };
      return opts?.jobId;
    }

    async function requestGenerationJobId(): Promise<string | undefined> {
      const queue = { add: jest.fn() };
      const service = new AudioRenditionService(
        {} as unknown as PrismaService,
        {} as unknown as TtsClient,
        {} as unknown as AudioStorageService,
        {
          // Defaults resolve to Polly/Matthew, matching the voiceId above.
          get: (_key: string, fallback?: string) => fallback,
        } as unknown as ConfigService,
        queue as unknown as Queue,
      );

      await service.requestGeneration('digest', CONTENT_ID, 'en');
      const opts = queue.add.mock.calls[0]?.[2] as { jobId?: string };
      return opts?.jobId;
    }

    it('produce the SAME id for the same content', async () => {
      const [fromReconciler, fromRequest] = await Promise.all([
        reconcilerJobId(),
        requestGenerationJobId(),
      ]);

      expect(fromReconciler).toBeDefined();
      expect(fromReconciler).toBe(fromRequest);
      expect(fromReconciler).toBe(audioJobId('digest', CONTENT_ID, 'en', 'Matthew'));
    });

    it('produce ids BullMQ accepts — the enqueue that threw on prod', async () => {
      for (const id of await Promise.all([
        reconcilerJobId(),
        requestGenerationJobId(),
      ])) {
        expect(id).not.toContain(':');
        expect(() => assertBullMqAccepts(id as string)).not.toThrow();
      }
    });
  });
});

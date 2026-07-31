import { UnrecoverableError, type Job } from 'bullmq';

import { AudioGenerationProcessor } from './audio-generation.processor';
import { AudioRenditionService } from './audio-rendition.service';
import { TtsSynthesisError, type TtsFailureReason } from './tts.client';
import type { AudioGenerationJobData } from './audio.types';

const DATA: AudioGenerationJobData = {
  contentType: 'digest',
  contentId: 'd1',
  language: 'en',
  force: false,
};

/** A BullMQ job on its `attemptsMade`-th retry of `attempts` allowed. */
const jobOn = (attemptsMade: number, attempts = 3): Job<AudioGenerationJobData> =>
  ({
    data: DATA,
    attemptsMade,
    opts: { attempts },
  }) as unknown as Job<AudioGenerationJobData>;

function build() {
  const renditions = {
    generate: jest.fn(),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new AudioGenerationProcessor(
    renditions as unknown as AudioRenditionService,
  );
  return { processor, renditions };
}

describe('AudioGenerationProcessor', () => {
  beforeEach(() => {
    // The processor logs an error on every failure path; keep the suite quiet
    // without hiding a genuine throw.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records nothing on success', async () => {
    const { processor, renditions } = build();
    renditions.generate.mockResolvedValue({ id: 'r-1' });

    await processor.process(jobOn(0));

    expect(renditions.recordFailure).not.toHaveBeenCalled();
  });

  it.each<TtsFailureReason>([
    'timeout',
    'permanent',
    'text_too_long',
    'output_too_large',
  ])(
    'stops retrying a %s failure and persists the reason',
    async (reason) => {
      const { processor, renditions } = build();
      renditions.generate.mockRejectedValue(
        new TtsSynthesisError(reason, 'why it failed'),
      );

      // First attempt of three — BullMQ would normally retry twice more, which
      // for a compute-bound failure is pure waste.
      await expect(processor.process(jobOn(0))).rejects.toBeInstanceOf(
        UnrecoverableError,
      );

      expect(renditions.recordFailure).toHaveBeenCalledWith(
        DATA,
        reason,
        'why it failed',
      );
    },
  );

  it('leaves a transient failure to BullMQ while attempts remain', async () => {
    const { processor, renditions } = build();
    const err = new TtsSynthesisError('transient', 'tts-service returned 503');
    renditions.generate.mockRejectedValue(err);

    await expect(processor.process(jobOn(0))).rejects.toBe(err);

    // Nothing persisted yet: a later attempt may still succeed, and a `failed`
    // row published mid-retry would contradict it.
    expect(renditions.recordFailure).not.toHaveBeenCalled();
  });

  it('persists the reason on the LAST transient attempt', async () => {
    const { processor, renditions } = build();
    const err = new TtsSynthesisError('transient', 'tts-service returned 503');
    renditions.generate.mockRejectedValue(err);

    await expect(processor.process(jobOn(2))).rejects.toBe(err);

    expect(renditions.recordFailure).toHaveBeenCalledWith(
      DATA,
      'transient',
      'tts-service returned 503',
    );
  });

  it('records an unclassified error as `error` on the last attempt', async () => {
    const { processor, renditions } = build();
    const err = new Error('Digest d1 not found');
    renditions.generate.mockRejectedValue(err);

    await expect(processor.process(jobOn(2))).rejects.toBe(err);

    expect(renditions.recordFailure).toHaveBeenCalledWith(
      DATA,
      'error',
      'Digest d1 not found',
    );
  });

  it('still surfaces the original error when recording the reason fails', async () => {
    const { processor, renditions } = build();
    const err = new TtsSynthesisError('transient', 'tts-service returned 503');
    renditions.generate.mockRejectedValue(err);
    renditions.recordFailure.mockRejectedValue(new Error('database is down'));

    await expect(processor.process(jobOn(2))).rejects.toBe(err);
  });

  it('treats a job with no attempts option as its own last attempt', async () => {
    const { processor, renditions } = build();
    renditions.generate.mockRejectedValue(new Error('boom'));

    await expect(
      processor.process({
        data: DATA,
        attemptsMade: 0,
        opts: {},
      } as unknown as Job<AudioGenerationJobData>),
    ).rejects.toThrow('boom');

    expect(renditions.recordFailure).toHaveBeenCalledWith(DATA, 'error', 'boom');
  });
});

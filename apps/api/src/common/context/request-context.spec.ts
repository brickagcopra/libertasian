import {
  getRequestPlatform,
  runWithRequestContext,
} from './request-context';

/**
 * The request context decides whether a caller is gated, so its two properties
 * are safety properties, not conveniences:
 *
 *   1. OUTSIDE a request it is empty and resolves to `null` = not enforced.
 *      Every BullMQ worker, @Cron sweep, seed and script runs there.
 *   2. BETWEEN concurrent requests it does not leak. Node serves many requests
 *      on one thread; a module-level variable would be clobbered by whichever
 *      request entered the middleware most recently.
 */
describe('request context', () => {
  // ---- 1: no request ----

  it('resolves to null outside any request', () => {
    // BullMQ workers, @Cron sweeps and scripts all land here. `null` = no
    // purchase-capable platform = not enforced = today's behaviour.
    expect(getRequestPlatform()).toBeNull();
  });

  it('resolves to null again after a context has exited', () => {
    runWithRequestContext({ platform: 'ios' }, () => {
      expect(getRequestPlatform()).toBe('ios');
    });

    // The store must not survive the request that created it.
    expect(getRequestPlatform()).toBeNull();
  });

  // ---- reading inside a context ----

  it('reads the platform inside a context, including across awaits', async () => {
    await runWithRequestContext({ platform: 'android' }, async () => {
      expect(getRequestPlatform()).toBe('android');
      await new Promise((resolve) => setTimeout(resolve, 1));
      // The whole point of ALS over a parameter: the value survives the await
      // boundary that a service-layer DB call would introduce.
      expect(getRequestPlatform()).toBe('android');
    });
  });

  it('carries a null platform for a request that sent no header', async () => {
    await runWithRequestContext({ platform: null }, async () => {
      expect(getRequestPlatform()).toBeNull();
    });
  });

  // ---- 2: THE CONCURRENCY TEST ----

  it('does not leak between two interleaved requests with different platforms', async () => {
    /**
     * THIS IS THE TEST THAT JUSTIFIES AsyncLocalStorage.
     *
     * Replace the ALS store with a module-level `let currentPlatform` and this
     * test goes red: `web` enters second and overwrites the shared variable
     * while `ios` is suspended at its await, so `ios` resumes and observes
     * `null`. The observations below are recorded AFTER each await precisely so
     * that the interleaving is real and not two sequential runs.
     *
     * Sequential assertions cannot catch this. A module-level variable passes
     * every sequential test and fails only in production, where the symptom is
     * a user gated or un-gated according to whoever else was mid-request.
     */
    const observed: Record<string, unknown> = {};

    const request = (
      label: string,
      platform: 'ios' | 'android' | null,
      delayMs: number,
    ) =>
      runWithRequestContext({ platform }, async () => {
        // Yield, so the other request's middleware runs before this one
        // resumes. This is the exact window a shared variable is clobbered in.
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        observed[label] = getRequestPlatform();
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        // Read a second time, after the other request has certainly finished,
        // to catch a store that is restored rather than isolated.
        observed[`${label}:again`] = getRequestPlatform();
      });

    // `ios` starts first and sleeps longest, so `web` runs entirely inside
    // `ios`'s suspension.
    await Promise.all([
      request('ios', 'ios', 20),
      request('web', null, 5),
      request('android', 'android', 10),
    ]);

    expect(observed).toEqual({
      'ios': 'ios',
      'ios:again': 'ios',
      'web': null,
      'web:again': null,
      'android': 'android',
      'android:again': 'android',
    });
  });

  it('isolates nested contexts without corrupting the outer one', async () => {
    await runWithRequestContext({ platform: 'ios' }, async () => {
      await runWithRequestContext({ platform: 'android' }, async () => {
        expect(getRequestPlatform()).toBe('android');
      });

      // The inner context must not have overwritten the outer.
      expect(getRequestPlatform()).toBe('ios');
    });
  });
});

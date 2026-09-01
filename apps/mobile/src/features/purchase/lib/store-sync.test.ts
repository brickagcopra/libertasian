import { apiClient } from '../../../lib/api-client';
import { syncPurchasesWithServer, type StoreSyncResult } from './store-sync';

/**
 * Same envelope trap as `use-quotas.test.ts`, and worse here because the
 * failure was SILENT.
 *
 * `apiClient.post()` already strips {success, data}; `POST /store/sync` returns
 * exactly that shape. Reading `.data` off the unwrapped result gave `undefined`,
 * so `result.status` threw a TypeError — and this function's catch-all, which
 * exists so a network blip never looks like a failed purchase, swallowed it and
 * returned `{ kind: 'unreachable' }`.
 *
 * The user-visible effect: EVERY restore and every post-purchase sync reported
 * "couldn't reach the server", which reads as a network problem rather than a
 * bug. Nothing logged, nothing threw. These tests exist because the catch is
 * load-bearing and therefore hides exactly this class of mistake.
 */

const processed: StoreSyncResult = { status: 'processed' };

describe('syncPurchasesWithServer — envelope unwrapping', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('confirms when the server reports processed', async () => {
    // The UNWRAPPED body, because unwrapEnvelope already ran inside apiClient.
    jest.spyOn(apiClient, 'post').mockResolvedValue(processed as never);

    // Before the fix this was { kind: 'unreachable' }: `.data` was undefined
    // and `.status` threw straight into the catch.
    await expect(syncPurchasesWithServer()).resolves.toEqual({ kind: 'confirmed' });
  });

  it('reports a known non-processed status as unconfirmed, not unreachable', async () => {
    jest
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ status: 'noop' } as never);

    const outcome = await syncPurchasesWithServer();

    expect(outcome.kind).toBe('unconfirmed');
  });

  it('still returns unreachable when the request genuinely fails', async () => {
    // The catch must keep doing its real job: a network failure has NOT undone
    // the purchase, and must never be surfaced as a failed one.
    jest.spyOn(apiClient, 'post').mockRejectedValue(new Error('network'));

    await expect(syncPurchasesWithServer()).resolves.toEqual({ kind: 'unreachable' });
  });

  it('sends no body — the server reads the org from the JWT (D12)', async () => {
    const post = jest.spyOn(apiClient, 'post').mockResolvedValue(processed as never);

    await syncPurchasesWithServer();

    expect(post).toHaveBeenCalledWith('/store/sync');
  });
});

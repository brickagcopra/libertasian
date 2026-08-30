import { apiClient } from '@/lib/api-client';

/**
 * The server's answer to `POST /store/sync`.
 *
 * `conduit_unconfigured` is the shape it returns TODAY, on every deployment: no
 * RevenueCat secret is configured, so the server refuses the reconciliation
 * pull before making it. That is a deliberate no-op the API added rather than
 * 500ing, and it must reach the user as "we could not confirm that yet", never
 * as a failure.
 */
export interface StoreSyncResult {
  status: 'processed' | 'noop' | 'duplicate' | string;
  detail?: string;
}

interface StoreSyncResponse {
  success: boolean;
  data: StoreSyncResult;
}

export type StoreSyncOutcome =
  /** The server reconciled and agrees with the store. */
  | { kind: 'confirmed' }
  /**
   * The server could not confirm — it has no conduit credential, or the pull
   * found nothing yet. NOT an error: the purchase itself already succeeded at
   * the store, and the entitlement will arrive by webhook or by the nightly
   * reconciliation. The user is told to try Restore, not that something broke.
   */
  | { kind: 'unconfirmed'; reason: string }
  /** The request itself failed. Also not fatal to the purchase. */
  | { kind: 'unreachable' };

/** Details the server reports when it did not, or could not, reconcile. */
const UNCONFIRMED_DETAILS = new Set([
  'conduit_unconfigured',
  'in_sync',
  'no_subscription',
]);

/**
 * Ask the server to reconcile this account against the store (design §9).
 *
 * D12: there is deliberately no endpoint that accepts a receipt or an
 * entitlement claim from the client — a client-asserted entitlement is a
 * client-forgeable one. This sends NOTHING. The server's only input is the org
 * id it already holds in the JWT, and the answer comes from the store conduit
 * directly.
 *
 * Never throws. Every outcome is a state the purchase screen can render.
 */
export async function syncPurchasesWithServer(): Promise<StoreSyncOutcome> {
  try {
    const res = await apiClient.post<StoreSyncResponse>('/store/sync');
    const result = res.data;

    if (result.status === 'processed') return { kind: 'confirmed' };

    return {
      kind: 'unconfirmed',
      reason:
        result.detail && UNCONFIRMED_DETAILS.has(result.detail)
          ? result.detail
          : (result.detail ?? result.status),
    };
  } catch {
    // A network failure here does NOT undo the purchase — the store already
    // took the money and will tell the server by webhook. Reporting it as a
    // failed purchase would send the user to file a refund for something they
    // successfully bought.
    return { kind: 'unreachable' };
  }
}

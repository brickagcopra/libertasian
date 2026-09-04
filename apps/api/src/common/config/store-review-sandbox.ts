import type { ConfigService } from '@nestjs/config';

/**
 * D10a — the App Review exemption to D10.
 *
 * D10 says a SANDBOX store event never grants production entitlement, and that
 * rule is right for everyone except one caller: App Review. Apple (and Google)
 * review builds transact in the store SANDBOX against our PRODUCTION API, so
 * with D10 applied unconditionally the reviewer buys a subscription, the store
 * confirms it, and the server keeps the org on `free` — a paid-for purchase
 * that unlocks nothing, which is Guideline 3.1.1 / 2.1 territory.
 *
 * The exemption is therefore scoped to an EXPLICIT ALLOWLIST of organization
 * ids, empty by default. An empty list means D10 behaves exactly as it did
 * before this file existed, so a deployment that never sets the variable — or
 * one seeded from .env.example — cannot hand free Pro to a TestFlight tester
 * with a sandbox Apple ID. Populate it with the App Review demo org only, and
 * clear it when the review round is over.
 */
export function isStoreReviewSandboxOrg(
  config: ConfigService,
  organizationId: string | null,
): boolean {
  if (!organizationId) return false;
  const raw = config.get<string>('STORE_SANDBOX_REVIEW_ORG_IDS') ?? '';
  const allowed = raw
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0);
  return allowed.includes(organizationId.toLowerCase());
}

/**
 * How long a sandbox grant to a review org lasts, in ms.
 *
 * NOT the store's own expiry. A sandbox subscription renews every few minutes
 * and dies after roughly half an hour, so honouring `expiresAt` verbatim would
 * revoke the reviewer's access mid-review. The grant is floored to a fixed
 * window instead — long enough for a review session, short enough to be an
 * obviously temporary artefact.
 */
export function reviewSandboxGrantMs(config: ConfigService): number {
  const raw = Number(config.get<number | string>('STORE_SANDBOX_REVIEW_GRANT_HOURS'));
  const hours = Number.isFinite(raw) && raw > 0 ? raw : 24;
  return hours * 60 * 60 * 1000;
}

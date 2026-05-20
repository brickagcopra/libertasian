import { Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../../modules/audit/audit.service';

export interface AdminBypassRecord {
  userId?: string;
  organizationId?: string;
  route: string;
  quotaKey?: string;
  documentId?: string;
}

const THROTTLE_WINDOW_MS = 60_000;
const MAX_ENTRIES = 1024;

/**
 * Emits an `admin_subscription_bypass` audit-log row whenever a platform
 * admin skips a paywall/quota/preview gate. The audit row is what makes the
 * bypass traceable for compliance — without it, an admin reading paid corpus
 * content leaves no record.
 *
 * Throttled by an in-process LRU keyed on (userId, route) with a 60s window
 * so a single admin scrolling through corpus pages does not write one row
 * per request. The LRU is per-process (no cross-instance dedup); a small
 * amount of log duplication across api replicas is acceptable for an
 * audit-trail signal.
 */
@Injectable()
export class AdminBypassAuditService {
  private readonly logger = new Logger(AdminBypassAuditService.name);
  private readonly seen = new Map<string, number>();

  constructor(private readonly audit: AuditService) {}

  /** Fire-and-forget. Audit failures must never break the primary request. */
  record(entry: AdminBypassRecord): void {
    const key = `${entry.userId ?? 'anon'}|${entry.route}`;
    const now = Date.now();
    const last = this.seen.get(key);
    if (last !== undefined && now - last < THROTTLE_WINDOW_MS) {
      return;
    }

    // Refresh LRU position
    this.seen.delete(key);
    this.seen.set(key, now);
    this.evictExpired(now);
    this.enforceCapacity();

    void this.audit
      .log({
        organizationId: entry.organizationId,
        actorUserId: entry.userId,
        actorType: 'admin',
        action: 'admin_subscription_bypass',
        entityType: 'request',
        metadata: {
          route: entry.route,
          ...(entry.quotaKey ? { quotaKey: entry.quotaKey } : {}),
          ...(entry.documentId ? { documentId: entry.documentId } : {}),
        },
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`admin_subscription_bypass audit dropped: ${msg}`);
      });
  }

  private evictExpired(now: number): void {
    for (const [key, ts] of this.seen) {
      if (now - ts >= THROTTLE_WINDOW_MS) {
        this.seen.delete(key);
      } else {
        break;
      }
    }
  }

  private enforceCapacity(): void {
    while (this.seen.size > MAX_ENTRIES) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }
}

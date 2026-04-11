import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { ContentDisclaimer } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * The envelope shape attached to every derivative response by
 * `AttachDisclaimerInterceptor`. Kept intentionally small — if the reader
 * UI needs more fields, add them to the `ContentDisclaimer` model and
 * include them here.
 */
export interface DisclaimerEnvelope {
  contentClass: string;
  version: number;
  bodyHtml: string;
  bodyPlain: string;
}

/**
 * Canonical read-only accessor for `content_disclaimers` rows.
 *
 * The service holds a process-lifetime in-memory cache keyed by
 * `contentClass`. The cache is populated once at module init from a
 * single SELECT on the table; per-request lookups never hit the DB. This
 * matches the §8.6 launch-gate requirement that disclaimer attachment
 * adds zero meaningful latency to every derivative response.
 *
 * Admin edits to disclaimer text (§8.4) are out of scope for this PR.
 * When that lands, it must call `invalidateCache()` on this service so
 * that running processes pick up the new text without a restart.
 */
@Injectable()
export class ContentDisclaimersService implements OnModuleInit {
  private readonly logger = new Logger(ContentDisclaimersService.name);
  private cache = new Map<string, ContentDisclaimer>();
  private cacheReady = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.loadCache();
  }

  /**
   * Populate the in-memory cache from the database. Logs a warning — not
   * an error — if the table is empty, because in a fresh dev environment
   * the seed may not have run yet. A decorated request will still throw
   * `NotFoundException` and fail closed.
   */
  async loadCache(): Promise<void> {
    const rows = await this.prisma.contentDisclaimer.findMany({
      where: { isActive: true },
    });
    const next = new Map<string, ContentDisclaimer>();
    for (const row of rows) {
      next.set(row.contentClass, row);
    }
    this.cache = next;
    this.cacheReady = true;

    if (rows.length === 0) {
      this.logger.warn(
        'content_disclaimers table is empty — decorated endpoints will fail until seed runs',
      );
    } else {
      this.logger.log(
        `Loaded ${rows.length} content disclaimer row(s) into in-memory cache`,
      );
    }
  }

  /**
   * Drop the in-memory cache and reload from the database. Intended for
   * the (future) admin edit flow in §8.4 and for tests.
   */
  async invalidateCache(): Promise<void> {
    this.cacheReady = false;
    this.cache = new Map();
    await this.loadCache();
  }

  /**
   * Return the canonical `ContentDisclaimer` row for a given content
   * class. Throws `NotFoundException` if the class is unknown — this is
   * the fail-closed behaviour required by the §8.6 launch gate: an
   * unrecognised class MUST NOT silently fall through with a missing
   * disclaimer.
   */
  async getByContentClass(contentClass: string): Promise<ContentDisclaimer> {
    if (!this.cacheReady) {
      await this.loadCache();
    }
    const hit = this.cache.get(contentClass);
    if (!hit) {
      throw new NotFoundException(
        `No content disclaimer seeded for contentClass="${contentClass}"`,
      );
    }
    return hit;
  }

  /**
   * Return an envelope-shaped projection suitable for direct splicing
   * into a response body. Avoids leaking Prisma-internal fields (`id`,
   * `createdAt`, etc.) to API consumers.
   */
  async getEnvelope(contentClass: string): Promise<DisclaimerEnvelope> {
    const row = await this.getByContentClass(contentClass);
    return {
      contentClass: row.contentClass,
      version: row.version,
      bodyHtml: row.bodyHtml,
      bodyPlain: row.bodyPlain,
    };
  }

  /** Return every active disclaimer row (used by admin list views). */
  async getAll(): Promise<ContentDisclaimer[]> {
    if (!this.cacheReady) {
      await this.loadCache();
    }
    return Array.from(this.cache.values());
  }
}

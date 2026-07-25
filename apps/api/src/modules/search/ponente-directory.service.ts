import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Per CLAUDE.md every Redis key carries a TTL. 1 hour — the set barely moves. */
const PONENTE_CACHE_KEY = 'cache:search:ponente_directory';
const PONENTE_CACHE_TTL = 3600;

/**
 * The set of surnames that appear as `legal_documents.ponente`.
 *
 * `classifyQuery` needs this to tell a one-word name query (`Hernando`) from a
 * one-word topic query (`estafa`) — without it, every single-token search would
 * be treated as a person and get a spurious ponente boost.
 *
 * Every failure path here is fail-open: a Redis miss, a Redis outage or a
 * PostgreSQL error yields an empty set, which makes `classifyQuery` simply not
 * classify anything as `person`. Search degrades in relevance, never in
 * availability.
 */
@Injectable()
export class PonenteDirectoryService {
  private readonly logger = new Logger(PonenteDirectoryService.name);

  /**
   * Process-local memo. Avoids a Redis round-trip on every single search on the
   * hot path; the Redis entry is what keeps it consistent across replicas.
   */
  private memo: { value: ReadonlySet<string>; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getPonenteNames(): Promise<ReadonlySet<string>> {
    const now = Date.now();
    if (this.memo && this.memo.expiresAt > now) return this.memo.value;

    const names = await this.loadNames();
    this.memo = { value: names, expiresAt: now + PONENTE_CACHE_TTL * 1000 };
    return names;
  }

  /** Drop both cache layers — used after a bulk ingest adds new ponentes. */
  async invalidate(): Promise<void> {
    this.memo = null;
    try {
      await this.redis.del(PONENTE_CACHE_KEY);
    } catch (err) {
      this.logger.warn(`Failed to invalidate ponente cache: ${(err as Error).message}`);
    }
  }

  private async loadNames(): Promise<ReadonlySet<string>> {
    try {
      const cached = await this.redis.get(PONENTE_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as unknown;
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((n): n is string => typeof n === 'string'));
        }
      }
    } catch (err) {
      this.logger.warn(`Ponente cache read failed: ${(err as Error).message}`);
    }

    let names: string[];
    try {
      const rows = await this.prisma.legalDocument.findMany({
        where: { ponente: { not: null } },
        select: { ponente: true },
        distinct: ['ponente'],
      });
      names = rows
        .map((row) => row.ponente)
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
        .flatMap((name) => this.toSurnameTokens(name));
    } catch (err) {
      // Fail open — no ponente classification, but search still works.
      this.logger.warn(`Ponente directory query failed: ${(err as Error).message}`);
      return new Set<string>();
    }

    const unique = Array.from(new Set(names));
    try {
      await this.redis.set(
        PONENTE_CACHE_KEY,
        JSON.stringify(unique),
        PONENTE_CACHE_TTL,
      );
    } catch (err) {
      this.logger.warn(`Ponente cache write failed: ${(err as Error).message}`);
    }

    return new Set(unique);
  }

  /**
   * `ponente` values are free text — `HERNANDO, J.`, `LOPEZ, M., J.`,
   * `Gaerlan`. Reduce each to the individual name tokens a user might type,
   * dropping the `J.`/`JR.` honorifics and single initials.
   */
  private toSurnameTokens(ponente: string): string[] {
    return ponente
      .toUpperCase()
      .split(/[,\s]+/)
      .map((token) => token.replace(/\.+$/, '').trim())
      .filter(
        (token) =>
          token.length > 2 &&
          !['J', 'JR', 'SR', 'JJ', 'CJ', 'III', 'II'].includes(token) &&
          /^[A-Z][A-Z'-]+$/.test(token),
      );
  }
}

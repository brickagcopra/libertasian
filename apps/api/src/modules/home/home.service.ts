import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HomeFeedQueryDto } from './dto';

/**
 * Per CLAUDE.md: cache:feed:{userId}, 5-min TTL. Mandatory because Redis
 * runs noeviction while BullMQ shares the instance — every cache write
 * MUST set a TTL.
 */
const FEED_CACHE_TTL_SECONDS = 300;

/** Tones cycled through the For-you feed so cards alternate gradient palettes. */
const PHOTO_TONES = ['warm', 'cool', 'sage', 'plum', 'sand', 'lime', 'ink'] as const;
type PhotoTone = (typeof PHOTO_TONES)[number];

const TONE_BY_DOC_TYPE: Record<string, PhotoTone> = {
  case: 'warm',
  statute: 'sage',
  codal: 'plum',
  article: 'cool',
  outline: 'sand',
};

const TONE_BY_DIGEST_TYPE: Record<string, PhotoTone> = {
  case_digest: 'warm',
  irac: 'plum',
  mcq: 'lime',
  essay: 'cool',
  outline: 'sand',
  statute_summary: 'sage',
};

const CATEGORY_BY_DOC_TYPE: Record<string, string> = {
  case: 'CASE',
  statute: 'STATUTE',
  codal: 'CODAL',
  article: 'ARTICLE',
  outline: 'OUTLINE',
};

/** Approximate words per minute for read-time estimation. */
const READ_WPM = 220;

export interface BriefItem {
  id: string;
  /** Discriminator: routes the mobile tap to /digest/:id or /reader/:id. */
  kind: 'digest' | 'document';
  category: string;
  headline: string;
  minutes: number;
  byline?: string;
  tone?: PhotoTone;
}

export type FeedItem = BriefItem;

export interface HomeFeed {
  todaysBrief: BriefItem[];
  forYou: FeedItem[];
  nextCursor: string | null;
}

@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Personalised landing feed. Tenant-scoped via `organizationId` from the
   * caller's JWT — never trust a client-supplied org id.
   *
   * Cache strategy: only the first page (no cursor) is cached per-user. Later
   * pages always hit the DB so changes to a single org's content surface
   * within one cache TTL on the entry path that actually drives discovery.
   */
  async getFeed(
    userId: string,
    organizationId: string,
    dto: HomeFeedQueryDto,
  ): Promise<HomeFeed> {
    const limit = dto.limit ?? 20;
    const cursor = dto.cursor ?? null;
    const isFirstPage = cursor === null;

    if (isFirstPage) {
      const cached = await this.readCache(userId);
      if (cached) return cached;
    }

    const feed = await this.buildFeed(organizationId, cursor, limit);

    if (isFirstPage) {
      await this.writeCache(userId, feed);
    }

    return feed;
  }

  /** Invalidate the per-user feed cache (e.g. after the user dismisses a brief). */
  async invalidate(userId: string): Promise<void> {
    await this.redis.del(this.cacheKey(userId));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private cacheKey(userId: string): string {
    return `cache:feed:${userId}`;
  }

  private async readCache(userId: string): Promise<HomeFeed | null> {
    try {
      const raw = await this.redis.get(this.cacheKey(userId));
      if (!raw) return null;
      return JSON.parse(raw) as HomeFeed;
    } catch (err) {
      // Cache layer must never break the feed — log and miss.
      this.logger.warn(
        `Feed cache read failed for user ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async writeCache(userId: string, feed: HomeFeed): Promise<void> {
    try {
      await this.redis.set(
        this.cacheKey(userId),
        JSON.stringify(feed),
        FEED_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Feed cache write failed for user ${userId}: ${(err as Error).message}`,
      );
    }
  }

  private async buildFeed(
    organizationId: string,
    cursor: string | null,
    limit: number,
  ): Promise<HomeFeed> {
    // todaysBrief: 1 most-recent approved editorial digest (any type). The
    // visibility='public_editorial' + reviewStatus='approved' clause is the
    // editorial gate; the OR with org-scoped digests keeps tenant isolation.
    // CARVE-OUT: publicOrOrgDigestWhere() spans cross-org visibility='public_editorial'; forTenant() would filter them out
    const briefRows = await this.prisma.digest.findMany({
      where: this.publicOrOrgDigestWhere(organizationId),
      take: 1,
      orderBy: { createdAt: 'desc' },
      include: { legalDocument: this.legalDocumentSelect() },
    });

    // forYou: merge approved digests + published article/outline documents,
    // sort by createdAt desc, slice to `limit` for the page.
    const oversample = limit + 1;
    const cursorDate = cursor ? new Date(cursor) : null;

    const [digestRows, documentRows] = await Promise.all([
      // CARVE-OUT: publicOrOrgDigestWhere() spans cross-org visibility='public_editorial'; forTenant() would filter them out
      this.prisma.digest.findMany({
        where: {
          ...this.publicOrOrgDigestWhere(organizationId),
          ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        },
        take: oversample,
        orderBy: { createdAt: 'desc' },
        include: { legalDocument: this.legalDocumentSelect() },
      }),
      this.prisma.legalDocument.findMany({
        where: {
          documentType: { in: ['article', 'outline'] },
          isPublished: true,
          ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        },
        take: oversample,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const merged: Array<{ createdAt: Date; item: FeedItem }> = [
      ...digestRows.map((d) => ({
        createdAt: d.createdAt,
        item: this.digestToFeedItem(d),
      })),
      ...documentRows.map((doc) => ({
        createdAt: doc.createdAt,
        item: this.documentToFeedItem(doc),
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const page = merged.slice(0, limit);
    const hasNext = merged.length > limit;
    const lastEntry = page[page.length - 1];
    const nextCursor =
      hasNext && lastEntry ? lastEntry.createdAt.toISOString() : null;

    return {
      todaysBrief: briefRows.map((d) => this.digestToFeedItem(d)),
      forYou: page.map((entry) => entry.item),
      nextCursor,
    };
  }

  // -------------------------------------------------------------------------
  // Tenant scoping helpers
  // -------------------------------------------------------------------------

  private publicOrOrgDigestWhere(organizationId: string): Prisma.DigestWhereInput {
    return {
      OR: [
        // Public editorial — globally visible, gated on review.
        { visibility: 'public_editorial', reviewStatus: 'approved' },
        // Org-scoped — only this caller's organization.
        {
          organizationId,
          visibility: { in: ['org', 'public_editorial'] },
          reviewStatus: 'approved',
        },
      ],
    };
  }

  private legalDocumentSelect() {
    return {
      select: {
        id: true,
        title: true,
        shortTitle: true,
        citationText: true,
        documentType: true,
        ponente: true,
      },
    } as const;
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------

  private digestToFeedItem(
    digest: Prisma.DigestGetPayload<{
      include: {
        legalDocument: {
          select: {
            id: true;
            title: true;
            shortTitle: true;
            citationText: true;
            documentType: true;
            ponente: true;
          };
        };
      };
    }>,
  ): FeedItem {
    const headline =
      digest.title ||
      digest.legalDocument?.shortTitle ||
      digest.legalDocument?.title ||
      'Untitled digest';
    const byline = digest.legalDocument?.ponente ?? undefined;
    const minutes = this.estimateMinutes(
      [
        digest.summary,
        digest.facts,
        digest.issues,
        digest.ruling,
        digest.doctrine,
        digest.dispositive,
      ]
        .filter(Boolean)
        .join(' '),
    );

    return {
      id: digest.id,
      kind: 'digest',
      category: this.categoryForDigest(digest.digestType),
      headline,
      minutes,
      ...(byline ? { byline } : {}),
      tone:
        TONE_BY_DIGEST_TYPE[digest.digestType] ??
        TONE_BY_DOC_TYPE[digest.legalDocument?.documentType ?? ''] ??
        'warm',
    };
  }

  private documentToFeedItem(
    doc: Prisma.LegalDocumentGetPayload<{
      select: {
        id: true;
        title: true;
        shortTitle: true;
        citationText: true;
        documentType: true;
        ponente: true;
        isPublished: true;
        createdAt: true;
        updatedAt: true;
      };
    }> & { ponente?: string | null },
  ): FeedItem {
    const headline = doc.shortTitle || doc.title;
    const byline = doc.ponente ?? doc.citationText ?? undefined;
    // Document body lives in legal_document_sections; we don't join here to
    // keep the feed query cheap. Use a fixed read-time placeholder per type
    // (articles ~6 min, outlines ~10 min) until we promote a sectionTokenSum
    // column.
    const minutes = doc.documentType === 'outline' ? 10 : 6;

    return {
      id: doc.id,
      kind: 'document',
      category: CATEGORY_BY_DOC_TYPE[doc.documentType] ?? doc.documentType.toUpperCase(),
      headline,
      minutes,
      ...(byline ? { byline } : {}),
      tone: TONE_BY_DOC_TYPE[doc.documentType] ?? 'warm',
    };
  }

  private categoryForDigest(digestType: string): string {
    const mapped = digestType.replace(/_/g, ' ').toUpperCase();
    return mapped === 'CASE DIGEST' ? 'CASE DIGEST' : mapped;
  }

  private estimateMinutes(text: string): number {
    if (!text) return 4;
    const words = text.trim().split(/\s+/).length;
    return Math.max(1, Math.round(words / READ_WPM));
  }
}

import type { PhotoTone } from '@/lib/design-tokens';

/**
 * Mirrors `BriefItem` / `FeedItem` on apps/api/src/modules/home/home.service.ts.
 * Kept in sync manually until we promote the home feed shape to
 * @libertasian/types.
 */
export interface HomeFeedItem {
  id: string;
  /** Discriminator: routes the tap to /digest/:id or /reader/:id. */
  kind: 'digest' | 'document';
  category: string;
  headline: string;
  minutes: number;
  byline?: string;
  tone?: PhotoTone;
}

export interface HomeFeed {
  todaysBrief: HomeFeedItem[];
  forYou: HomeFeedItem[];
  /** ISO-8601 timestamp; pass back as `?cursor=` for the next page. */
  nextCursor: string | null;
}

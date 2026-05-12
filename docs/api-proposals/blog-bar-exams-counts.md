# Blog + Bar Exams Count Endpoints (Proposal)

**Status:** Phase 3 — **not implementing in this PR.**

## Why

The shared `PublicHeader` / `PublicFooter` consolidated in
`fix/audit-public-chrome` could eventually surface light corpus-state copy
in the public nav or footer — e.g. "120 blog posts · 480 bar questions".
We do not want to bloat the public client bundle by shipping the full
listings just to compute a length, and we do not want to drive cache
behaviour off whatever pagination cursor the page happens to land on.

This proposal sketches a minimal counts API so any future surface that
needs those numbers can call cheap, cacheable endpoints instead.

## Endpoints

### `GET /api/v1/blog/count`

Returns the number of **published** blog posts. Drafts, scheduled posts,
and unlisted posts are excluded.

**Response**

```json
{
  "count": 120
}
```

### `GET /api/v1/bar-exams/count`

Returns the number of bar exam **questions** loaded across all ingested
years. This matches the granularity already shown on
`apps/web/src/app/(public)/bar-exams/page.tsx` ("X subjects · Y questions").

**Response**

```json
{
  "count": 4823
}
```

## Auth + access control

- **Public, no auth.** These mirror data already visible at `/blog` and
  `/bar-exams`. No tenant scoping is required because neither resource is
  organization-scoped.
- Rate-limited via the existing "General API" bucket in `CLAUDE.md`
  (300 req / 1 min per user) — counts will normally be served from cache
  and shouldn't approach the limit.

## Caching

- **Server cache:** Redis under `cache:public-counts:blog` and
  `cache:public-counts:bar-exams`, **TTL = 5 minutes**.
- **HTTP cache:** `Cache-Control: public, max-age=60, s-maxage=300` so the
  CDN edge can absorb load even when Redis is cold.
- Invalidation: opportunistic — the 5-minute TTL is acceptable lag for
  marketing copy. If a downstream consumer ever needs tighter accuracy,
  the publisher pipeline can `DEL` the key when a post / exam is
  published.

## Out of scope (for this proposal)

- Per-tag or per-year breakdowns — those would belong on the listing
  endpoints with a `?include=count` shape, not as separate routes.
- Real-time accuracy (Server-Sent Events, websockets). 5-minute lag is
  fine for the surfaces this is designed for.
- Mobile parity. If mobile ever wants these counts, it goes through the
  same NestJS gateway like every other client per `CLAUDE.md` rule #1.

## Implementation note (Phase 3)

Both counts are a single `SELECT COUNT(*)` against `legal_documents` with
the appropriate filter (`document_type='blog_post' AND visibility='public'`
for blog; `document_type='bar_exam_question'` for bar exams). They sit
naturally next to the existing `/blog` and `/bar-exams` controllers in
`apps/api/`.

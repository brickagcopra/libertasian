# LIBERTASIAN — User Behavior Monitoring System Implementation Prompt

Use this prompt with Claude Code or Claude in your local development environment.

---

## THE PROMPT

```
I need you to implement an advanced user behavior monitoring and analytics system for LIBERTASIAN, a Philippine legal AI platform (NestJS 11 + Next.js 15 + React Native/Expo + Python/FastAPI). The project is already in development with most features built. The monorepo is at /libertasian with apps/api (NestJS), apps/web (Next.js), apps/mobile (React Native/Expo), and services/* (Python).

Read CLAUDE.md, the PRD, and PDD first to understand the full architecture, then implement the following.

---

## 1. ANALYTICS EVENT SYSTEM (Backend — NestJS)

### 1.1 Event Schema & Storage

Create a new `analytics` module in `apps/api/src/modules/analytics/`. Design and implement:

**PostgreSQL tables via Prisma migration:**

- `analytics_events` — the core event log table:
  - id (UUID), event_name (VARCHAR 100, indexed), event_category (VARCHAR 50, indexed — values: search, ai_answer, digest, scan, study, workspace, auth, billing, navigation, admin), user_id (UUID nullable FK), organization_id (UUID nullable FK), session_id (VARCHAR 100, indexed), device_type (VARCHAR 20 — web, ios, android), properties (JSONB — flexible payload), metadata (JSONB — user_agent, ip_hash, app_version, screen_resolution), duration_ms (INTEGER nullable), created_at (TIMESTAMPTZ, indexed, partitioned monthly)
  - Partition this table by month on `created_at` using Prisma raw SQL migration since Prisma doesn't natively support partitioning. Create a function that auto-creates monthly partitions.

- `analytics_sessions` — session tracking:
  - id (VARCHAR 100 PK), user_id (UUID nullable FK), organization_id (UUID nullable FK), device_type (VARCHAR 20), started_at (TIMESTAMPTZ), ended_at (TIMESTAMPTZ nullable), duration_seconds (INTEGER nullable), page_count (INTEGER DEFAULT 0), event_count (INTEGER DEFAULT 0), entry_path (VARCHAR 500), exit_path (VARCHAR 500 nullable), referrer (VARCHAR 500 nullable), properties (JSONB — plan_code, role, geo_country)

- `analytics_daily_aggregates` — pre-computed daily rollups (materialized by a cron job, NOT computed on read):
  - id (UUID), date (DATE, indexed), metric_name (VARCHAR 100, indexed — e.g., 'dau', 'searches', 'ai_answers', 'digests_generated', 'scans_completed'), dimension (VARCHAR 100 nullable — e.g., 'plan:pro', 'device:ios', 'subject:criminal'), metric_value (BIGINT), unique_users (INTEGER), organization_id (UUID nullable — null means platform-wide), created_at (TIMESTAMPTZ)
  - Composite unique index on (date, metric_name, dimension, organization_id)

- `analytics_funnel_steps` — funnel tracking snapshots:
  - id (UUID), funnel_name (VARCHAR 100), step_name (VARCHAR 100), step_order (INTEGER), date (DATE), entered_count (INTEGER), completed_count (INTEGER), dropped_count (INTEGER), median_time_seconds (INTEGER nullable)

**Implementation details:**
- Use append-only writes. The NestJS app role must NOT have UPDATE/DELETE on analytics_events.
- Hash IP addresses before storing (SHA-256 truncated to 8 chars) — never store raw IPs.
- Strip PII from properties — no emails, names, or phone numbers in event payloads.
- All event writes go through a BullMQ queue (`analytics:events`) for async, non-blocking ingestion. The API endpoint returns immediately. A dedicated worker processes the queue in batches of 100.

### 1.2 Event Taxonomy

Implement these exact event names with their required properties. Use verb_object naming (snake_case):

**Search & Research:**
- `search_executed` — { query_length, filter_count, search_type: 'natural_language' | 'citation' | 'metadata', result_count, has_zero_results: boolean }
- `search_result_clicked` — { result_position, document_type, document_id, relevance_score }
- `search_refined` — { original_query_hash, refinement_type: 'filter_added' | 'query_modified' | 'pagination' }
- `search_abandoned` — { query_length, time_on_results_ms, results_viewed_count }

**AI Answers:**
- `ai_answer_requested` — { query_length, mode: 'alac' | 'irac' | 'concise' | 'freeform' | 'bar_exam', intent_class }
- `ai_answer_received` — { response_time_ms, citation_count, confidence_level: 'high' | 'medium' | 'low', abstained: boolean, token_count }
- `ai_answer_citation_clicked` — { citation_type: 'case' | 'statute' | 'rule', document_id }
- `ai_answer_feedback` — { rating: 'helpful' | 'not_helpful' | 'inaccurate' | 'hallucination_report', feedback_text_length }
- `ai_answer_copied` — { content_length, section: 'full' | 'citation_only' | 'partial' }

**Digests:**
- `digest_generated` — { source_origin: 'official_pipeline' | 'user_scan' | 'user_upload', document_type, confidence_score, generation_time_ms }
- `digest_viewed` — { digest_id, view_duration_ms, scroll_depth_percent }
- `digest_saved` — { digest_type, visibility, linked_to_matter: boolean }
- `digest_exported` — { format: 'pdf' | 'docx' | 'clipboard' }
- `digest_reviewed` — { verdict: 'approve' | 'reject' | 'revise', reviewer_role }

**Camera Scan (Mobile):**
- `scan_started` — { capture_mode: 'single_page' | 'multi_page' | 'book_scan' }
- `scan_captured` — { page_count, quality_score, device_platform }
- `scan_ocr_completed` — { text_length, ocr_confidence, processing_time_ms }
- `scan_digest_generated` — { entitled: boolean, prompted_upgrade: boolean, confidence_score }
- `scan_saved` — { privacy_level, linked_to_matter: boolean }
- `scan_retake` — { reason: 'low_quality' | 'user_initiated' | 'crop_failed' }

**Study Mode:**
- `codal_opened` — { subject_area, codal_name }
- `codal_section_viewed` — { section_id, view_duration_ms, is_offline: boolean }
- `reviewer_pack_started` — { pack_id, subject_area }
- `flashcard_session_started` — { card_count, subject_area, source: 'auto_generated' | 'custom' }
- `flashcard_answered` — { correct: boolean, time_to_answer_ms, difficulty_rating }
- `study_session_completed` — { duration_minutes, cards_reviewed, sections_read, subject_area }

**Workspace:**
- `matter_created` — { matter_type, has_description: boolean }
- `matter_document_attached` — { document_source: 'corpus' | 'upload' | 'scan', role }
- `note_created` — { word_count, linked_to_matter: boolean }
- `bookmark_created` — { document_type, has_note: boolean }
- `annotation_created` — { color, text_length }
- `collaboration_action` — { action: 'comment' | 'share' | 'assign_task', target_type }

**Auth & Lifecycle:**
- `user_signed_up` — { method: 'email' | 'google', referrer }
- `user_logged_in` — { method, device_type, mfa_used: boolean }
- `user_activated` — { activation_event: 'first_search' | 'first_ai_answer' | 'first_digest_save', time_to_activate_hours }
- `subscription_started` — { plan_code, billing_period, source_page }
- `subscription_upgraded` — { from_plan, to_plan, trigger: 'paywall' | 'settings' | 'promo' }
- `subscription_cancelled` — { plan_code, reason_category, tenure_days }
- `subscription_churned` — { plan_code, last_active_days_ago, lifetime_value }

**Navigation & Engagement:**
- `page_viewed` — { path, referrer_path, load_time_ms }
- `feature_discovered` — { feature_name, discovery_method: 'navigation' | 'search' | 'onboarding' | 'upsell_prompt' }
- `paywall_hit` — { feature_attempted, current_plan, cta_shown }
- `paywall_converted` — { feature_attempted, time_on_paywall_seconds }

**Document Reader:**
- `document_opened` — { document_type, document_id, source: 'search' | 'digest_link' | 'bookmark' | 'matter' | 'direct' }
- `document_read_time` — { document_id, read_duration_ms, scroll_depth_percent, sections_viewed_count }
- `document_citation_followed` — { from_document_id, to_document_id, citation_type }

**Admin/Ingestion (internal):**
- `ingestion_job_completed` — { source_name, job_type, records_created, records_updated, duration_ms, error_count }
- `editorial_review_completed` — { verdict, document_type, review_duration_ms }

### 1.3 Tracking Service

Create `AnalyticsService` in NestJS with:

```typescript
// Core tracking method — all events flow through this
async track(event: AnalyticsEvent): Promise<void>
// Enqueues to BullMQ, never blocks the request

// Session management
async startSession(sessionData: SessionStart): Promise<string>
async endSession(sessionId: string): Promise<void>
async heartbeat(sessionId: string): Promise<void>
// Sessions auto-expire after 30 min of no heartbeat

// Batch tracking for mobile (mobile sends events in batches)
async trackBatch(events: AnalyticsEvent[]): Promise<void>
```

Create a `@TrackEvent()` decorator for NestJS controllers that auto-tracks common events:
```typescript
@TrackEvent('search_executed', (req, res) => ({
  query_length: req.body.query?.length,
  result_count: res.data?.results?.length,
}))
@Post('search')
async search(@Body() dto: SearchDto) { ... }
```

Create a NestJS interceptor `AnalyticsInterceptor` that auto-tracks `page_viewed` with response timing for all GET requests to non-API routes.

### 1.4 API Endpoints

```
POST   /api/v1/analytics/events          — single event (web/mobile)
POST   /api/v1/analytics/events/batch    — batch events (mobile offline sync)
POST   /api/v1/analytics/sessions/start  — start session
POST   /api/v1/analytics/sessions/heartbeat — session keepalive
POST   /api/v1/analytics/sessions/end    — end session
```

Rate limit: 100 events/minute per user, 500 events/minute per IP for unauthenticated.
Validate all event_name values against the taxonomy whitelist. Reject unknown events.

---

## 2. CLIENT-SIDE TRACKING (Web + Mobile)

### 2.1 Web (Next.js)

Create `apps/web/src/lib/analytics.ts` — a thin tracking client:

- `track(eventName, properties)` — sends to `/api/v1/analytics/events`
- `identify(userId, traits)` — associates anonymous session with authenticated user
- `startSession()` / `endSession()` — lifecycle management
- `trackPageView(path, loadTimeMs)` — auto-called via Next.js App Router layout

Create a React context provider `<AnalyticsProvider>` that:
- Auto-generates a session ID (UUID) and stores in sessionStorage
- Sends heartbeat every 60 seconds while tab is active
- Ends session on `beforeunload` or tab hidden for >30 min
- Auto-tracks `page_viewed` on every route change via `usePathname()`
- Tracks `document.visibilitychange` for accurate time-on-page
- Buffers events in memory and flushes every 5 seconds or on page unload (using `navigator.sendBeacon`)
- Respects user privacy: check for a `analytics_opt_out` flag in localStorage

Create hooks:
- `useTrack()` — returns `track` function with session context auto-injected
- `useTrackTiming(eventName)` — returns `startTimer` / `stopTimer` for duration tracking
- `useTrackVisibility(ref, eventName)` — tracks when an element enters viewport (for scroll depth, section visibility)

### 2.2 Mobile (React Native/Expo)

Create `apps/mobile/src/lib/analytics.ts`:

- Same API surface as web but with offline buffering:
  - Queue events in MMKV when offline
  - Flush queue via batch endpoint when connectivity returns (use `@react-native-community/netinfo`)
  - Max offline buffer: 1000 events, FIFO eviction after that
- Session management using AppState listener (active/background/inactive)
  - Start session on `active`, end on `background` after 5 min
- Auto-track: app_opened, app_backgrounded, app_foregrounded
- Camera scan events tracked with device_platform and capture_quality_score

---

## 3. AGGREGATION WORKER (Backend)

### 3.1 Daily Aggregation Cron Job

Create a Celery task (or BullMQ repeatable job) `aggregate_daily_metrics` that runs at 02:00 UTC daily:

Compute and write to `analytics_daily_aggregates`:

**Engagement metrics (platform-wide + per-org):**
- `dau` — distinct users with ≥1 event, dimensions: plan, device_type, role
- `mau` — distinct users in trailing 30 days (only on 1st of month or on-demand)
- `wau` — distinct users in trailing 7 days
- `sessions` — total sessions, dimensions: device_type
- `avg_session_duration_seconds` — mean session length, dimensions: device_type, plan
- `avg_events_per_session` — mean events, dimensions: device_type

**Search & AI metrics:**
- `searches` — total search_executed, dimensions: search_type, device_type
- `search_zero_result_rate` — % of searches with has_zero_results=true
- `search_click_through_rate` — % of searches followed by search_result_clicked
- `search_mean_position_clicked` — avg result_position of clicked results
- `ai_answers` — total ai_answer_requested, dimensions: mode, intent_class
- `ai_answer_avg_response_time_ms` — mean response_time_ms
- `ai_answer_abstention_rate` — % with abstained=true
- `ai_answer_helpful_rate` — % of ai_answer_feedback with rating='helpful' out of all feedback
- `ai_answer_hallucination_reports` — count of rating='hallucination_report'

**Digest metrics:**
- `digests_generated` — total, dimensions: source_origin, document_type
- `digests_saved` — total digest_saved events
- `digest_avg_confidence` — mean confidence_score
- `digest_review_queue_depth` — count of digests with review_status='needs_human_review'

**Scan metrics (mobile):**
- `scans_started` — total scan_started
- `scans_completed` — total scan_saved (scan funnel completion)
- `scan_success_rate` — scans_completed / scans_started
- `scan_avg_quality` — mean quality_score from scan_captured
- `scan_upgrade_prompts` — count where prompted_upgrade=true
- `scan_upgrade_conversions` — count of subscription_upgraded within 24h of paywall_hit where feature_attempted contains 'scan'

**Study metrics:**
- `study_sessions` — total study_session_completed, dimensions: subject_area
- `flashcard_sessions` — total flashcard_session_started
- `flashcard_accuracy` — % of flashcard_answered with correct=true
- `codal_views` — total codal_opened, dimensions: subject_area
- `offline_usage` — count of events with is_offline=true

**Workspace metrics:**
- `matters_created` — total
- `documents_attached` — total, dimensions: document_source
- `notes_created` — total
- `collaboration_actions` — total, dimensions: action

**Revenue/Subscription metrics:**
- `new_subscriptions` — total subscription_started, dimensions: plan_code
- `upgrades` — total subscription_upgraded
- `cancellations` — total subscription_cancelled, dimensions: reason_category
- `churns` — total subscription_churned
- `paywall_conversion_rate` — paywall_converted / paywall_hit

**Ingestion/Quality metrics (admin-only):**
- `documents_ingested` — sum of records_created from ingestion_job_completed
- `ingestion_errors` — sum of error_count
- `editorial_reviews` — total editorial_review_completed, dimensions: verdict
- `avg_review_time_ms` — mean review_duration_ms

### 3.2 Funnel Computation

Compute these funnels daily and write to `analytics_funnel_steps`:

**Signup-to-Activation Funnel:**
1. user_signed_up → 2. first page_viewed (dashboard) → 3. first search_executed → 4. first ai_answer_requested → 5. first digest_saved or bookmark_created

**Free-to-Paid Funnel:**
1. user_signed_up (free) → 2. paywall_hit → 3. paywall_converted → 4. subscription_started

**Scan-to-Digest Funnel (Mobile):**
1. scan_started → 2. scan_captured → 3. scan_ocr_completed → 4. scan_digest_generated → 5. scan_saved

**Search-to-Answer Funnel:**
1. search_executed → 2. search_result_clicked → 3. document_opened → 4. ai_answer_requested → 5. ai_answer_feedback (helpful)

For each funnel, compute: entered_count, completed_count, dropped_count, and median_time_seconds between steps.

### 3.3 Retention Cohort Computation

Create a weekly job `compute_retention_cohorts` that calculates:
- Group users by signup week (cohort)
- For each cohort, compute what % returned in week 1, 2, 3, ..., 12
- "Return" = had ≥1 event that week
- Store as JSONB in a `analytics_retention_cohorts` table: cohort_week (DATE), retention_week (INTEGER), user_count (INTEGER), returning_count (INTEGER), retention_rate (REAL)
- Also compute by plan segment (free, edu, pro, team)

---

## 4. ADMIN ANALYTICS DASHBOARD (Web — Next.js)

Build the dashboard at `apps/web/src/app/(dashboard)/admin/analytics/`. This is restricted to users with 'owner' or 'admin' role.

### 4.1 Dashboard API Endpoints (NestJS)

```
GET /api/v1/admin/analytics/overview          — key metrics summary
GET /api/v1/admin/analytics/engagement        — DAU/WAU/MAU, sessions, time-on-platform
GET /api/v1/admin/analytics/search            — search quality metrics
GET /api/v1/admin/analytics/ai                — AI answer quality metrics
GET /api/v1/admin/analytics/digests           — digest pipeline metrics
GET /api/v1/admin/analytics/scans             — camera scan funnel + metrics
GET /api/v1/admin/analytics/study             — study mode engagement
GET /api/v1/admin/analytics/workspace         — workspace adoption
GET /api/v1/admin/analytics/revenue           — subscription + revenue metrics
GET /api/v1/admin/analytics/funnels/:name     — specific funnel data
GET /api/v1/admin/analytics/retention         — retention cohort matrix
GET /api/v1/admin/analytics/ingestion         — corpus health + ingestion metrics
GET /api/v1/admin/analytics/realtime          — live event stream (last 5 min, via SSE)
```

All endpoints accept `?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|week|month&dimension=plan|device|subject` query params. They read from `analytics_daily_aggregates` (pre-computed), NOT from raw events. Fast.

### 4.2 Dashboard Pages

Use Recharts for all charts. Use shadcn/ui Card, Table, Tabs, Select, DateRangePicker components. Use TanStack Query for data fetching with 5-minute stale time.

**Page 1: Overview Dashboard** (`/admin/analytics`)
Top row — 6 KPI cards with sparklines and % change vs prior period:
  - DAU, WAU, MAU
  - Total AI Answers (today)
  - Total Searches (today)
  - Paid Subscribers (current)

Second row — 2 charts side by side:
  - Line chart: DAU/WAU/MAU trend over selected date range (toggle between them)
  - Bar chart: Events by category breakdown (search, ai_answer, digest, scan, study, workspace)

Third row — 2 charts:
  - Stacked area chart: Sessions by device type (web, ios, android) over time
  - Horizontal bar chart: Top 10 most-used features (by event count)

Bottom row — Alerts panel:
  - Hallucination reports in last 24h (count, red if > 0)
  - AI abstention rate trend (warn if > 20%)
  - Zero-result search rate trend (warn if > 15%)
  - Ingestion error count (last 24h)
  - Review queue depth

**Page 2: Search & AI Quality** (`/admin/analytics/search-ai`)
Top metrics row:
  - Searches/day trend
  - Zero-result rate (%) with trendline
  - Click-through rate (%)
  - Mean result position clicked

AI section:
  - AI answers/day trend
  - Avg response time (ms) trendline — alert threshold at 8000ms
  - Abstention rate (%) trendline
  - Confidence level distribution (pie chart: high/medium/low)
  - Helpful rate (% of feedback that is 'helpful')
  - Hallucination reports timeline (bar chart, red bars)

Table: Recent hallucination reports (last 50) with: timestamp, user (anonymized), query preview, reported answer preview — clickable to view full detail.

**Page 3: Conversion & Revenue** (`/admin/analytics/revenue`)
Revenue metrics:
  - MRR (computed from active subscriptions × plan price)
  - Subscriber count by plan (stacked bar)
  - New subscriptions/day trend
  - Upgrade/downgrade/cancellation trend lines
  - Churn rate (%) — monthly rolling

Funnels (visualized as horizontal funnel charts with step labels and drop-off %):
  - Signup-to-Activation funnel
  - Free-to-Paid funnel
  - Show conversion rate and median time between each step

Paywall analytics:
  - Paywall hits by feature (bar chart — which features drive the most upgrade prompts)
  - Paywall conversion rate trend
  - Top converting features

**Page 4: Retention** (`/admin/analytics/retention`)
Retention cohort heatmap matrix:
  - Rows = signup cohort week
  - Columns = week 0, 1, 2, ..., 12
  - Cell color intensity = retention % (green gradient)
  - Cell value = retention % number
  - Filter by plan segment (All, Free, Edu, Pro, Team)

Below the heatmap:
  - Line chart overlay: retention curves for last 4 cohorts
  - Benchmark line at industry average (25% week-4 retention for SaaS)

**Page 5: Mobile & Scan** (`/admin/analytics/mobile`)
Scan funnel visualization (vertical funnel):
  - scan_started → scan_captured → scan_ocr_completed → scan_digest_generated → scan_saved
  - Show drop-off % at each step

Metrics:
  - Scans/day trend (by device_platform)
  - Average quality score trend
  - OCR confidence distribution (histogram)
  - Retake rate (scan_retake / scan_captured)
  - Upgrade prompt → conversion rate (from scan paywall)

Mobile engagement:
  - Mobile DAU trend
  - Offline usage % (events with is_offline=true / total mobile events)
  - Session duration mobile vs web comparison
  - Top mobile features by usage

**Page 6: Study Mode** (`/admin/analytics/study`)
Metrics:
  - Study sessions/day
  - Flashcard sessions/day
  - Flashcard accuracy rate trend
  - Codal views by subject area (horizontal stacked bar)
  - Average study session duration trend
  - Offline study % trend

Subject area heatmap:
  - Rows = bar subject areas
  - Columns = days of week
  - Cell value = codal views + study sessions (combined usage intensity)

**Page 7: Corpus & Ingestion Health** (`/admin/analytics/corpus`)
Metrics:
  - Documents ingested/day trend
  - Ingestion error rate trend
  - Review queue depth over time
  - Average review time trend
  - Editorial review verdicts distribution (pie: approve/reject/revise)

Corpus coverage:
  - Documents by type (bar chart)
  - Documents by source (bar chart)
  - Documents by year range (histogram — shows temporal coverage gaps)
  - Stale sources alert (sources not fetched in > 7 days)

**Page 8: Real-time** (`/admin/analytics/realtime`)
Live dashboard using SSE from `/api/v1/admin/analytics/realtime`:
  - Live event stream (scrolling feed of last 100 events, anonymized)
  - Current active sessions count (updated every 10s)
  - Events/minute gauge
  - Searches/minute gauge
  - AI answers in-flight count
  - Geographic distribution of active sessions (if geo data available from IP hash lookup)

### 4.3 Organization-Level Analytics

For Team/Firm/Enterprise plan users, expose a subset of analytics at the org level under `/dashboard/settings/analytics`:
  - Org DAU/MAU
  - Searches, AI answers, digests by team member (anonymized or named based on org admin preference)
  - Feature usage breakdown for the org
  - Storage usage (uploads, scans)
  - Quota usage vs plan limits

This reuses the same aggregation tables filtered by organization_id.

---

## 5. IMPLEMENTATION REQUIREMENTS

### 5.1 Performance

- Event ingestion endpoint must respond in <50ms (just enqueue, don't process synchronously).
- Dashboard API endpoints must respond in <500ms by reading only from pre-aggregated tables.
- Never query raw `analytics_events` table in dashboard API calls. Use `analytics_daily_aggregates` and `analytics_funnel_steps`.
- Aggregation cron job should complete in <5 minutes for up to 1M daily events.
- Use Redis to cache dashboard query results for 5 minutes.

### 5.2 Privacy & Compliance

- Hash all IPs before storage (SHA-256, truncated).
- Strip PII from all event properties — no emails, names, phone numbers.
- Anonymize user identifiers in the real-time feed and admin-facing tables (show user_id prefix only, e.g., "usr_a1b2...").
- Respect analytics_opt_out flag — if set, emit no events for that user.
- Retention: auto-delete raw analytics_events older than 90 days. Keep aggregates indefinitely.
- Add to privacy policy: describe analytics data collection, purpose, and retention.

### 5.3 Security

- Dashboard endpoints restricted to admin/owner roles via RolesGuard.
- Event ingestion endpoints require valid JWT OR rate-limited anonymous access (for pre-auth tracking).
- Event taxonomy is whitelisted — reject events with unknown event_name values.
- Properties are validated — reject events with properties exceeding 10KB.
- No server-side tracking of exact search queries in analytics — only query_length and query_hash for correlation. Store full queries only in the existing search history feature.

### 5.4 Testing

- Unit tests for AnalyticsService (event validation, batching, session management).
- Unit tests for aggregation logic (given N events, assert correct aggregate values).
- Integration test: track events → run aggregation → query dashboard API → assert response shape.
- E2E test: simulate user journey (signup → search → AI answer → digest save) → verify funnel computation.

### 5.5 File Structure

Place new code in:
```
apps/api/src/modules/analytics/
├── analytics.module.ts
├── analytics.controller.ts        # event ingestion endpoints
├── analytics.service.ts           # core tracking service
├── analytics-dashboard.controller.ts  # admin dashboard endpoints
├── analytics-dashboard.service.ts     # dashboard query service
├── analytics-aggregation.service.ts   # daily aggregation logic
├── analytics-retention.service.ts     # cohort computation
├── analytics.processor.ts         # BullMQ worker for event processing
├── decorators/
│   └── track-event.decorator.ts
├── interceptors/
│   └── analytics.interceptor.ts
├── dto/
│   ├── track-event.dto.ts
│   ├── dashboard-query.dto.ts
│   └── session.dto.ts
├── entities/                       # Prisma-generated or manual types
└── constants/
    └── event-taxonomy.ts           # whitelist of valid event names + required properties

apps/web/src/lib/analytics.ts               # web tracking client
apps/web/src/providers/analytics-provider.tsx  # React context
apps/web/src/hooks/use-track.ts
apps/web/src/hooks/use-track-timing.ts
apps/web/src/hooks/use-track-visibility.ts
apps/web/src/app/(dashboard)/admin/analytics/
├── page.tsx                        # Overview dashboard
├── search-ai/page.tsx
├── revenue/page.tsx
├── retention/page.tsx
├── mobile/page.tsx
├── study/page.tsx
├── corpus/page.tsx
├── realtime/page.tsx
└── components/
    ├── kpi-card.tsx
    ├── trend-chart.tsx
    ├── funnel-chart.tsx
    ├── retention-heatmap.tsx
    ├── event-feed.tsx
    └── date-range-picker.tsx

apps/mobile/src/lib/analytics.ts            # mobile tracking client
```

### 5.6 Prisma Migration

Add all new tables to schema.prisma and create a migration. For the partitioned analytics_events table, use a raw SQL migration since Prisma doesn't support native partitioning — create the parent table, partition function, and trigger that auto-creates monthly partition tables.

---

Start by reading the existing codebase structure, then implement in this order:
1. Prisma schema + migration (tables)
2. Event taxonomy constants
3. AnalyticsService + BullMQ processor
4. Event ingestion API endpoints
5. Daily aggregation service + cron
6. Retention cohort computation
7. Dashboard API endpoints
8. Web tracking client + provider + hooks
9. Mobile tracking client
10. Dashboard UI pages (one at a time, Overview first)
11. Add @TrackEvent decorators to existing controllers
12. Tests
```

---

## USAGE NOTES

- Copy everything between the triple backticks above and paste it as a single prompt to Claude Code or Claude chat with computer use.
- If your local Claude has access to the codebase, it will read the existing files and integrate the analytics system into the existing module structure.
- The prompt is self-contained — it references the CLAUDE.md conventions (NestJS guards, Prisma patterns, shadcn/ui, Recharts, BullMQ) already established in the project.
- For very large codebases, you may want to split the implementation into multiple sessions: (1) backend schema + service, (2) aggregation + dashboard API, (3) client tracking, (4) dashboard UI.

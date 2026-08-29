import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import * as Joi from 'joi';

import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { AttachDisclaimerInterceptor } from './common/interceptors/attach-disclaimer.interceptor';
import { RedisModule } from './common/services/redis.module';
import { ContentDisclaimersModule } from './modules/content-disclaimers/content-disclaimers.module';
import { DerivativeArtifactModule } from './modules/derivative-artifact/derivative-artifact.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AccountDeletionModule } from './modules/account-deletion/account-deletion.module';
import { AiAnswersModule } from './modules/ai-answers/ai-answers.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookmarksModule } from './modules/bookmarks/bookmarks.module';
import { CaseComparisonsModule } from './modules/case-comparisons/case-comparisons.module';
import { CommunityModule } from './modules/community/community.module';
import { ContradictionsModule } from './modules/contradictions/contradictions.module';
import { HearingPrepModule } from './modules/hearing-prep/hearing-prep.module';
import { DigestsModule } from './modules/digests/digests.module';
import { DoctrinesModule } from './modules/doctrines/doctrines.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { DuplicatesModule } from './modules/duplicates/duplicates.module';
import { HealthModule } from './modules/health/health.module';
import { KnowledgeGraphModule } from './modules/knowledge-graph/knowledge-graph.module';
import { MemosModule } from './modules/memos/memos.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PleadingsModule } from './modules/pleadings/pleadings.module';
import { ResearchWorkspacesModule } from './modules/research-workspaces/research-workspaces.module';
import { TimelinesModule } from './modules/timelines/timelines.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { SearchModule } from './modules/search/search.module';
import { SourcesModule } from './modules/sources/sources.module';
import { StudyModule } from './modules/study/study.module';
import { SubjectsModule } from './modules/subjects/subjects.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { BillingModule } from './modules/billing/billing.module';
import { StorePurchasesModule } from './modules/store-purchases/store-purchases.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { ExportsModule } from './modules/exports/exports.module';
import { ExternalApiModule } from './modules/external-api/external-api.module';
import { AdsModule } from './modules/ads/ads.module';
import { BlogModule } from './modules/blog/blog.module';
import { FeedModule } from './modules/feed/feed.module';
import { HomeModule } from './modules/home/home.module';
import { SimulatorModule } from './modules/simulator/simulator.module';
import { SiteContentModule } from './modules/site-content/site-content.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { PlansModule } from './modules/plans/plans.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { AiSettingsModule } from './modules/ai-settings/ai-settings.module';
import { AdminPipelineOpsModule } from './modules/admin-pipeline-ops/admin-pipeline-ops.module';
import { BackfillModule } from './modules/backfill/backfill.module';
import { BarExamsModule } from './modules/bar-exams/bar-exams.module';
import { GoldenSetsModule } from './modules/golden-sets/golden-sets.module';
import { DerivativesAdminModule } from './modules/derivatives-admin/derivatives-admin.module';
import { DerivativesModule } from './modules/derivatives/derivatives.module';
import { InternalModule } from './modules/internal/internal.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { AudioModule } from './modules/audio/audio.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueryProfilerMiddleware } from './prisma/query-profiler.middleware';

@Module({
  imports: [
    // Configuration with validation
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        // 'test' is accepted so the e2e suite can boot the real AppModule
        // under CI's NODE_ENV=test. Every NODE_ENV branch in this app tests
        // for 'production' or 'development' explicitly, so 'test' behaves as
        // a non-production, non-development environment throughout.
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'staging', 'production')
          .default('development'),
        APP_PORT: Joi.number().default(3001),
        APP_URL: Joi.string().default('http://localhost:3000'),
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().default('redis://localhost:6379/0'),
        JWT_SECRET: Joi.string().default('dev-secret-change-in-production'),
        JWT_PRIVATE_KEY_PATH: Joi.string().optional().allow(''),
        JWT_PUBLIC_KEY_PATH: Joi.string().optional().allow(''),
        JWT_PRIVATE_KEY: Joi.string().optional().allow(''),
        JWT_PUBLIC_KEY: Joi.string().optional().allow(''),
        JWT_ACCESS_TTL: Joi.number().default(900),
        JWT_REFRESH_TTL: Joi.number().default(604800),
        // Two-layer brute-force protection (LoginThrottleService) — failures-only,
        // per-account + per-IP velocity. All optional with NAT-safe defaults.
        AUTH_LOCK_ACCOUNT_THRESHOLD: Joi.number().default(10),
        AUTH_LOCK_IP_THRESHOLD: Joi.number().default(100),
        AUTH_LOCK_WINDOW_SEC: Joi.number().default(900),
        AUTH_LOCK_MAX_MIN: Joi.number().default(30),
        // Google OAuth (optional — enable by setting client ID and secret)
        GOOGLE_CLIENT_ID: Joi.string().optional().allow(''),
        GOOGLE_CLIENT_SECRET: Joi.string().optional().allow(''),
        GOOGLE_CALLBACK_URL: Joi.string().default('http://localhost:3001/api/v1/auth/google/callback'),
        // Mobile social login (ID-token exchange). Google iOS/Android client
        // IDs extend the audience allowlist for POST /auth/google/mobile;
        // APPLE_BUNDLE_ID is the audience for Apple identity tokens.
        GOOGLE_IOS_CLIENT_ID: Joi.string().optional().allow(''),
        GOOGLE_ANDROID_CLIENT_ID: Joi.string().optional().allow(''),
        APPLE_BUNDLE_ID: Joi.string().default('com.libertasian.app'),
        OPENSEARCH_URL: Joi.string().default('http://localhost:9200'),
        OPENSEARCH_USERNAME: Joi.string().optional().allow(''),
        OPENSEARCH_PASSWORD: Joi.string().optional().allow(''),
        // S3 / MinIO
        S3_ENDPOINT: Joi.string().default('http://localhost:9000'),
        S3_ACCESS_KEY: Joi.string().default('libertasian'),
        S3_SECRET_KEY: Joi.string().default('libertasian_dev_secret'),
        S3_BUCKET_UPLOADS: Joi.string().default('libertasian-uploads'),
        // Unset keeps the previously hardcoded 'us-east-1' (MinIO ignores it,
        // but SigV4 still signs it).
        S3_REGION: Joi.string().optional(),
        // OCR Service (Python)
        OCR_SERVICE_URL: Joi.string().default('http://localhost:8002'),
        // RAG Service (Python)
        RAG_SERVICE_URL: Joi.string().default('http://localhost:8000'),
        // SMTP (optional — falls back to log-only in dev)
        SMTP_HOST: Joi.string().optional().allow(''),
        SMTP_PORT: Joi.number().default(587),
        SMTP_USER: Joi.string().optional().allow(''),
        SMTP_PASS: Joi.string().optional().allow(''),
        SMTP_FROM: Joi.string().default('LIBERTASIAN <noreply@libertasian.com>'),
        // Billing — which gateway adapter BillingModule binds to PAYMENT_PROVIDER.
        PAYMENT_PROVIDER: Joi.string().valid('xendit', 'paymongo').default('xendit'),
        // Billing (Xendit)
        XENDIT_SECRET_KEY: Joi.string().default('xnd_development_change_me'),
        XENDIT_WEBHOOK_CALLBACK_TOKEN: Joi.string().default('callback_token_change_me'),
        // Store purchases (IAP) — which conduit StorePurchasesModule binds to
        // STORE_PURCHASE_PROVIDER. Unlike PAYMENT_PROVIDER this is NOT an
        // exclusive-or with the web gateway: both run at the same time, for
        // different subscribers.
        STORE_PURCHASE_CONDUIT: Joi.string().valid('revenuecat').default('revenuecat'),
        // The value RevenueCat echoes back in the `Authorization` header. NOT an
        // HMAC key — there is no signature over the body to recompute.
        //
        // THE DEFAULT IS THE EMPTY STRING AND MUST STAY THAT WAY. An unset
        // secret makes RevenueCatService.verifyWebhookAuthorization return
        // 'invalid' for every request, so the endpoint is CLOSED when
        // unconfigured. Any non-empty default here would be a shared, published
        // credential that lets an anonymous caller move a subscription.
        REVENUECAT_WEBHOOK_AUTH_TOKEN: Joi.string().allow('').default(''),
        // Secret API key for the §9 pull path. Empty disables the nightly
        // reconciliation sweep rather than failing it once per org per night.
        REVENUECAT_API_KEY: Joi.string().allow('').default(''),
        REVENUECAT_API_URL: Joi.string().default('https://api.revenuecat.com'),
        // Billing (PayMongo)
        PAYMONGO_SECRET_KEY: Joi.string().default('sk_test_change_me'),
        PAYMONGO_WEBHOOK_SECRET: Joi.string().default('whsk_test_change_me'),
        // Replay window for the Paymongo-Signature timestamp, in seconds.
        PAYMONGO_SIGNATURE_TOLERANCE_SEC: Joi.number().default(300),
        // Instruments offered on a one-off checkout session (CSV).
        PAYMONGO_PAYMENT_METHOD_TYPES: Joi.string().default('card,gcash,paymaya,grab_pay'),
        // ClamAV
        CLAMAV_HOST: Joi.string().default('localhost'),
        CLAMAV_PORT: Joi.number().default(3310),
        CLAMAV_TIMEOUT: Joi.number().default(30000),
        CLAMAV_ENABLED: Joi.string().valid('true', 'false').default('true'),
        // Internal service-to-service API key (worker-service → NestJS)
        INTERNAL_API_KEY: Joi.string().default(''),
        // Feature flag — controls the /derivatives public (student-facing)
        // endpoints. Disabled by default; flip to 'true' in staging/prod once
        // editorial has approved a baseline batch of derivatives.
        FEATURE_DERIVATIVES_PUBLIC: Joi.string().valid('true', 'false').default('false'),
        // Feature flag — controls the public read surface for approved bar
        // exam ALAC answers. Disabled by default; flip to 'true' once a
        // baseline batch of answers has been approved by editorial.
        FEATURE_BAR_EXAM_ANSWERS_PUBLIC: Joi.string().valid('true', 'false').default('false'),
        // Kill switch for every paid-tier gate in the API. Prod runs `false`
        // while no payment gateway is live: with no purchasable tier, a 402
        // subscription_required is an unfulfillable demand for payment, which
        // is what got iOS build 23 rejected under App Review 3.1.1.
        //
        // THE DEFAULT IS `false` BECAUSE THE SAFE DIRECTION MUST BE THE DEFAULT
        // DIRECTION. It used to be `true`, which meant production was compliant
        // only for as long as one line survived in one .env file. Lose that line
        // — a rebuilt environment, a new host, a deploy seeded from
        // .env.example, a container that comes up without the var — and the
        // paywall switches itself on, server-side, instantly, for every
        // installed copy of an ALREADY-APPROVED iOS binary that has no way to
        // buy anything. That is an app-removal path reachable by omission, with
        // no review gate anywhere in front of it.
        //
        // Enforcing the paywall is therefore a DELIBERATE ACT: it requires an
        // explicit `PAYWALL_ENFORCED=true` in the environment. Absence is not
        // consent. Set it on the day IAP ships, not before.
        //
        // Note that `isPaywallEnforced()` (common/config/paywall.ts) still
        // treats every non-`false` value as enforced, so a typo in an explicit
        // value cannot accidentally disable the paywall. The two rules compose:
        // an ABSENT var is off, a MALFORMED var is on.
        PAYWALL_ENFORCED: Joi.boolean().default(false),
        // Search dedup post-filter: when 'true' (default), excludes
        // non-canonical duplicate documents from search results via a
        // Redis-backed must_not.terms clause. Flip to 'false' to revert
        // instantly if the filter ever over-suppresses in prod.
        SEARCH_DEDUP_FILTER_ENABLED: Joi.string().valid('true', 'false').default('true'),
        // Bootstrap the OpenSearch alias → physical index topology at boot.
        // Never destructive: it only creates missing indices and refuses to
        // touch a concrete index squatting on an alias name (see
        // OpenSearchService.ensureIndexes). Flip to 'false' to opt out.
        SEARCH_AUTO_ENSURE_INDEXES: Joi.string().valid('true', 'false').default('true'),
        // Vector dimension the embedding service emits. BAAI/bge-small-en-v1.5
        // = 384. MUST match the model or the knn_vector field rejects writes.
        EMBEDDING_DIM: Joi.number().integer().min(1).max(4096).default(384),
        // Documents per PostgreSQL page during a full index rebuild.
        SEARCH_INDEX_REBUILD_BATCH_SIZE: Joi.number().integer().min(1).max(2000).default(500),
        // Ranking v2: tiered bool.should, native collapse, intent-aware
        // clauses. Flip to 'false' to restore the legacy single-fuzzy
        // multi_match builder without a code deploy (retained one release).
        SEARCH_RANKER_V2: Joi.string().valid('true', 'false').default('true'),
        // Deepest reachable result offset (page+1)*limit. Past this the API
        // returns 400 rather than letting OpenSearch 500 on max_result_window.
        SEARCH_MAX_WINDOW: Joi.number().integer().min(20).max(10000).default(1000),
        // RRF blends BM25 and kNN only within this offset; deeper pages
        // paginate lexically so ordering stays stable.
        SEARCH_FUSION_WINDOW: Joi.number().integer().min(10).max(1000).default(100),
        // Below this top score the response is flagged meta.abstained with
        // suggestions instead of presenting weak matches as answers.
        SEARCH_MIN_SCORE: Joi.number().min(0).default(1.0),
        // function_score multipliers (CLAUDE.md: official > semi-official >
        // editorial). Recency decay is deliberately mild — landmark cases are old.
        SEARCH_BOOST_OFFICIAL: Joi.number().min(0).default(1.2),
        SEARCH_BOOST_TRUST_OFFICIAL: Joi.number().min(0).default(1.3),
        SEARCH_BOOST_TRUST_SEMI_OFFICIAL: Joi.number().min(0).default(1.15),
        SEARCH_BOOST_TRUST_EDITORIAL: Joi.number().min(0).default(1.0),
        SEARCH_RECENCY_SCALE_DAYS: Joi.number().integer().min(1).default(3650),
        SEARCH_RECENCY_DECAY: Joi.number().min(0).max(1).default(0.6),
        SEARCH_RECENCY_WEIGHT: Joi.number().min(0).default(1.1),
        // Amazon Polly (Audio Corpus Phase 1). All optional so existing envs
        // keep booting; the default AWS provider chain is used when the
        // explicit access keys are absent (e.g. IAM role in prod).
        AWS_REGION: Joi.string().default('us-east-1'),
        AWS_ACCESS_KEY_ID: Joi.string().optional().allow(''),
        AWS_SECRET_ACCESS_KEY: Joi.string().optional().allow(''),
        // Default voice + engine must be consistent: 'Matthew' is a neural
        // voice that works with the default 'neural' engine.
        // Long-form voices (Gregory/Ruth/Danielle) require POLLY_ENGINE=long-form
        // — ~6× cost (~$100 vs ~$16 /1M chars).
        POLLY_VOICE_ID: Joi.string().default('Matthew'),
        POLLY_ENGINE: Joi.string()
          .valid('standard', 'neural', 'long-form', 'generative')
          .default('neural'),
        // Newscaster delivery (<amazon:domain name="news">) on the neural
        // engine. 'true' (default) wraps SSML for a news-anchor tone; 'false'
        // disables. Never applied on generative/long-form engines.
        POLLY_NEWSCASTER: Joi.string().valid('true', 'false').default('true'),
        // Self-hosted TTS. Defaults keep Polly active; flipping TTS_PROVIDER
        // to 'kokoro' is the single switch that changes backends.
        TTS_PROVIDER: Joi.string().valid('polly', 'kokoro').default('polly'),
        TTS_SERVICE_URL: Joi.string().default('http://tts-service:8003'),
        KOKORO_VOICE_ID: Joi.string().default('af_heart'),
        // Bearer token for the API → tts-service hop. OPTIONAL and unset in
        // prod, where the call never leaves the Docker network; both sides
        // no-op when it is absent, so this deploys with no coordination. It is
        // REQUIRED on both sides when the TTS host is remote (rented GPU),
        // because the endpoint is then reachable off-box.
        TTS_AUTH_TOKEN: Joi.string().optional().allow(''),
        // Wall-clock seconds per second of audio, the multiplier behind the
        // length-proportional synthesis timeout. Default 2.5 is prod's measured
        // CPU worst case with headroom; a GPU host should set ~0.25.
        KOKORO_REALTIME_FACTOR: Joi.number().positive().optional(),
        // Hard cap on one /synthesize call. Text whose budget exceeds it is
        // refused before the call rather than started and abandoned.
        KOKORO_TIMEOUT_CEILING_MS: Joi.number()
          .integer()
          .positive()
          .optional(),
        // Cap on the total mp3 bytes ONE synthesis may produce. Chunking bounds
        // how long a document may take, not how much audio it assembles in
        // memory; the largest codal encodes to ~350 MB against a 1,048 MB heap.
        // Defaults to 150 MiB in KokoroClient.
        KOKORO_MAX_OUTPUT_BYTES: Joi.number().integer().positive().optional(),
        // Reconciler. BOTH default false; tier 3 (decisions) requires BOTH.
        AUDIO_RECONCILER_ENABLED: Joi.string()
          .valid('true', 'false')
          .default('false'),
        AUDIO_RECONCILE_DECISIONS: Joi.string()
          .valid('true', 'false')
          .default('false'),
        AUDIO_RECONCILE_BATCH: Joi.number().integer().min(1).default(200),
        AUDIO_RECONCILE_DRY_RUN: Joi.string()
          .valid('true', 'false')
          .default('false'),
        AUDIO_STORAGE_PATH: Joi.string().default('/'),
        // Must not exceed TTS_WORKERS — see AudioGenerationProcessor.
        AUDIO_PROCESSOR_CONCURRENCY: Joi.number().integer().min(1).default(2),
        // Dedicated audio bucket (Cloudflare R2). NO DEFAULTS: leaving
        // AUDIO_S3_ENDPOINT unset makes AudioStorageService delegate to the
        // shared MinIO S3Service, which is the current behaviour everywhere.
        // Private uploads and camera scans never move off MinIO.
        AUDIO_S3_ENDPOINT: Joi.string().optional(),
        AUDIO_S3_ACCESS_KEY: Joi.string().optional(),
        AUDIO_S3_SECRET_KEY: Joi.string().optional(),
        AUDIO_S3_BUCKET: Joi.string().optional(),
        AUDIO_S3_REGION: Joi.string().optional(),
      }),
    }),

    // Event emitter for cross-module communication
    EventEmitterModule.forRoot(),

    // Cron scheduling for automated jobs (source health, etc.)
    ScheduleModule.forRoot(),

    // BullMQ for async jobs
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL'),
        },
      }),
    }),

    // Rate limiting — global default: 300 requests per minute per user/IP
    // Per-route overrides via @Throttle() decorator per CLAUDE.md specs:
    //   Auth routes: 10 req / 15 min per IP
    //   Admin routes: 100 req / min per user
    //   File uploads: 20 req / hour per user
    // Uses Redis storage for multi-node compatibility.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: 60000, // 1 minute window
            limit: 300, // 300 requests per minute (general API)
          },
        ],
        storage: new ThrottlerStorageRedisService(
          config.get<string>('REDIS_URL', 'redis://localhost:6379/0'),
        ),
      }),
    }),

    // Database
    PrismaModule,

    // Global modules
    RedisModule,
    AuditModule,
    RbacModule,
    NotificationsModule,
    PlansModule,
    PricingModule,
    FeatureFlagsModule,
    SubscriptionsModule,
    ContentDisclaimersModule,
    DerivativeArtifactModule,

    // Domain modules
    AnalyticsModule,
    AiAnswersModule,
    HealthModule,
    MetricsModule,
    // AppThrottlerGuard is an APP_GUARD declared in THIS module, so JwtService
    // has to be resolvable here. AuthModule's own JwtModule is configured with
    // the PRIVATE signing key and is not exported; the guard only verifies, and
    // passes the public key explicitly per call.
    JwtModule.register({}),
    AuthModule,
    UsersModule,
    AccountDeletionModule,
    OrganizationsModule,
    DocumentsModule,
    DigestsModule,
    DoctrinesModule,
    DuplicatesModule,
    KnowledgeGraphModule,
    MemosModule,
    SearchModule,
    SourcesModule,
    BookmarksModule,
    CaseComparisonsModule,
    CommunityModule,
    ContradictionsModule,
    HearingPrepModule,
    PleadingsModule,
    ResearchWorkspacesModule,
    TimelinesModule,
    UploadsModule,
    StudyModule,
    SubjectsModule,
    WorkspaceModule,
    ApiKeysModule,
    BillingModule,
    StorePurchasesModule,
    CouponsModule,
    PromotionsModule,
    ExportsModule,
    ExternalApiModule,
    AdsModule,
    BlogModule,
    FeedModule,
    HomeModule,
    SimulatorModule,
    SiteContentModule,
    ReportingModule,
    AccountingModule,
    AiSettingsModule,
    BackfillModule,
    AdminPipelineOpsModule,
    BarExamsModule,
    GoldenSetsModule,
    DerivativesAdminModule,
    DerivativesModule,
    InternalModule,
    AudioModule,
  ],
  providers: [
    // Global rate limiting guard — applies to all routes by default
    // Tracks by userId (authenticated) or IP (unauthenticated)
    // Individual routes override via @Throttle() or exempt via @SkipThrottle()
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    // §8.6 launch gate — attach a ContentDisclaimer envelope to every
    // derivative response before it leaves the API. Handlers opt in via
    // @DerivativeResponse() metadata or by returning a payload whose
    // top-level `derivativeType` field matches a seeded contentClass.
    {
      provide: APP_INTERCEPTOR,
      useClass: AttachDisclaimerInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(QueryProfilerMiddleware).forRoutes('(.*)');

  }
}

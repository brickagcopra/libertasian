import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
import { PrismaModule } from './prisma/prisma.module';
import { QueryProfilerMiddleware } from './prisma/query-profiler.middleware';

@Module({
  imports: [
    // Configuration with validation
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'staging', 'production').default('development'),
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
        OPENSEARCH_URL: Joi.string().default('http://localhost:9200'),
        OPENSEARCH_USERNAME: Joi.string().optional().allow(''),
        OPENSEARCH_PASSWORD: Joi.string().optional().allow(''),
        // S3 / MinIO
        S3_ENDPOINT: Joi.string().default('http://localhost:9000'),
        S3_ACCESS_KEY: Joi.string().default('libertasian'),
        S3_SECRET_KEY: Joi.string().default('libertasian_dev_secret'),
        S3_BUCKET_UPLOADS: Joi.string().default('libertasian-uploads'),
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
        // Billing (Xendit)
        XENDIT_SECRET_KEY: Joi.string().default('xnd_development_change_me'),
        XENDIT_WEBHOOK_CALLBACK_TOKEN: Joi.string().default('callback_token_change_me'),
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
        // Search dedup post-filter: when 'true' (default), excludes
        // non-canonical duplicate documents from search results via a
        // Redis-backed must_not.terms clause. Flip to 'false' to revert
        // instantly if the filter ever over-suppresses in prod.
        SEARCH_DEDUP_FILTER_ENABLED: Joi.string().valid('true', 'false').default('true'),
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
    AuthModule,
    UsersModule,
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

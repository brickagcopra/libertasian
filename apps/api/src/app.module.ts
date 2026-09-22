import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { ENV_VALIDATION_SCHEMA } from './common/config/env-validation.schema';
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
import { VectorBackfillModule } from './modules/vector-backfill/vector-backfill.module';
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
import { RequestPlatformMiddleware } from './common/middleware/request-platform.middleware';

@Module({
  imports: [
    // Configuration with validation
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: ENV_VALIDATION_SCHEMA,
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
    VectorBackfillModule,
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
    // ALL ROUTES, and applied FIRST so its AsyncLocalStorage store is the
    // outermost one every downstream guard, interceptor, controller and
    // service runs inside. Entitlement resolution reads the client platform
    // from it; if a route were omitted here, that route would silently resolve
    // every caller as platform-less (ungated) with nothing failing.
    consumer.apply(RequestPlatformMiddleware).forRoutes('(.*)');

    consumer.apply(QueryProfilerMiddleware).forRoutes('(.*)');

  }
}

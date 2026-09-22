import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ENV_VALIDATION_SCHEMA } from '../../common/config/env-validation.schema';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from './permissions.service';
import { PlatformGrantsService } from './platform-grants.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { RbacCacheService } from './rbac-cache.service';
import { RedisModule } from '../../common/services/redis.module';

/**
 * The Nest root module for `scripts/platform-grant.ts`, and for nothing else.
 *
 * IT MUST NEVER IMPORT AppModule, AND NOTHING ADDED HERE MAY DRAG IT IN.
 *
 * AppModule registers 19 BullMQ @Processor classes and ScheduleModule crons. A
 * @Processor is a live consumer the moment its module is instantiated — it does
 * not wait for an HTTP server, so `NestFactory.createApplicationContext` starts
 * every one of them. Booting a one-off CLI on AppModule therefore enlists an
 * ephemeral container as a SECOND consumer of the live production queues,
 * competing with the real workers for jobs it has no dependencies to finish.
 *
 * On 2026-09-21 that is what happened: a single interactive run of this CLI
 * drained 728 digests' audio jobs and marked 499 audio_renditions rows failed,
 * because the throwaway container could not reach the TTS service. The
 * processors also flood stdout with [Nest] lines, which buries the mandatory
 * typed-email confirmation prompt the operator is supposed to read before
 * answering.
 *
 * WHY SERVICES AND NOT MODULES. RbacModule and AuditModule are @Global() and
 * would otherwise be the obvious imports, but both declare controllers, and
 * controllers are NOT inert in an application context: Nest still instantiates
 * the injectable guards in their @UseGuards chain. Every one of those
 * controllers carries SubscriptionGuard or PlatformPermissionsGuard, so
 * importing either module makes the CLI resolve SubscriptionsService and pull
 * the queue-bearing half of the app back in through the side door — the exact
 * thing this module exists to prevent. Naming the four services directly is
 * what keeps the graph controller-free, and `platform-grant-cli.module.spec.ts`
 * asserts that it stays that way.
 *
 * These four are the whole dependency set: PlatformGrantsService needs Prisma,
 * RbacCacheService, PermissionsService and AuditService; PermissionsService
 * needs Prisma and the cache; RbacCacheService needs Redis and Prisma;
 * AuditService needs Prisma.
 */
@Module({
  imports: [
    // Same contract as AppModule — one shared schema, so a CLI run against
    // production validates its environment identically to the API itself.
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: ENV_VALIDATION_SCHEMA,
    }),
    // Both @Global(), both controller-free, neither registers a queue.
    PrismaModule,
    RedisModule,
  ],
  providers: [
    AuditService,
    RbacCacheService,
    PermissionsService,
    PlatformGrantsService,
  ],
})
export class PlatformGrantCliModule {}

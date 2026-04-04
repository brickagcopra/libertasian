import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { handlePrismaQueryEvent } from './query-profiler';

const isDev = process.env['NODE_ENV'] === 'development';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: isDev
        ? [
            { level: 'query', emit: 'event' },
            { level: 'error', emit: 'stdout' },
            { level: 'warn', emit: 'stdout' },
          ]
        : [
            { level: 'error', emit: 'stdout' },
          ],
    });

    if (isDev) {
      // Wire up query profiling in development
      (this as PrismaClient & { $on: (event: string, handler: (e: unknown) => void) => void })
        .$on('query', (e: unknown) => {
          handlePrismaQueryEvent(e as { query: string; params: string; duration: number; target: string });
        });
      this.logger.log('Query profiling enabled (development mode)');
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Returns a tenant-scoped Prisma client that automatically filters
   * queries by organizationId (per CLAUDE.md security standards).
   * Use this in services that need tenant isolation.
   */
  forTenant(organizationId: string) {
    return this.$extends({
      query: {
        matter: { $allOperations: addTenantFilter(organizationId) },
        note: { $allOperations: addTenantFilter(organizationId) },
        userUpload: { $allOperations: addTenantFilter(organizationId) },
        digest: { $allOperations: addTenantFilter(organizationId) },
        bookmark: { $allOperations: addTenantFilter(organizationId) },
        annotation: { $allOperations: addTenantFilter(organizationId) },
        feedPost: { $allOperations: addTenantFilter(organizationId) },
        feedPostMedia: { $allOperations: addTenantFilter(organizationId) },
      },
    });
  }
}

function addTenantFilter(organizationId: string) {
  return async ({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => unknown }) => {
    const where = (args['where'] as Record<string, unknown> | undefined) ?? {};
    args['where'] = { ...where, organizationId };
    return query(args);
  };
}

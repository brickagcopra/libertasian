import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { handlePrismaQueryEvent } from './query-profiler';

const isDev = process.env['NODE_ENV'] === 'development';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  private static readonly TENANT_CLIENT_CACHE_MAX = 1024;
  private readonly tenantClientCache = new Map<
    string,
    ReturnType<PrismaService['buildTenantClient']>
  >();

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
   *
   * Extended clients are memoized per organization (FIFO LRU, cap 1024)
   * so the $extends middleware tree is built once per tenant rather than
   * on every call.
   */
  forTenant(organizationId: string) {
    const cached = this.tenantClientCache.get(organizationId);
    if (cached) return cached;

    if (this.tenantClientCache.size >= PrismaService.TENANT_CLIENT_CACHE_MAX) {
      const oldestKey = this.tenantClientCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.tenantClientCache.delete(oldestKey);
      }
    }

    const client = this.buildTenantClient(organizationId);
    this.tenantClientCache.set(organizationId, client);
    return client;
  }

  private buildTenantClient(organizationId: string) {
    return this.$extends({
      query: {
        matter: { $allOperations: addTenantFilter(organizationId) },
        note: { $allOperations: addTenantFilter(organizationId) },
        userUpload: { $allOperations: addTenantFilter(organizationId) },
        digest: { $allOperations: addTenantFilter(organizationId) },
        feedPost: { $allOperations: addTenantFilter(organizationId) },
        feedPostMedia: { $allOperations: addTenantFilter(organizationId) },
        feedComment: { $allOperations: addTenantFilter(organizationId) },
        // bookmark, annotation, feedCommentLike intentionally omitted.
        // User-scoped/junction tables — no organization_id column. Tenant
        // guard happens at the parent (matter / digest / feedComment)
        // lookup, not here.
      },
    });
  }
}

// Nested writes (data.child.create / connectOrCreate) are NOT traversed —
// middleware applies to the root operation only.
export function addTenantFilter(organizationId: string) {
  return async ({
    operation,
    args,
    query,
  }: {
    operation: string;
    args: Record<string, unknown>;
    query: (args: Record<string, unknown>) => unknown;
  }) => {
    switch (operation) {
      case 'findUnique':
      case 'findUniqueOrThrow':
      case 'findFirst':
      case 'findFirstOrThrow':
      case 'findMany':
      case 'count':
      case 'aggregate':
      case 'groupBy':
      case 'delete':
      case 'deleteMany': {
        const where = (args['where'] as Record<string, unknown> | undefined) ?? {};
        args['where'] = { ...where, organizationId };
        break;
      }
      case 'create': {
        const data = (args['data'] as Record<string, unknown> | undefined) ?? {};
        args['data'] = { ...data, organizationId };
        break;
      }
      case 'createMany':
      case 'createManyAndReturn': {
        const data = args['data'];
        if (Array.isArray(data)) {
          args['data'] = data.map((entry) =>
            entry && typeof entry === 'object'
              ? { ...(entry as Record<string, unknown>), organizationId }
              : entry,
          );
        } else if (data && typeof data === 'object') {
          args['data'] = { ...(data as Record<string, unknown>), organizationId };
        } else {
          args['data'] = { organizationId };
        }
        break;
      }
      case 'update':
      case 'updateMany':
      case 'updateManyAndReturn': {
        const where = (args['where'] as Record<string, unknown> | undefined) ?? {};
        args['where'] = { ...where, organizationId };
        stripOrgIdFromUpdateData(args['data']);
        break;
      }
      case 'upsert': {
        const where = (args['where'] as Record<string, unknown> | undefined) ?? {};
        args['where'] = { ...where, organizationId };
        const create = (args['create'] as Record<string, unknown> | undefined) ?? {};
        args['create'] = { ...create, organizationId };
        stripOrgIdFromUpdateData(args['update']);
        break;
      }
      default:
        break;
    }
    return query(args);
  };
}

// Strip organizationId from an update-shaped data object so callers cannot
// move a row to another tenant. Only strips plain scalar assignments —
// Prisma update-expression values like { set: x } are left alone.
function stripOrgIdFromUpdateData(data: unknown): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const obj = data as Record<string, unknown>;
  if (!('organizationId' in obj)) return;
  const val = obj['organizationId'];
  const isUpdateExpression = val !== null && typeof val === 'object';
  if (!isUpdateExpression) {
    delete obj['organizationId'];
  }
}

import 'reflect-metadata';

import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';

/**
 * Regression guard for the 2026-09-21 incident: `scripts/platform-grant.ts`
 * booted on AppModule, so `createApplicationContext` started all 19 BullMQ
 * @Processor classes inside a throwaway container. It consumed 728 digests'
 * audio jobs and failed 499 audio_renditions rows.
 *
 * The rule enforced here is not "the script imports the right module" — it is
 * that NOTHING reachable from the CLI module's import graph starts a queue
 * consumer or a cron. The controller check is part of that and not a style
 * rule: a controller's @UseGuards injectables ARE instantiated in an
 * application context, and every RBAC/audit controller carries
 * SubscriptionGuard, which resolves SubscriptionsService and pulls the
 * queue-bearing half of the app back in. That is how the graph grows back by
 * accident, so the graph has to stay controller-free.
 */

// The CLI module builds its ConfigModule.forRoot() at class-decoration time,
// and @nestjs/config validates the environment synchronously inside forRoot.
// So the schema's one required var has to exist BEFORE the module file is
// loaded — which rules out a hoisted `import`.
process.env['DATABASE_URL'] ??=
  'postgresql://test:test@localhost:5432/libertasian_test?schema=public';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PlatformGrantCliModule } = require('./platform-grant-cli.module') as {
  PlatformGrantCliModule: Type<unknown>;
};

type ModuleEntry =
  | Type<unknown>
  | DynamicModule
  | ForwardReference
  | Promise<Type<unknown> | DynamicModule>;

interface Closure {
  /** Every module class name reachable from the root, including the root. */
  modules: Set<string>;
  /** Every provider declared by those modules, in any provider form. */
  providers: unknown[];
  /** Every controller declared by those modules. */
  controllers: Type<unknown>[];
}

function isDynamicModule(entry: object): entry is DynamicModule {
  return 'module' in entry;
}

function isForwardReference(entry: object): entry is ForwardReference {
  return 'forwardRef' in entry;
}

async function walk(
  entry: ModuleEntry,
  acc: Closure,
  seen: Set<unknown>,
): Promise<void> {
  // ConfigModule.forRoot() is async in @nestjs/config v4 and lands in
  // `imports` as a pending promise.
  const resolved: unknown = await entry;

  let moduleClass: Type<unknown>;
  let extraImports: ModuleEntry[] = [];
  let extraProviders: unknown[] = [];
  let extraControllers: Type<unknown>[] = [];

  if (typeof resolved === 'function') {
    moduleClass = resolved as Type<unknown>;
  } else if (resolved === null || typeof resolved !== 'object') {
    return;
  } else if (isForwardReference(resolved)) {
    await walk(resolved.forwardRef() as ModuleEntry, acc, seen);
    return;
  } else if (isDynamicModule(resolved)) {
    moduleClass = resolved.module;
    extraImports = (resolved.imports ?? []) as ModuleEntry[];
    extraProviders = resolved.providers ?? [];
    extraControllers = (resolved.controllers ?? []) as Type<unknown>[];
  } else {
    return;
  }

  acc.modules.add(moduleClass.name);
  acc.providers.push(
    ...extraProviders,
    ...((Reflect.getMetadata('providers', moduleClass) ?? []) as unknown[]),
  );
  acc.controllers.push(
    ...extraControllers,
    ...((Reflect.getMetadata('controllers', moduleClass) ??
      []) as Type<unknown>[]),
  );

  const imports = [
    ...((Reflect.getMetadata('imports', moduleClass) ?? []) as ModuleEntry[]),
    ...extraImports,
  ];
  for (const imported of imports) {
    if (seen.has(imported)) continue;
    seen.add(imported);
    await walk(imported, acc, seen);
  }
}

function providerClass(provider: unknown): Type<unknown> | undefined {
  if (typeof provider === 'function') return provider as Type<unknown>;
  if (
    provider !== null &&
    typeof provider === 'object' &&
    'useClass' in provider &&
    typeof (provider as { useClass: unknown }).useClass === 'function'
  ) {
    return (provider as { useClass: Type<unknown> }).useClass;
  }
  return undefined;
}

describe('PlatformGrantCliModule', () => {
  let closure: Closure;
  let providerNames: string[];

  beforeAll(async () => {
    closure = {
      modules: new Set<string>(),
      providers: [],
      controllers: [],
    };
    await walk(PlatformGrantCliModule as ModuleEntry, closure, new Set());
    providerNames = closure.providers
      .map(providerClass)
      .filter((c): c is Type<unknown> => c !== undefined)
      .map((c) => c.name);
  });

  it('provides everything scripts/platform-grant.ts resolves', () => {
    // The script app.get()s these three before it queries anything, so a
    // missing one is a crash at bootstrap, not a latent gap. AuditService and
    // RbacCacheService are their transitive dependencies.
    expect(providerNames).toEqual(
      expect.arrayContaining([
        'PlatformGrantsService',
        'PermissionsService',
        'PrismaService',
        'AuditService',
        'RbacCacheService',
      ]),
    );
  });

  it('never imports AppModule, and no queue- or cron-bearing module', () => {
    for (const forbidden of [
      'AppModule',
      'AudioModule',
      'BullModule',
      'BullRootModule',
      'ScheduleModule',
    ]) {
      expect(closure.modules).not.toContain(forbidden);
    }
  });

  it('declares no BullMQ WorkerHost anywhere in its graph', () => {
    const workers = closure.providers
      .map(providerClass)
      .filter(
        (c): c is Type<unknown> =>
          c !== undefined && c.prototype instanceof WorkerHost,
      )
      .map((c) => c.name);

    expect(workers).toEqual([]);
  });

  it('declares no controllers, whose guards would drag the app back in', () => {
    expect(closure.controllers.map((c) => c.name)).toEqual([]);
  });
});

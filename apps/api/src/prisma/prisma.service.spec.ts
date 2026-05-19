import { PrismaService, addTenantFilter } from './prisma.service';

type MiddlewareArgs = {
  operation: string;
  args: Record<string, unknown>;
  query: jest.Mock;
};

const SENTINEL = Symbol('query-result');

function invoke({ operation, args, query }: MiddlewareArgs) {
  const middleware = addTenantFilter('org-1');
  return middleware({ operation, args, query });
}

function makeQuery() {
  return jest.fn().mockResolvedValue(SENTINEL);
}

describe('addTenantFilter', () => {
  describe('read & delete operations (inject organizationId into where)', () => {
    const ops = [
      'findUnique',
      'findUniqueOrThrow',
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
      'delete',
      'deleteMany',
    ] as const;

    it.each(ops)('%s injects organizationId into where', async (operation) => {
      const args: Record<string, unknown> = { where: { id: 'row-1' } };
      const query = makeQuery();

      const result = await invoke({ operation, args, query });

      expect(result).toBe(SENTINEL);
      expect(query).toHaveBeenCalledTimes(1);
      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      expect(passed['where']).toEqual({ id: 'row-1', organizationId: 'org-1' });
    });

    it('findUnique: creates where when absent', async () => {
      const args: Record<string, unknown> = {};
      const query = makeQuery();

      await invoke({ operation: 'findUnique', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      expect(passed['where']).toEqual({ organizationId: 'org-1' });
    });
  });

  describe('create (inject organizationId into data)', () => {
    it('injects organizationId into args.data; leaves args.where untouched', async () => {
      const args: Record<string, unknown> = {
        data: { textContent: 'hi', authorId: 'u-1' },
      };
      const query = makeQuery();

      await invoke({ operation: 'create', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      expect(passed['data']).toEqual({
        textContent: 'hi',
        authorId: 'u-1',
        organizationId: 'org-1',
      });
      expect(passed['where']).toBeUndefined();
    });

    it('overrides attacker-supplied organizationId in data', async () => {
      const args: Record<string, unknown> = {
        data: { textContent: 'hi', organizationId: 'attacker-org' },
      };
      const query = makeQuery();

      await invoke({ operation: 'create', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      const data = passed['data'] as Record<string, unknown>;
      expect(data['organizationId']).toBe('org-1');
    });
  });

  describe('createMany / createManyAndReturn (inject into each entry)', () => {
    it('createMany with array data: every entry gets organizationId', async () => {
      const args: Record<string, unknown> = {
        data: [{ a: 1 }, { a: 2 }],
      };
      const query = makeQuery();

      await invoke({ operation: 'createMany', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      expect(passed['data']).toEqual([
        { a: 1, organizationId: 'org-1' },
        { a: 2, organizationId: 'org-1' },
      ]);
    });

    it('createManyAndReturn with array data: every entry gets organizationId', async () => {
      const args: Record<string, unknown> = {
        data: [{ a: 1 }, { a: 2, organizationId: 'attacker-org' }],
      };
      const query = makeQuery();

      await invoke({ operation: 'createManyAndReturn', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      expect(passed['data']).toEqual([
        { a: 1, organizationId: 'org-1' },
        { a: 2, organizationId: 'org-1' },
      ]);
    });

    it('createMany with single-object data: injects organizationId', async () => {
      const args: Record<string, unknown> = { data: { a: 1 } };
      const query = makeQuery();

      await invoke({ operation: 'createMany', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      expect(passed['data']).toEqual({ a: 1, organizationId: 'org-1' });
    });
  });

  describe('update / updateMany / updateManyAndReturn', () => {
    const ops = ['update', 'updateMany', 'updateManyAndReturn'] as const;

    it.each(ops)('%s: injects organizationId into where AND strips it from data', async (operation) => {
      const args: Record<string, unknown> = {
        where: { id: 'row-1' },
        data: { textContent: 'x', organizationId: 'attacker-org' },
      };
      const query = makeQuery();

      await invoke({ operation, args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      expect(passed['where']).toEqual({ id: 'row-1', organizationId: 'org-1' });
      const data = passed['data'] as Record<string, unknown>;
      expect(data['organizationId']).toBeUndefined();
      expect(data['textContent']).toBe('x');
    });

    it('update with no organizationId in data: leaves data shape intact', async () => {
      const args: Record<string, unknown> = {
        where: { id: 'row-1' },
        data: { textContent: 'x' },
      };
      const query = makeQuery();

      await invoke({ operation: 'update', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      expect(passed['data']).toEqual({ textContent: 'x' });
    });

    it('update: strips organizationId even when value is a Prisma update-expression like { set: x }', async () => {
      const args: Record<string, unknown> = {
        where: { id: 'row-1' },
        data: { textContent: 'x', organizationId: { set: 'attacker-org' } },
      };
      const query = makeQuery();

      await invoke({ operation: 'update', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      const data = passed['data'] as Record<string, unknown>;
      // `{ set: 'attacker-org' }` is the canonical Prisma way to set a UUID
      // column on update, so it MUST be stripped — otherwise it is a
      // tenant-hop primitive. Unrelated fields survive.
      expect(data['organizationId']).toBeUndefined();
      expect(data['textContent']).toBe('x');
    });
  });

  describe('upsert', () => {
    it('injects organizationId into where AND create; strips from update', async () => {
      const args: Record<string, unknown> = {
        where: { id: 'row-1' },
        create: { textContent: 'hi' },
        update: { textContent: 'x', organizationId: 'attacker-org' },
      };
      const query = makeQuery();

      await invoke({ operation: 'upsert', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      expect(passed['where']).toEqual({ id: 'row-1', organizationId: 'org-1' });
      expect(passed['create']).toEqual({
        textContent: 'hi',
        organizationId: 'org-1',
      });
      const update = passed['update'] as Record<string, unknown>;
      expect(update['organizationId']).toBeUndefined();
      expect(update['textContent']).toBe('x');
    });

    it('overrides attacker-supplied organizationId in create branch', async () => {
      const args: Record<string, unknown> = {
        where: { id: 'row-1' },
        create: { textContent: 'hi', organizationId: 'attacker-org' },
        update: { textContent: 'x' },
      };
      const query = makeQuery();

      await invoke({ operation: 'upsert', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      const create = passed['create'] as Record<string, unknown>;
      expect(create['organizationId']).toBe('org-1');
    });
  });

  describe('unknown operations', () => {
    it('passes through args unchanged', async () => {
      const args: Record<string, unknown> = { foo: 'bar' };
      const query = makeQuery();

      await invoke({ operation: 'someFutureOp', args, query });

      const passed = query.mock.calls[0]![0] as Record<string, unknown>;
      expect(passed).toEqual({ foo: 'bar' });
    });
  });
});

describe('PrismaService.forTenant cache', () => {
  it('returns the same extended client instance for the same organizationId', () => {
    const prisma = new PrismaService();
    try {
      const a1 = prisma.forTenant('org-a');
      const a2 = prisma.forTenant('org-a');
      const b = prisma.forTenant('org-b');
      expect(a1).toBe(a2);
      expect(a1).not.toBe(b);
    } finally {
      // No connection was opened (forTenant doesn't issue queries), but be
      // defensive in case ts-jest holds a handle.
      void prisma.$disconnect().catch(() => undefined);
    }
  });
});

import { linkSubscriptionPlanId } from './subscription-plan-link';

const SENTINEL = Symbol('query-result');

function makeQuery() {
  return jest.fn().mockResolvedValue(SENTINEL);
}

function makeLogger() {
  return { warn: jest.fn() };
}

/** Plan table stand-in: only 'free' and 'pro' resolve. */
const PLANS: Record<string, string> = {
  free: 'plan-free-uuid',
  pro: 'plan-pro-uuid',
};

function makeLookup() {
  return jest.fn(async (code: string) => PLANS[code] ?? null);
}

describe('linkSubscriptionPlanId', () => {
  describe('create', () => {
    it('resolves planId from planCode when planId is absent', async () => {
      const lookup = makeLookup();
      const logger = makeLogger();
      const query = makeQuery();
      const args: Record<string, unknown> = {
        data: { organizationId: 'org-1', planCode: 'free', status: 'active' },
      };

      const result = await linkSubscriptionPlanId(lookup, logger)({
        operation: 'create',
        args,
        query,
      });

      expect(result).toBe(SENTINEL);
      expect(lookup).toHaveBeenCalledWith('free');
      expect(query.mock.calls[0]![0]['data']).toEqual({
        organizationId: 'org-1',
        planCode: 'free',
        status: 'active',
        planId: 'plan-free-uuid',
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('is a no-op when planId is already supplied', async () => {
      const lookup = makeLookup();
      const query = makeQuery();
      const args: Record<string, unknown> = {
        data: { planCode: 'free', planId: 'caller-supplied-uuid' },
      };

      await linkSubscriptionPlanId(lookup, makeLogger())({ operation: 'create', args, query });

      expect(lookup).not.toHaveBeenCalled();
      expect(query.mock.calls[0]![0]['data']).toEqual({
        planCode: 'free',
        planId: 'caller-supplied-uuid',
      });
    });

    it('is a no-op when the caller writes the plan relation directly', async () => {
      const lookup = makeLookup();
      const query = makeQuery();
      const args: Record<string, unknown> = {
        data: { planCode: 'free', plan: { connect: { id: 'plan-pro-uuid' } } },
      };

      await linkSubscriptionPlanId(lookup, makeLogger())({ operation: 'create', args, query });

      expect(lookup).not.toHaveBeenCalled();
      expect(query.mock.calls[0]![0]['data']).not.toHaveProperty('planId');
    });

    it('writes the row without planId and warns when the plan code is unknown', async () => {
      const lookup = makeLookup();
      const logger = makeLogger();
      const query = makeQuery();
      const args: Record<string, unknown> = {
        data: { organizationId: 'org-1', planCode: 'legacy_beta' },
      };

      const result = await linkSubscriptionPlanId(lookup, logger)({
        operation: 'create',
        args,
        query,
      });

      expect(result).toBe(SENTINEL);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0]![0]['data']).toEqual({
        organizationId: 'org-1',
        planCode: 'legacy_beta',
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('legacy_beta'));
    });

    it('fails open: a lookup error still writes the row', async () => {
      const lookup = jest.fn().mockRejectedValue(new Error('connection reset'));
      const logger = makeLogger();
      const query = makeQuery();
      const args: Record<string, unknown> = { data: { planCode: 'free' } };

      const result = await linkSubscriptionPlanId(lookup, logger)({
        operation: 'create',
        args,
        query,
      });

      expect(result).toBe(SENTINEL);
      expect(query.mock.calls[0]![0]['data']).toEqual({ planCode: 'free' });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
    });

    it('leaves a write with no planCode alone', async () => {
      const lookup = makeLookup();
      const query = makeQuery();
      const args: Record<string, unknown> = { data: { organizationId: 'org-1' } };

      await linkSubscriptionPlanId(lookup, makeLogger())({ operation: 'create', args, query });

      expect(lookup).not.toHaveBeenCalled();
      expect(query.mock.calls[0]![0]['data']).toEqual({ organizationId: 'org-1' });
    });
  });

  describe('upsert', () => {
    it('resolves planId on the create branch and leaves update untouched', async () => {
      const lookup = makeLookup();
      const query = makeQuery();
      const args: Record<string, unknown> = {
        where: { id: 'sub-1' },
        create: { organizationId: 'org-1', planCode: 'pro' },
        update: { status: 'active' },
      };

      await linkSubscriptionPlanId(lookup, makeLogger())({ operation: 'upsert', args, query });

      const passed = query.mock.calls[0]![0];
      expect(passed['create']).toEqual({
        organizationId: 'org-1',
        planCode: 'pro',
        planId: 'plan-pro-uuid',
      });
      expect(passed['update']).toEqual({ status: 'active' });
    });
  });

  describe('createMany', () => {
    it.each(['createMany', 'createManyAndReturn'])('%s resolves each row', async (operation) => {
      const lookup = makeLookup();
      const query = makeQuery();
      const args: Record<string, unknown> = {
        data: [
          { planCode: 'free' },
          { planCode: 'pro', planId: 'explicit-uuid' },
          { planCode: 'unknown_code' },
        ],
      };

      await linkSubscriptionPlanId(lookup, makeLogger())({ operation, args, query });

      expect(query.mock.calls[0]![0]['data']).toEqual([
        { planCode: 'free', planId: 'plan-free-uuid' },
        { planCode: 'pro', planId: 'explicit-uuid' },
        { planCode: 'unknown_code' },
      ]);
    });
  });

  describe('other operations', () => {
    it.each(['update', 'updateMany', 'findMany', 'delete'])(
      '%s passes through untouched',
      async (operation) => {
        const lookup = makeLookup();
        const query = makeQuery();
        const args: Record<string, unknown> = { data: { planCode: 'free' }, where: { id: 's-1' } };

        await linkSubscriptionPlanId(lookup, makeLogger())({ operation, args, query });

        expect(lookup).not.toHaveBeenCalled();
        expect(query.mock.calls[0]![0]['data']).toEqual({ planCode: 'free' });
      },
    );
  });
});

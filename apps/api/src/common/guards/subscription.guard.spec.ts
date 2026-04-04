import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service';
import { SubscriptionGuard, SUBSCRIPTION_KEY } from './subscription.guard';

function createMockContext(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('SubscriptionGuard', () => {
  let guard: SubscriptionGuard;
  let reflector: Reflector;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;

  beforeEach(() => {
    reflector = new Reflector();
    subscriptionsService = {
      getPlanCode: jest.fn(),
    } as unknown as jest.Mocked<SubscriptionsService>;

    guard = new SubscriptionGuard(reflector, subscriptionsService);
  });

  describe('no subscription metadata', () => {
    it('should allow when no tier requirement is set (undefined)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockContext({ organizationId: 'org-123' });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('tier enforcement', () => {
    const tierTests = [
      { required: 'free', current: 'free', expected: true },
      { required: 'free', current: 'edu', expected: true },
      { required: 'free', current: 'pro', expected: true },
      { required: 'edu', current: 'free', expected: false },
      { required: 'edu', current: 'edu', expected: true },
      { required: 'edu', current: 'pro', expected: true },
      { required: 'pro', current: 'free', expected: false },
      { required: 'pro', current: 'edu', expected: false },
      { required: 'pro', current: 'pro', expected: true },
      { required: 'pro', current: 'team', expected: true },
      { required: 'team', current: 'pro', expected: false },
      { required: 'team', current: 'team', expected: true },
      { required: 'team', current: 'enterprise', expected: true },
      { required: 'enterprise', current: 'team', expected: false },
      { required: 'enterprise', current: 'enterprise', expected: true },
    ];

    tierTests.forEach(({ required, current, expected }) => {
      it(`should ${expected ? 'allow' : 'deny'} '${current}' when '${required}' is required`, async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
        subscriptionsService.getPlanCode.mockResolvedValue(current);
        const context = createMockContext({
          organizationId: 'org-123',
        });

        if (expected) {
          await expect(guard.canActivate(context)).resolves.toBe(true);
        } else {
          await expect(guard.canActivate(context)).rejects.toThrow(
            ForbiddenException,
          );
        }
      });
    });
  });

  describe('missing organization context', () => {
    it('should throw ForbiddenException when user has no organizationId', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      const context = createMockContext({ sub: 'user-123' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when user is undefined', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      const context = createMockContext(undefined);
      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw with message about subscription requirement', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      const context = createMockContext({});
      try {
        await guard.canActivate(context);
        fail('Expected ForbiddenException');
      } catch (err) {
        expect((err as ForbiddenException).message).toContain(
          'subscription required',
        );
      }
    });
  });

  describe('error message content', () => {
    it('should include the required and current tier in error message', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      subscriptionsService.getPlanCode.mockResolvedValue('free');
      const context = createMockContext({ organizationId: 'org-123' });
      try {
        await guard.canActivate(context);
        fail('Expected ForbiddenException');
      } catch (err) {
        const msg = (err as ForbiddenException).message;
        expect(msg).toContain('pro');
        expect(msg).toContain('free');
      }
    });
  });

  describe('SUBSCRIPTION_KEY export', () => {
    it('should export the correct metadata key', () => {
      expect(SUBSCRIPTION_KEY).toBe('subscription_tier');
    });
  });
});

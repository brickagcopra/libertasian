import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AdminBypassAuditService } from '../services/admin-bypass-audit.service';
import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service';
import { SubscriptionGuard, SUBSCRIPTION_KEY } from './subscription.guard';

function createMockContext(
  user?: Record<string, unknown>,
  method = 'GET',
  path = '/documents',
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, method, path }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('SubscriptionGuard', () => {
  let guard: SubscriptionGuard;
  let reflector: Reflector;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;
  let adminBypassAudit: jest.Mocked<AdminBypassAuditService>;

  beforeEach(() => {
    reflector = new Reflector();
    subscriptionsService = {
      getPlanCode: jest.fn(),
    } as unknown as jest.Mocked<SubscriptionsService>;
    adminBypassAudit = {
      record: jest.fn(),
    } as unknown as jest.Mocked<AdminBypassAuditService>;

    guard = new SubscriptionGuard(reflector, subscriptionsService, adminBypassAudit);
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
    // Inverted deliberately. This message used to interpolate the required and
    // current tier, and the mobile client rendered the body verbatim — which
    // is how the word "Pro" reached the UI and drew the App Review 2.1(b)
    // rejection of iOS build 20. The message must now name no tier.
    it('should name no tier in the error message', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      subscriptionsService.getPlanCode.mockResolvedValue('free');
      const context = createMockContext({ organizationId: 'org-123' });
      try {
        await guard.canActivate(context);
        fail('Expected ForbiddenException');
      } catch (err) {
        const msg = (err as ForbiddenException).message;
        expect(msg).toBe("This feature isn't included in your plan.");
        expect(msg).not.toMatch(/free|edu|pro|team|enterprise|upgrade|₱/i);
      }
    });
  });

  describe('SUBSCRIPTION_KEY export', () => {
    it('should export the correct metadata key', () => {
      expect(SUBSCRIPTION_KEY).toBe('subscription_tier');
    });
  });

  describe('platform-admin bypass', () => {
    it('should allow platform admins regardless of plan and not consult subscriptions service', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('enterprise');
      const context = createMockContext(
        { sub: 'admin-1', organizationId: 'org-1', isPlatformAdmin: true },
        'GET',
        '/documents/abc',
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(subscriptionsService.getPlanCode).not.toHaveBeenCalled();
      expect(adminBypassAudit.record).toHaveBeenCalledWith({
        userId: 'admin-1',
        organizationId: 'org-1',
        route: 'GET /documents/abc',
      });
    });

    it('should still 403 non-admin users on free plan when tier required', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      subscriptionsService.getPlanCode.mockResolvedValue('free');
      const context = createMockContext({
        sub: 'user-1',
        organizationId: 'org-1',
        isPlatformAdmin: false,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      expect(adminBypassAudit.record).not.toHaveBeenCalled();
    });

    it('should still 403 when user has no organizationId even if flagged admin (auth check runs first)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      const context = createMockContext({ sub: 'admin-1', isPlatformAdmin: true });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      expect(adminBypassAudit.record).not.toHaveBeenCalled();
    });
  });
});

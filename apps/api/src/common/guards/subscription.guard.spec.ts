import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
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

  /** ConfigService double returning a fixed PAYWALL_ENFORCED value. */
  function configWith(
    paywallEnforced: boolean | string | undefined,
  ): ConfigService {
    return {
      get: jest.fn().mockReturnValue(paywallEnforced),
    } as unknown as ConfigService;
  }

  beforeEach(() => {
    reflector = new Reflector();
    subscriptionsService = {
      getPlanCode: jest.fn(),
    } as unknown as jest.Mocked<SubscriptionsService>;
    adminBypassAudit = {
      record: jest.fn(),
    } as unknown as jest.Mocked<AdminBypassAuditService>;

    // Default across the existing suite: enforced, i.e. historical behaviour.
    guard = new SubscriptionGuard(
      reflector,
      subscriptionsService,
      adminBypassAudit,
      configWith(true),
    );
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

    it('should throw a message that names no tier and no purchase action', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      const context = createMockContext({});
      try {
        await guard.canActivate(context);
        fail('Expected ForbiddenException');
      } catch (err) {
        const msg = (err as ForbiddenException).message;
        expect(msg).toBe("This isn't available on this account.");
        expect(msg).not.toMatch(
          /plan|subscription|upgrade|premium|pro|tier|paid|billing/i,
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
        expect(msg).toBe("This isn't available on this account.");
        expect(msg).not.toMatch(
          /free|edu|pro|team|enterprise|plan|subscription|upgrade|premium|tier|₱|\$/i,
        );
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

  // ---- PAYWALL_ENFORCED kill switch ----
  describe('PAYWALL_ENFORCED=false', () => {
    function guardWithPaywallOff(): SubscriptionGuard {
      return new SubscriptionGuard(
        reflector,
        subscriptionsService,
        adminBypassAudit,
        configWith(false),
      );
    }

    // 'edu' and 'pro' are the consumer-facing gates (study, uploads,
    // bookmarks, research workspaces). They must all open.
    ['free', 'edu', 'pro'].forEach((required) => {
      it(`should allow a free org through a '${required}'-gated route`, async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
        subscriptionsService.getPlanCode.mockResolvedValue('free');
        const context = createMockContext({ organizationId: 'org-123' });

        await expect(guardWithPaywallOff().canActivate(context)).resolves.toBe(
          true,
        );
      });
    });

    // Deliberately still closed: these are staff/developer surfaces, not paid
    // consumer features, and mobile 1.0 ships no screen that needs them.
    ['team', 'enterprise'].forEach((required) => {
      it(`should still deny a free org on a '${required}'-gated route`, async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
        subscriptionsService.getPlanCode.mockResolvedValue('free');
        const context = createMockContext({ organizationId: 'org-123' });

        await expect(
          guardWithPaywallOff().canActivate(context),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    it("should not consult the org's real tier at all", async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      const context = createMockContext({ organizationId: 'org-123' });

      await expect(guardWithPaywallOff().canActivate(context)).resolves.toBe(
        true,
      );
      expect(subscriptionsService.getPlanCode).not.toHaveBeenCalled();
    });

    it('should still reject a caller with no organizationId (auth is not weakened)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('edu');
      const context = createMockContext({ sub: 'user-1' });

      await expect(guardWithPaywallOff().canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should treat the string "false" (process.env round-trip) as off', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      subscriptionsService.getPlanCode.mockResolvedValue('free');
      const guardStr = new SubscriptionGuard(
        reflector,
        subscriptionsService,
        adminBypassAudit,
        configWith('false'),
      );

      await expect(
        guardStr.canActivate(createMockContext({ organizationId: 'org-123' })),
      ).resolves.toBe(true);
    });

    it('should fail closed when the var is absent or unparseable', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      subscriptionsService.getPlanCode.mockResolvedValue('free');

      for (const value of [undefined, 'nope', true, 'true']) {
        const g = new SubscriptionGuard(
          reflector,
          subscriptionsService,
          adminBypassAudit,
          configWith(value as boolean | string | undefined),
        );
        await expect(
          g.canActivate(createMockContext({ organizationId: 'org-123' })),
        ).rejects.toThrow(ForbiddenException);
      }
    });
  });
});

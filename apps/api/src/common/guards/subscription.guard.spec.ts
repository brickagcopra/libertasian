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

  // ---- per-platform enforcement (D14 mechanism C) ----

  describe('gates on purchase capability, per platform', () => {
    /** ConfigService double keyed by variable, so the two switches are independent. */
    function configOf(env: Record<string, boolean>): ConfigService {
      return {
        get: jest.fn((key: string) => env[key]),
      } as unknown as ConfigService;
    }

    /** A request carrying (or omitting) the `x-platform` header. */
    function contextWithPlatform(platform?: string): ExecutionContext {
      return {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { organizationId: 'org-123' },
            method: 'GET',
            path: '/documents',
            headers: platform === undefined ? {} : { 'x-platform': platform },
          }),
        }),
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
      } as unknown as ExecutionContext;
    }

    const guardWith = (env: Record<string, boolean>) =>
      new SubscriptionGuard(
        reflector,
        subscriptionsService,
        adminBypassAudit,
        configOf(env),
      );

    beforeEach(() => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('pro');
      // A free org: it only gets through when the paywall is NOT enforced.
      subscriptionsService.getPlanCode.mockResolvedValue('free');
    });

    it('does not enforce a header-less caller when iOS purchasing is ON — PROTECTS LIVE BUILD 25', async () => {
      const guard26 = guardWith({
        PAYWALL_ENFORCED: false,
        STORE_PURCHASE_AVAILABLE_IOS: true,
      });

      // App Store build 25 ships no `x-platform` header (it landed in #439,
      // after build 25 was cut) and has no purchase surface. It must keep
      // passing even with iOS purchasing switched on for build 26 — otherwise
      // those users get a 403 they have no way to clear, which is the
      // build-23 rejection.
      await expect(guard26.canActivate(contextWithPlatform())).resolves.toBe(true);
      expect(subscriptionsService.getPlanCode).not.toHaveBeenCalled();
    });

    it('enforces an ios caller once iOS purchasing is ON', async () => {
      const guard26 = guardWith({
        PAYWALL_ENFORCED: false,
        STORE_PURCHASE_AVAILABLE_IOS: true,
      });

      await expect(
        guard26.canActivate(contextWithPlatform('ios')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not enforce an android caller when only iOS purchasing is ON', async () => {
      const guard26 = guardWith({
        PAYWALL_ENFORCED: false,
        STORE_PURCHASE_AVAILABLE_IOS: true,
      });

      // Android vC12 sends `x-platform: android`; its own flag is off.
      await expect(
        guard26.canActivate(contextWithPlatform('android')),
      ).resolves.toBe(true);
    });

    it('does not enforce any platform when both store flags are off', async () => {
      const today = guardWith({
        PAYWALL_ENFORCED: false,
        STORE_PURCHASE_AVAILABLE_IOS: false,
        STORE_PURCHASE_AVAILABLE_ANDROID: false,
      });

      // The state this change merges into: identical behaviour for everyone.
      await expect(today.canActivate(contextWithPlatform())).resolves.toBe(true);
      await expect(today.canActivate(contextWithPlatform('ios'))).resolves.toBe(true);
      await expect(today.canActivate(contextWithPlatform('android'))).resolves.toBe(true);
    });

    it('does not throw on a request with no headers bag at all', async () => {
      const today = guardWith({ PAYWALL_ENFORCED: false });

      // A guard must not TypeError on an unexpected request shape.
      await expect(
        today.canActivate(createMockContext({ organizationId: 'org-123' })),
      ).resolves.toBe(true);
    });
  });
});

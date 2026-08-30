import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as Joi from 'joi';

import { isPaywallEnforcedForRequest } from './paywall';
import { parseClientPlatform } from './store-availability';

/**
 * The per-platform paywall rule:
 *
 *     enforced = isPaywallEnforced(config) || isStorePurchaseAvailable(config, platform)
 *
 * i.e. only gate a client that can actually buy.
 *
 * These tests exist because the failure mode is invisible in staging and
 * expensive in production: gating a shipped binary that has no purchase surface
 * hands the user a 402/403 they cannot clear, which is what got build 23
 * rejected. The case that guards against it is `STORE_PURCHASE_AVAILABLE_IOS=true`
 * with NO `x-platform` header — see the test labelled BUILD 25 below.
 */
describe('isPaywallEnforcedForRequest', () => {
  const VARS = [
    'PAYWALL_ENFORCED',
    'STORE_PURCHASE_AVAILABLE_IOS',
    'STORE_PURCHASE_AVAILABLE_ANDROID',
  ] as const;

  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  /**
   * Build a ConfigService THROUGH PROCESS.ENV, which is how `app.module.ts`
   * actually loads these in production.
   *
   * This matters, and a `load:` factory would not be equivalent. Joi coerces
   * `'true'` to a real boolean only on the env-var path; values supplied via
   * `load:` reach `config.get()` as the raw string. `isStorePurchaseAvailable`
   * compares with `=== true`, so a `load:`-built ConfigService would report the
   * flag as OFF and every assertion below would pass for the wrong reason —
   * including the enforcement ones, which would then be asserting nothing.
   */
  const configFor = async (
    env: Record<string, string>,
  ): Promise<ConfigService> => {
    Object.assign(process.env, env);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validationSchema: Joi.object({
            // Mirrors app.module.ts. All three default to false, which is what
            // makes this change inert on merge.
            PAYWALL_ENFORCED: Joi.boolean().default(false),
            STORE_PURCHASE_AVAILABLE_IOS: Joi.boolean().default(false),
            STORE_PURCHASE_AVAILABLE_ANDROID: Joi.boolean().default(false),
          }).unknown(true),
          validationOptions: { allowUnknown: true },
        }),
      ],
    }).compile();

    return moduleRef.get(ConfigService);
  };

  it('coerces an env-var flag to a real boolean, which isStorePurchaseAvailable requires', async () => {
    // Pins the assumption the tests below rest on. `isStorePurchaseAvailable`
    // uses `=== true`; if the loading path ever stopped coercing, the flag
    // would silently read as OFF in production and no paywall would appear for
    // the build-26 reviewer.
    const config = await configFor({ STORE_PURCHASE_AVAILABLE_IOS: 'true' });

    expect(config.get('STORE_PURCHASE_AVAILABLE_IOS')).toBe(true);
  });

  /** No header at all — what web and every pre-#439 mobile build send. */
  const NO_HEADER = parseClientPlatform(undefined);

  // ---- 1-2: both store flags off. Today's production state. ----

  it('is NOT enforced with the store flag off and no platform header', async () => {
    const config = await configFor({});

    expect(isPaywallEnforcedForRequest(config, NO_HEADER)).toBe(false);
  });

  it('is NOT enforced with the store flag off even for an ios client', async () => {
    const config = await configFor({});

    // The platform is known and purchase-capable in principle, but its flag is
    // off, so there is still nothing to buy.
    expect(isPaywallEnforcedForRequest(config, parseClientPlatform('ios'))).toBe(
      false,
    );
  });

  // ---- 3: THE LOAD-BEARING ONE ----

  it('is NOT enforced for a header-less caller even when iOS purchasing is ON — PROTECTS LIVE BUILD 25', async () => {
    const config = await configFor({ STORE_PURCHASE_AVAILABLE_IOS: 'true' });

    // App Store build 25 is live, has NO purchase surface, and its review notes
    // tell Apple there is no paid tier. It was cut 2026-08-25; the `x-platform`
    // header only landed 2026-08-29 (#439). So build 25 sends NO header, and
    // that ABSENCE is the only thing distinguishing it from build 26.
    //
    // If this test ever goes red, turning on iOS purchasing for build 26 will
    // simultaneously start returning 402/403 to every build-25 user, who has no
    // purchase surface to clear it with. That is the build-23 rejection.
    expect(isPaywallEnforcedForRequest(config, NO_HEADER)).toBe(false);
  });

  // ---- 4-5: the flag is per-platform, and only its own platform is gated ----

  it('IS enforced for an ios client once iOS purchasing is on', async () => {
    const config = await configFor({ STORE_PURCHASE_AVAILABLE_IOS: 'true' });

    expect(isPaywallEnforcedForRequest(config, parseClientPlatform('ios'))).toBe(
      true,
    );
  });

  it('is NOT enforced for an android client when only iOS purchasing is on', async () => {
    const config = await configFor({ STORE_PURCHASE_AVAILABLE_IOS: 'true' });

    // An iOS-approved / Android-pending state is normal mid-rollout. Android
    // vC12 can send `x-platform: android` and must stay ungated until its own
    // flag flips.
    expect(
      isPaywallEnforcedForRequest(config, parseClientPlatform('android')),
    ).toBe(false);
  });

  // ---- 6: the global master still wins on its own ----

  it('IS enforced for every platform when PAYWALL_ENFORCED is true', async () => {
    const config = await configFor({ PAYWALL_ENFORCED: 'true' });

    // Legacy behaviour and the wholesale escape hatch: the master switch does
    // not consult the platform at all.
    expect(isPaywallEnforcedForRequest(config, NO_HEADER)).toBe(true);
    expect(isPaywallEnforcedForRequest(config, parseClientPlatform('ios'))).toBe(
      true,
    );
    expect(
      isPaywallEnforcedForRequest(config, parseClientPlatform('android')),
    ).toBe(true);
  });

  // ---- the merge-inert claim, pinned ----

  it('is NOT enforced for any platform when no flag is set at all', async () => {
    const config = await configFor({});

    // This is the state this PR merges into. If all three assertions hold, the
    // change cannot alter behaviour on deploy.
    expect(isPaywallEnforcedForRequest(config, NO_HEADER)).toBe(false);
    expect(isPaywallEnforcedForRequest(config, parseClientPlatform('ios'))).toBe(
      false,
    );
    expect(
      isPaywallEnforcedForRequest(config, parseClientPlatform('android')),
    ).toBe(false);
  });
});

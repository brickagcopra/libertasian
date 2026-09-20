import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as Joi from 'joi';

import { isPaywallEnforcedForRequest, isWebPaywallEnforced } from './paywall';
import {
  resolveClientSurface,
  type ClientSurface,
} from './store-availability';

/**
 * The third term of the paywall rule:
 *
 *     enforced = isPaywallEnforced(config)
 *             || isStorePurchaseAvailable(config, platform)
 *             || (surface === 'web' && isWebPaywallEnforced(config))
 *
 * Two things must hold simultaneously, and they pull in opposite directions:
 *
 *   1. With `PAYWALL_ENFORCED_WEB` unset, this change ships INERT. Nothing that
 *      is ungated today becomes gated on deploy.
 *   2. With it on, a browser is gated — and the legacy header-less install
 *      base (App Store build 25 and older, still on devices that never
 *      updated), which has the same `null` platform as a browser, still is
 *      NOT. Gating a stale install with no purchase surface is the build-23
 *      rejection.
 *
 * WHAT A GATED WEB USER'S ROUTE OUT IS, as of 2026-09-20: web has no ON-SURFACE
 * purchase route — Xendit declined the merchant activation — so there is no web
 * checkout to send anyone to. The route out is subscribing in the iOS app,
 * where IAP is live and selling. That works for a gated web user who also owns
 * an iPhone; it does not exist for an Android owner or for someone on a desktop
 * alone. Flipping `PAYWALL_ENFORCED_WEB` is therefore a product decision about
 * whether an iOS-only purchase route is an acceptable way out for web users,
 * not an engineering blocker. These tests pin the mechanism, not a plan to use
 * it.
 *
 * `paywall-for-request.spec.ts` covers the first two terms; this file covers
 * the third and the interaction between them.
 */
describe('the web term of isPaywallEnforcedForRequest', () => {
  const VARS = [
    'PAYWALL_ENFORCED',
    'PAYWALL_ENFORCED_WEB',
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
   * Build a ConfigService THROUGH PROCESS.ENV, the way `app.module.ts` loads
   * these in production — NOT through a `load:` factory.
   *
   * This is not a stylistic choice. Joi coerces `'true'` into a real boolean
   * only on the env-var path; a value supplied via `load:` arrives at
   * `config.get()` as the raw string `'true'`. `isWebPaywallEnforced` compares
   * with `=== true`, so a `load:`-built ConfigService would report the flag OFF
   * and EVERY "web is enforced" assertion below would pass for the wrong
   * reason — asserting nothing at all while looking green.
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
            // Mirrors app.module.ts, defaults included.
            PAYWALL_ENFORCED: Joi.boolean().default(false),
            PAYWALL_ENFORCED_WEB: Joi.boolean().default(false),
            STORE_PURCHASE_AVAILABLE_IOS: Joi.boolean().default(false),
            STORE_PURCHASE_AVAILABLE_ANDROID: Joi.boolean().default(false),
          }).unknown(true),
          validationOptions: { allowUnknown: true },
        }),
      ],
    }).compile();

    return moduleRef.get(ConfigService);
  };

  /** A ConfigService built WITHOUT the var in its Joi schema. */
  const configWithoutSchemaEntry = async (
    env: Record<string, string>,
  ): Promise<ConfigService> => {
    Object.assign(process.env, env);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validationSchema: Joi.object({
            PAYWALL_ENFORCED: Joi.boolean().default(false),
          }).unknown(true),
          validationOptions: { allowUnknown: true },
        }),
      ],
    }).compile();

    return moduleRef.get(ConfigService);
  };

  /** What a real browser resolves to, derived rather than hand-written. */
  const WEB: ClientSurface = resolveClientSurface({
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });
  /** What the legacy header-less install base — build 25 and older — resolves to. */
  const LEGACY_APP: ClientSurface = resolveClientSurface({
    'user-agent': 'LIBERTASIAN/25 CFNetwork/3860.700.2 Darwin/25.6.0',
  });

  it('derives the two headerless surfaces this file is about', () => {
    // Guards the rest of the file: if these ever stopped being 'web' and
    // 'legacy_app', every assertion below would be testing a different pair of
    // clients than its name claims.
    expect(WEB).toBe('web');
    expect(LEGACY_APP).toBe('legacy_app');
  });

  // ---- Joi coercion, the precondition for `=== true` ----

  it('coerces PAYWALL_ENFORCED_WEB to a real boolean through the env-var path', () => {
    return configFor({ PAYWALL_ENFORCED_WEB: 'true' }).then((config) => {
      expect(config.get('PAYWALL_ENFORCED_WEB')).toBe(true);
      expect(isWebPaywallEnforced(config)).toBe(true);
    });
  });

  it('is INERT when the var is missing from the Joi schema — the silent-failure mode', async () => {
    // A var absent from the schema is passed through unvalidated, so it arrives
    // as the STRING 'true', fails `=== true`, and the flag does nothing while
    // looking set in the environment. This test is why PAYWALL_ENFORCED_WEB is
    // in `app.module.ts`'s schema; it pins the consequence of removing it.
    const config = await configWithoutSchemaEntry({
      PAYWALL_ENFORCED_WEB: 'true',
    });

    expect(config.get('PAYWALL_ENFORCED_WEB')).toBe('true');
    expect(isWebPaywallEnforced(config)).toBe(false);
  });

  it('refuses to boot on a malformed value, rather than guessing', async () => {
    // Joi.boolean() rejects anything that is not a boolean spelling, so a typo
    // fails at startup with the var named in the message. That is stronger than
    // `isWebPaywallEnforced`'s own `=== true` fallback and strictly better than
    // the master switch's silent "malformed means ON": an operator who
    // mistypes this finds out from a crashed deploy, not from a surface that
    // quietly gates or quietly does not.
    await expect(
      configFor({ PAYWALL_ENFORCED_WEB: 'yes-please' }),
    ).rejects.toThrow(/PAYWALL_ENFORCED_WEB/);
  });

  it('still reads OFF for a value that reaches it unvalidated', async () => {
    // The belt to the Joi braces: `isWebPaywallEnforced` compares with
    // `=== true`, so anything that slips past validation — a string, undefined,
    // a number — is OFF. A typo must never start refusing reads on a surface
    // that has no purchase flow.
    const config = await configWithoutSchemaEntry({
      PAYWALL_ENFORCED_WEB: 'yes-please',
    });

    expect(isWebPaywallEnforced(config)).toBe(false);
  });

  // ---- 1: the flag unset — this change ships inert ----

  it('does NOT enforce a browser when PAYWALL_ENFORCED_WEB is unset', async () => {
    const config = await configFor({});

    // The state this PR merges into. If this goes red the change is not inert
    // and the web surface starts refusing reads on deploy.
    expect(isPaywallEnforcedForRequest(config, null, WEB)).toBe(false);
  });

  it('does NOT enforce any surface when no flag is set at all', async () => {
    const config = await configFor({});

    for (const surface of [
      WEB,
      LEGACY_APP,
      'ios',
      'android',
      null,
    ] as (ClientSurface | null)[]) {
      expect(isPaywallEnforcedForRequest(config, null, surface)).toBe(false);
    }
  });

  it('does NOT enforce a browser merely because iOS purchasing is on', async () => {
    const config = await configFor({ STORE_PURCHASE_AVAILABLE_IOS: 'true' });

    // The web term has its own switch. Turning on the iOS store must not reach
    // across to the browser, which cannot buy from that store.
    expect(isPaywallEnforcedForRequest(config, null, WEB)).toBe(false);
  });

  // ---- 2: the flag on ----

  it('IS enforced for a browser once PAYWALL_ENFORCED_WEB is on', async () => {
    const config = await configFor({ PAYWALL_ENFORCED_WEB: 'true' });

    expect(isPaywallEnforcedForRequest(config, null, WEB)).toBe(true);
  });

  it('still does NOT enforce legacy_app with PAYWALL_ENFORCED_WEB on — PROTECTS LIVE BUILD 25', async () => {
    const config = await configFor({ PAYWALL_ENFORCED_WEB: 'true' });

    // THE LOAD-BEARING CASE. Build 25 and a browser have the SAME `null`
    // platform; only the surface tells them apart. If this goes red, gating the
    // web simultaneously starts returning 403 to every installed copy of an
    // stale install with no purchase surface — the build-23 rejection.
    expect(isPaywallEnforcedForRequest(config, null, LEGACY_APP)).toBe(false);
  });

  it('still does NOT enforce ios or android with only PAYWALL_ENFORCED_WEB on', async () => {
    const config = await configFor({ PAYWALL_ENFORCED_WEB: 'true' });

    // The web flag is per-surface exactly as the store flags are per-platform:
    // a current build that declares `x-platform: ios` stays ungated until its
    // own store flag flips.
    expect(isPaywallEnforcedForRequest(config, 'ios', 'ios')).toBe(false);
    expect(isPaywallEnforcedForRequest(config, 'android', 'android')).toBe(
      false,
    );
  });

  it('does NOT enforce a null surface with PAYWALL_ENFORCED_WEB on — workers and cron sweeps', async () => {
    const config = await configFor({ PAYWALL_ENFORCED_WEB: 'true' });

    // A BullMQ job, a @Cron sweep or a seed has no headers and no user waiting
    // on a paywall. `null` is the value they all resolve to and it must never
    // be enforced.
    expect(isPaywallEnforcedForRequest(config, null, null)).toBe(false);
  });

  it('defaults the surface to null when the argument is omitted', async () => {
    const config = await configFor({ PAYWALL_ENFORCED_WEB: 'true' });

    // Every pre-existing two-argument caller keeps today's behaviour. The
    // default is the ungated one, so a call site that has not been taught about
    // surfaces cannot start gating by accident.
    expect(isPaywallEnforcedForRequest(config, null)).toBe(false);
  });

  // ---- the master switch still subsumes everything ----

  it('IS enforced for every surface when PAYWALL_ENFORCED is true', async () => {
    const config = await configFor({ PAYWALL_ENFORCED: 'true' });

    for (const surface of [
      WEB,
      LEGACY_APP,
      'ios',
      'android',
      null,
    ] as (ClientSurface | null)[]) {
      expect(isPaywallEnforcedForRequest(config, null, surface)).toBe(true);
    }
  });
});

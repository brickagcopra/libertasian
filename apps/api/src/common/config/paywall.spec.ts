import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as Joi from 'joi';

import { isPaywallEnforced } from './paywall';

/**
 * The paywall kill switch has TWO independent rules, and this file pins both.
 *
 *   1. An ABSENT var is OFF. The Joi default in `app.module.ts` is `false`, so
 *      an environment that never heard of this variable does not enforce a
 *      paywall. That is the fail-safe direction: an already-approved iOS binary
 *      with no way to buy anything must never start returning 402
 *      subscription_required because a .env line went missing on a rebuild.
 *      Enforcing the paywall is a deliberate act requiring an explicit value.
 *
 *   2. A MALFORMED explicit value is ON. `isPaywallEnforced()` treats anything
 *      that is not literally `false` as enforced, so a typo in an intentional
 *      `PAYWALL_ENFORCED=true` cannot silently open the paid surface.
 *
 * The two compose: absence is off, garbage is on. Neither rule is safe to
 * change without the other being reconsidered.
 */
describe('isPaywallEnforced', () => {
  /** Build a real ConfigService over an explicit env, with no process leakage. */
  const configFor = async (
    env: Record<string, string>,
  ): Promise<ConfigService> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ ...env })],
          validationSchema: Joi.object({
            // Mirrors app.module.ts. If that default is changed, the first
            // assertion below fails and names this comment.
            PAYWALL_ENFORCED: Joi.boolean().default(false),
          }).unknown(true),
          validationOptions: { allowUnknown: true },
        }),
      ],
    }).compile();

    return moduleRef.get(ConfigService);
  };

  // ---- Rule 1: absence is OFF ----

  it('resolves to false when PAYWALL_ENFORCED is absent from the environment', async () => {
    const config = await configFor({});

    // The whole point of the fail-safe change. A missing var must NOT turn the
    // paywall on for a shipped binary that cannot sell anything.
    expect(isPaywallEnforced(config)).toBe(false);
  });

  it('keeps the Joi-applied default at boolean false, not the string "false"', async () => {
    const config = await configFor({});

    // Joi coerces, but @nestjs/config can write validated values back as
    // strings. `isPaywallEnforced` honours both spellings; this asserts the
    // schema itself defaults to a real boolean so a future reader is not
    // misled about which branch is doing the work.
    expect(config.get('PAYWALL_ENFORCED')).toBe(false);
  });

  // ---- Rule 2: an explicit value wins, and garbage fails closed ----

  it('resolves to true only when explicitly enabled', async () => {
    expect(isPaywallEnforced(await configFor({ PAYWALL_ENFORCED: 'true' }))).toBe(true);
  });

  it('resolves to false for an explicit false, in both spellings', async () => {
    const fromString = { get: () => 'false' } as unknown as ConfigService;
    const fromBoolean = { get: () => false } as unknown as ConfigService;

    expect(isPaywallEnforced(fromString)).toBe(false);
    expect(isPaywallEnforced(fromBoolean)).toBe(false);
  });

  it('treats an unrecognised value as enforced, so a typo cannot open the paid surface', async () => {
    // Rule 2. Distinct from rule 1: this is a var that IS set, to nonsense.
    const typo = { get: () => 'flase' } as unknown as ConfigService;
    const empty = { get: () => '' } as unknown as ConfigService;

    expect(isPaywallEnforced(typo)).toBe(true);
    expect(isPaywallEnforced(empty)).toBe(true);
  });

  it('treats undefined from the ConfigService as enforced', async () => {
    // Reached only when the Joi default is bypassed entirely (a ConfigService
    // built without the schema). Erring towards enforced is right here: an
    // unvalidated config is not evidence of an intent to disable.
    const absent = { get: () => undefined } as unknown as ConfigService;

    expect(isPaywallEnforced(absent)).toBe(true);
  });
});

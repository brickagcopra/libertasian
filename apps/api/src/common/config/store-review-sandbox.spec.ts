import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as Joi from 'joi';

import {
  isStoreReviewSandboxOrg,
  reviewSandboxGrantMs,
} from './store-review-sandbox';

/**
 * D10a is an exemption to a security rule, so the property that matters most is
 * the one asserted first: an environment that never heard of
 * `STORE_SANDBOX_REVIEW_ORG_IDS` behaves exactly like plain D10. The allowlist
 * is a review-round artefact, not a deployment setting, and every deployment
 * that forgets to clear it must fail CLOSED rather than open.
 */
describe('store review sandbox allowlist (D10a)', () => {
  const REVIEW_ORG = '7f3c2a10-4b5d-4e6f-8a90-1b2c3d4e5f60';
  const OTHER_ORG = '00000000-1111-2222-3333-444455556666';

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
            // Mirrors app.module.ts. If either default is changed there, an
            // assertion below fails and names this comment.
            STORE_SANDBOX_REVIEW_ORG_IDS: Joi.string().allow('').default(''),
            STORE_SANDBOX_REVIEW_GRANT_HOURS: Joi.number()
              .min(1)
              .max(720)
              .default(24),
          }).unknown(true),
          validationOptions: { allowUnknown: true },
        }),
      ],
    }).compile();

    return moduleRef.get(ConfigService);
  };

  // ---- The safe default: absence restores plain D10 ----

  it('exempts nobody when STORE_SANDBOX_REVIEW_ORG_IDS is absent', async () => {
    const config = await configFor({});

    // The whole safety argument for D10a. A deployment seeded from
    // .env.example must not hand a sandbox Apple ID a production entitlement.
    expect(isStoreReviewSandboxOrg(config, REVIEW_ORG)).toBe(false);
    expect(isStoreReviewSandboxOrg(config, OTHER_ORG)).toBe(false);
    expect(config.get('STORE_SANDBOX_REVIEW_ORG_IDS')).toBe('');
  });

  // ---- A null org can never match, even with the list populated ----

  it('returns false for a null organizationId even when the list is populated', async () => {
    const config = await configFor({ STORE_SANDBOX_REVIEW_ORG_IDS: REVIEW_ORG });

    // An unresolvable `app_user_id` reaches `checkEnvironment` as null. It must
    // not fall into the exemption just because a list happens to be set.
    expect(isStoreReviewSandboxOrg(config, null)).toBe(false);
  });

  // ---- Matching is forgiving about how the var was typed ----

  it('matches case-insensitively and tolerates whitespace around commas', async () => {
    const config = await configFor({
      STORE_SANDBOX_REVIEW_ORG_IDS: ` ${OTHER_ORG} ,  ${REVIEW_ORG.toUpperCase()}  `,
    });

    // The value is pasted from a console by hand for one review round; a stray
    // space or a capitalised uuid must not silently disarm the exemption.
    expect(isStoreReviewSandboxOrg(config, REVIEW_ORG)).toBe(true);
    expect(isStoreReviewSandboxOrg(config, REVIEW_ORG.toUpperCase())).toBe(true);
    expect(isStoreReviewSandboxOrg(config, OTHER_ORG)).toBe(true);
  });

  it('does not exempt an org that is absent from a populated list', async () => {
    const config = await configFor({ STORE_SANDBOX_REVIEW_ORG_IDS: REVIEW_ORG });

    expect(isStoreReviewSandboxOrg(config, OTHER_ORG)).toBe(false);
  });

  // ---- The grant window ----

  it('defaults the grant window to 24 hours', async () => {
    const config = await configFor({});

    expect(reviewSandboxGrantMs(config)).toBe(24 * 60 * 60 * 1000);
  });

  it('honours an explicit STORE_SANDBOX_REVIEW_GRANT_HOURS', async () => {
    const config = await configFor({ STORE_SANDBOX_REVIEW_GRANT_HOURS: '2' });

    expect(reviewSandboxGrantMs(config)).toBe(2 * 60 * 60 * 1000);
  });
});

import type { ConfigService } from '@nestjs/config';

/**
 * Read the PAYWALL_ENFORCED kill switch.
 *
 * Joi coerces the env var to a real boolean, but @nestjs/config also writes
 * validated values back into `process.env` (where everything is a string), so
 * the value reaching us is `boolean | string` depending on how the config was
 * loaded. Both spellings of "off" are honoured; anything else — including the
 * var being absent — means enforced, so a typo can never silently open the
 * paid surface.
 */
export function isPaywallEnforced(config: ConfigService): boolean {
  const raw = config.get<boolean | string>('PAYWALL_ENFORCED');
  return raw !== false && raw !== 'false';
}

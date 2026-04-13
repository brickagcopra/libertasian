import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key read by `AttachDisclaimerInterceptor` to resolve which
 * canonical disclaimer row (`content_disclaimers.content_class`) applies
 * to the decorated handler's response.
 */
export const DERIVATIVE_RESPONSE_KEY = 'derivative-response';

/**
 * Mark a controller handler as returning an AI-generated derivative
 * artifact. Every response from a decorated handler is auto-attached with
 * the corresponding `ContentDisclaimer` row before it leaves the API.
 *
 * Per §8.6 of the corpus-platform target architecture, this is the
 * load-bearing launch gate: a decorated response that cannot resolve its
 * disclaimer fails closed (500) rather than shipping uncovered derivative
 * text to a user.
 *
 * Usage:
 * ```ts
 * @Get(':id')
 * @DerivativeResponse('ai_digest')
 * async getDigest(...) { ... }
 * ```
 *
 * The `contentClass` string must match a `contentClass` row seeded in
 * `prisma/seed-disclaimers.ts`. Known values: `ai_digest`, `ai_mcq`,
 * `ai_suggested_bar_answer`, `sample_pleading`, `sample_contract`.
 */
export const DerivativeResponse = (contentClass: string) =>
  SetMetadata(DERIVATIVE_RESPONSE_KEY, contentClass);

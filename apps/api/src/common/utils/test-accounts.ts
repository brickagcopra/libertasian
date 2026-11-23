import type { Prisma } from '@prisma/client';

/**
 * Email domains of automated test accounts that sign in to the app but are not
 * customers. Google Play's pre-launch report (Firebase Test Lab) signs in with
 * Google accounts on `cloudtestlabaccounts.com` after every Play upload.
 *
 * These accounts still work normally; they are only left out of admin counts
 * (users list by default, customer summary, active users, retention).
 */
export const TEST_ACCOUNT_EMAIL_DOMAINS: readonly string[] = ['cloudtestlabaccounts.com'];

export function isTestAccountEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return TEST_ACCOUNT_EMAIL_DOMAINS.some((d) => lower.endsWith(`@${d}`));
}

/** Prisma filter: users whose email is NOT on a test-account domain. */
export function realUserWhere(): Prisma.UserWhereInput {
  return {
    NOT: {
      OR: TEST_ACCOUNT_EMAIL_DOMAINS.map((d) => ({
        email: { endsWith: `@${d}`, mode: 'insensitive' as const },
      })),
    },
  };
}

/** Prisma filter: users whose email IS on a test-account domain. */
export function testAccountUserWhere(): Prisma.UserWhereInput {
  return {
    OR: TEST_ACCOUNT_EMAIL_DOMAINS.map((d) => ({
      email: { endsWith: `@${d}`, mode: 'insensitive' as const },
    })),
  };
}

/** LIKE patterns (lower-case) for raw SQL: `lower(email) LIKE ANY(patterns)`. */
export function testAccountLikePatterns(): string[] {
  return TEST_ACCOUNT_EMAIL_DOMAINS.map((d) => `%@${d}`);
}

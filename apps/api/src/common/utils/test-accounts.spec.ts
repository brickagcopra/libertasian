import { isTestAccountEmail, realUserWhere, testAccountLikePatterns } from './test-accounts';

describe('test accounts', () => {
  it('recognises Google Play pre-launch (Test Lab) accounts, case-insensitively', () => {
    expect(isTestAccountEmail('fn3pubhikjhmz3pm6pefy6ekkq-00@cloudtestlabaccounts.com')).toBe(true);
    expect(isTestAccountEmail('X@CloudTestLabAccounts.com')).toBe(true);
  });

  it('does not match real addresses or look-alike domains', () => {
    expect(isTestAccountEmail('juan@gmail.com')).toBe(false);
    expect(isTestAccountEmail('juan@notcloudtestlabaccounts.com')).toBe(false);
    expect(isTestAccountEmail(null)).toBe(false);
  });

  it('builds the Prisma exclusion and SQL patterns', () => {
    expect(realUserWhere()).toEqual({
      NOT: { OR: [{ email: { endsWith: '@cloudtestlabaccounts.com', mode: 'insensitive' } }] },
    });
    expect(testAccountLikePatterns()).toEqual(['%@cloudtestlabaccounts.com']);
  });
});

import type { AccountType, NormalBalance } from '@prisma/client';

/**
 * Compute the balance for an account given total debits and credits,
 * respecting the account's normal balance direction.
 *
 * Normal balance rules:
 *   Assets & Expenses → DEBIT normal → balance = debits - credits
 *   Liabilities, Equity & Revenue → CREDIT normal → balance = credits - debits
 */
export function computeAccountBalance(
  totalDebits: number,
  totalCredits: number,
  normalBalance: NormalBalance,
): number {
  if (normalBalance === 'DEBIT') {
    return totalDebits - totalCredits;
  }
  return totalCredits - totalDebits;
}

/**
 * Determine normal balance direction from account type.
 */
export function normalBalanceForType(accountType: AccountType): NormalBalance {
  switch (accountType) {
    case 'ASSET':
    case 'EXPENSE':
      return 'DEBIT';
    case 'LIABILITY':
    case 'EQUITY':
    case 'REVENUE':
      return 'CREDIT';
    default:
      return 'DEBIT';
  }
}

/**
 * Check if an account type is a balance sheet account (persists across periods).
 */
export function isBalanceSheetAccount(accountType: AccountType): boolean {
  return accountType === 'ASSET' || accountType === 'LIABILITY' || accountType === 'EQUITY';
}

/**
 * Check if an account type is an income statement account (resets each fiscal year).
 */
export function isIncomeStatementAccount(accountType: AccountType): boolean {
  return accountType === 'REVENUE' || accountType === 'EXPENSE';
}

/**
 * Determine if an account code falls within a given range.
 * Useful for aggregating accounts by category (e.g. revenue 4000-4999).
 */
export function isAccountInRange(
  accountCode: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  return accountCode >= rangeStart && accountCode <= rangeEnd;
}

import type { PrismaClient } from '@prisma/client';

/**
 * Chart of Accounts seed data for LIBERTASIAN.
 * Based on standard SaaS chart of accounts adapted for Philippine legal AI platform.
 *
 * Account code structure:
 *   1xxx = Assets
 *   2xxx = Liabilities
 *   3xxx = Equity
 *   4xxx = Revenue
 *   5xxx = Expenses (COGS + OpEx)
 */

interface AccountSeed {
  code: string;
  name: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  subType: string;
  parentCode: string | null;
  normalBalance: 'DEBIT' | 'CREDIT';
  description: string;
  displayOrder: number;
}

export const CHART_OF_ACCOUNTS: AccountSeed[] = [
  // ========== ASSETS (1000-1999) ==========

  // Current Assets
  { code: '1000', name: 'Current Assets', accountType: 'ASSET', subType: 'current_asset', parentCode: null, normalBalance: 'DEBIT', description: 'Short-term assets', displayOrder: 100 },
  { code: '1010', name: 'Payment Gateway Settlement Account', accountType: 'ASSET', subType: 'current_asset', parentCode: '1000', normalBalance: 'DEBIT', description: 'Funds received via the payment gateway', displayOrder: 110 },
  { code: '1020', name: 'Bank Account - Operating', accountType: 'ASSET', subType: 'current_asset', parentCode: '1000', normalBalance: 'DEBIT', description: 'Primary operating bank account', displayOrder: 120 },
  { code: '1030', name: 'Bank Account - Savings', accountType: 'ASSET', subType: 'current_asset', parentCode: '1000', normalBalance: 'DEBIT', description: 'Savings / reserve account', displayOrder: 130 },
  { code: '1040', name: 'Petty Cash', accountType: 'ASSET', subType: 'current_asset', parentCode: '1000', normalBalance: 'DEBIT', description: 'Petty cash fund', displayOrder: 140 },
  { code: '1100', name: 'Accounts Receivable', accountType: 'ASSET', subType: 'current_asset', parentCode: '1000', normalBalance: 'DEBIT', description: 'Amounts owed by customers', displayOrder: 150 },
  { code: '1110', name: 'Allowance for Doubtful Accounts', accountType: 'ASSET', subType: 'current_asset', parentCode: '1100', normalBalance: 'CREDIT', description: 'Contra asset — estimated uncollectible receivables', displayOrder: 155 },
  { code: '1200', name: 'Prepaid Expenses', accountType: 'ASSET', subType: 'current_asset', parentCode: '1000', normalBalance: 'DEBIT', description: 'Prepaid subscriptions, insurance, etc.', displayOrder: 160 },
  { code: '1210', name: 'Prepaid Cloud Services', accountType: 'ASSET', subType: 'current_asset', parentCode: '1200', normalBalance: 'DEBIT', description: 'Prepaid AWS/GCP/infrastructure costs', displayOrder: 165 },

  // Non-Current Assets
  { code: '1500', name: 'Non-Current Assets', accountType: 'ASSET', subType: 'non_current_asset', parentCode: null, normalBalance: 'DEBIT', description: 'Long-term assets', displayOrder: 200 },
  { code: '1510', name: 'Equipment & Hardware', accountType: 'ASSET', subType: 'non_current_asset', parentCode: '1500', normalBalance: 'DEBIT', description: 'Servers, workstations, networking', displayOrder: 210 },
  { code: '1520', name: 'Accumulated Depreciation - Equipment', accountType: 'ASSET', subType: 'non_current_asset', parentCode: '1500', normalBalance: 'CREDIT', description: 'Contra asset — depreciation on equipment', displayOrder: 220 },
  { code: '1530', name: 'Intangible Assets - Software', accountType: 'ASSET', subType: 'non_current_asset', parentCode: '1500', normalBalance: 'DEBIT', description: 'Capitalized software development costs', displayOrder: 230 },
  { code: '1540', name: 'Accumulated Amortization - Software', accountType: 'ASSET', subType: 'non_current_asset', parentCode: '1500', normalBalance: 'CREDIT', description: 'Contra asset — amortization on software', displayOrder: 240 },
  { code: '1550', name: 'Security Deposits', accountType: 'ASSET', subType: 'non_current_asset', parentCode: '1500', normalBalance: 'DEBIT', description: 'Security deposits for office, services', displayOrder: 250 },

  // ========== LIABILITIES (2000-2999) ==========

  // Current Liabilities
  { code: '2000', name: 'Current Liabilities', accountType: 'LIABILITY', subType: 'current_liability', parentCode: null, normalBalance: 'CREDIT', description: 'Short-term obligations', displayOrder: 300 },
  { code: '2010', name: 'Accounts Payable', accountType: 'LIABILITY', subType: 'current_liability', parentCode: '2000', normalBalance: 'CREDIT', description: 'Amounts owed to vendors', displayOrder: 310 },
  { code: '2020', name: 'Accrued Expenses', accountType: 'LIABILITY', subType: 'current_liability', parentCode: '2000', normalBalance: 'CREDIT', description: 'Accrued but unpaid expenses', displayOrder: 320 },
  { code: '2030', name: 'Taxes Payable', accountType: 'LIABILITY', subType: 'current_liability', parentCode: '2000', normalBalance: 'CREDIT', description: 'VAT, income tax, withholding tax payable', displayOrder: 330 },
  { code: '2040', name: 'Salaries Payable', accountType: 'LIABILITY', subType: 'current_liability', parentCode: '2000', normalBalance: 'CREDIT', description: 'Unpaid salaries and wages', displayOrder: 340 },
  { code: '2100', name: 'Deferred Revenue', accountType: 'LIABILITY', subType: 'current_liability', parentCode: '2000', normalBalance: 'CREDIT', description: 'Parent account for all deferred revenue', displayOrder: 350 },
  { code: '2110', name: 'Deferred Revenue - Edu Annual', accountType: 'LIABILITY', subType: 'current_liability', parentCode: '2100', normalBalance: 'CREDIT', description: 'Deferred revenue from annual Edu plan subscriptions', displayOrder: 351 },
  { code: '2120', name: 'Deferred Revenue - Pro Annual', accountType: 'LIABILITY', subType: 'current_liability', parentCode: '2100', normalBalance: 'CREDIT', description: 'Deferred revenue from annual Pro plan subscriptions', displayOrder: 352 },
  { code: '2130', name: 'Deferred Revenue - Team Annual', accountType: 'LIABILITY', subType: 'current_liability', parentCode: '2100', normalBalance: 'CREDIT', description: 'Deferred revenue from annual Team plan subscriptions', displayOrder: 353 },
  { code: '2140', name: 'Deferred Revenue - Enterprise Annual', accountType: 'LIABILITY', subType: 'current_liability', parentCode: '2100', normalBalance: 'CREDIT', description: 'Deferred revenue from annual Enterprise plan subscriptions', displayOrder: 354 },
  { code: '2150', name: 'Customer Credits', accountType: 'LIABILITY', subType: 'current_liability', parentCode: '2000', normalBalance: 'CREDIT', description: 'Credits owed to customers (refunds, prorations)', displayOrder: 360 },

  // Non-Current Liabilities
  { code: '2500', name: 'Non-Current Liabilities', accountType: 'LIABILITY', subType: 'non_current_liability', parentCode: null, normalBalance: 'CREDIT', description: 'Long-term obligations', displayOrder: 400 },
  { code: '2510', name: 'Long-Term Notes Payable', accountType: 'LIABILITY', subType: 'non_current_liability', parentCode: '2500', normalBalance: 'CREDIT', description: 'Notes payable due beyond 12 months', displayOrder: 410 },

  // ========== EQUITY (3000-3999) ==========

  { code: '3000', name: 'Equity', accountType: 'EQUITY', subType: 'equity', parentCode: null, normalBalance: 'CREDIT', description: "Owner's equity", displayOrder: 500 },
  { code: '3010', name: 'Paid-In Capital', accountType: 'EQUITY', subType: 'equity', parentCode: '3000', normalBalance: 'CREDIT', description: 'Capital contributions from founders/investors', displayOrder: 510 },
  { code: '3020', name: 'Retained Earnings', accountType: 'EQUITY', subType: 'equity', parentCode: '3000', normalBalance: 'CREDIT', description: 'Accumulated net income from prior periods', displayOrder: 520 },
  { code: '3030', name: 'Current Year Net Income', accountType: 'EQUITY', subType: 'equity', parentCode: '3000', normalBalance: 'CREDIT', description: 'Net income for the current fiscal year (auto-computed)', displayOrder: 530 },
  { code: '3040', name: 'Distributions / Dividends', accountType: 'EQUITY', subType: 'equity', parentCode: '3000', normalBalance: 'DEBIT', description: 'Distributions to owners', displayOrder: 540 },

  // ========== REVENUE (4000-4999) ==========

  { code: '4000', name: 'Revenue', accountType: 'REVENUE', subType: 'operating_revenue', parentCode: null, normalBalance: 'CREDIT', description: 'All revenue accounts', displayOrder: 600 },
  { code: '4010', name: 'Subscription Revenue - Edu', accountType: 'REVENUE', subType: 'operating_revenue', parentCode: '4000', normalBalance: 'CREDIT', description: 'Revenue from Edu plan subscriptions', displayOrder: 610 },
  { code: '4020', name: 'Subscription Revenue - Pro', accountType: 'REVENUE', subType: 'operating_revenue', parentCode: '4000', normalBalance: 'CREDIT', description: 'Revenue from Pro plan subscriptions', displayOrder: 620 },
  { code: '4030', name: 'Subscription Revenue - Team', accountType: 'REVENUE', subType: 'operating_revenue', parentCode: '4000', normalBalance: 'CREDIT', description: 'Revenue from Team plan subscriptions', displayOrder: 630 },
  { code: '4040', name: 'Subscription Revenue - Enterprise', accountType: 'REVENUE', subType: 'operating_revenue', parentCode: '4000', normalBalance: 'CREDIT', description: 'Revenue from Enterprise plan subscriptions', displayOrder: 640 },
  { code: '4050', name: 'API Revenue', accountType: 'REVENUE', subType: 'operating_revenue', parentCode: '4000', normalBalance: 'CREDIT', description: 'Revenue from API access and usage', displayOrder: 650 },
  { code: '4060', name: 'Professional Services Revenue', accountType: 'REVENUE', subType: 'operating_revenue', parentCode: '4000', normalBalance: 'CREDIT', description: 'Revenue from consulting and integration services', displayOrder: 660 },

  // Contra Revenue
  { code: '4900', name: 'Contra Revenue', accountType: 'REVENUE', subType: 'contra_revenue', parentCode: '4000', normalBalance: 'DEBIT', description: 'Reductions to revenue', displayOrder: 690 },
  { code: '4910', name: 'Refunds', accountType: 'REVENUE', subType: 'contra_revenue', parentCode: '4900', normalBalance: 'DEBIT', description: 'Subscription refunds issued', displayOrder: 691 },
  { code: '4920', name: 'Coupon Discounts', accountType: 'REVENUE', subType: 'contra_revenue', parentCode: '4900', normalBalance: 'DEBIT', description: 'Revenue reduction from coupon discounts', displayOrder: 692 },
  { code: '4930', name: 'Promotional Discounts', accountType: 'REVENUE', subType: 'contra_revenue', parentCode: '4900', normalBalance: 'DEBIT', description: 'Revenue reduction from promotional discounts', displayOrder: 693 },

  // ========== EXPENSES (5000-5999) ==========

  // Cost of Goods Sold / Cost of Revenue (5000-5099)
  { code: '5000', name: 'Cost of Revenue', accountType: 'EXPENSE', subType: 'cogs', parentCode: null, normalBalance: 'DEBIT', description: 'Direct costs of delivering the service', displayOrder: 700 },
  { code: '5010', name: 'Cloud Infrastructure (COGS)', accountType: 'EXPENSE', subType: 'cogs', parentCode: '5000', normalBalance: 'DEBIT', description: 'AWS/GCP hosting, compute, storage — directly attributable', displayOrder: 710 },
  { code: '5020', name: 'AI/ML Compute Costs', accountType: 'EXPENSE', subType: 'cogs', parentCode: '5000', normalBalance: 'DEBIT', description: 'vLLM inference, embedding generation, OCR processing', displayOrder: 720 },
  { code: '5030', name: 'Third-Party API Costs', accountType: 'EXPENSE', subType: 'cogs', parentCode: '5000', normalBalance: 'DEBIT', description: 'Anthropic API, OpenAI, other ML API costs', displayOrder: 730 },
  { code: '5040', name: 'Data Licensing Costs', accountType: 'EXPENSE', subType: 'cogs', parentCode: '5000', normalBalance: 'DEBIT', description: 'Legal corpus data licensing fees', displayOrder: 740 },
  { code: '5050', name: 'Payment Processing Fees', accountType: 'EXPENSE', subType: 'cogs', parentCode: '5000', normalBalance: 'DEBIT', description: 'Payment gateway transaction fees', displayOrder: 750 },
  { code: '5060', name: 'CDN & Bandwidth', accountType: 'EXPENSE', subType: 'cogs', parentCode: '5000', normalBalance: 'DEBIT', description: 'Content delivery and bandwidth costs', displayOrder: 760 },

  // Operating Expenses (5500-5999)
  { code: '5500', name: 'Operating Expenses', accountType: 'EXPENSE', subType: 'opex', parentCode: null, normalBalance: 'DEBIT', description: 'Indirect operating costs', displayOrder: 800 },
  { code: '5510', name: 'Salaries & Wages', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Employee salaries, wages, bonuses', displayOrder: 810 },
  { code: '5520', name: 'Employee Benefits', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'SSS, PhilHealth, Pag-IBIG, HMO, other benefits', displayOrder: 820 },
  { code: '5530', name: 'Software Subscriptions', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'SaaS tools, IDE licenses, design tools', displayOrder: 830 },
  { code: '5540', name: 'Marketing & Advertising', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Digital marketing, advertising campaigns', displayOrder: 840 },
  { code: '5550', name: 'Legal & Compliance', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Legal counsel, regulatory compliance costs', displayOrder: 850 },
  { code: '5560', name: 'Office & Facilities', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Rent, utilities, office supplies', displayOrder: 860 },
  { code: '5570', name: 'Travel & Entertainment', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Business travel, meals, client entertainment', displayOrder: 870 },
  { code: '5580', name: 'Professional Services', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Accounting, consulting, outsourced services', displayOrder: 880 },
  { code: '5590', name: 'Insurance', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Business insurance premiums', displayOrder: 890 },
  { code: '5600', name: 'Depreciation Expense', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Depreciation of tangible assets', displayOrder: 900 },
  { code: '5610', name: 'Amortization Expense', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Amortization of intangible assets', displayOrder: 910 },
  { code: '5620', name: 'Bad Debt Expense', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Uncollectible receivables written off', displayOrder: 920 },
  { code: '5630', name: 'Bank Fees', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Banking charges and transaction fees', displayOrder: 930 },
  { code: '5640', name: 'Research & Development', accountType: 'EXPENSE', subType: 'opex', parentCode: '5500', normalBalance: 'DEBIT', description: 'Non-capitalized R&D expenses', displayOrder: 940 },

  // Taxes
  { code: '5900', name: 'Tax Expense', accountType: 'EXPENSE', subType: 'tax', parentCode: null, normalBalance: 'DEBIT', description: 'Income and other tax expenses', displayOrder: 950 },
  { code: '5910', name: 'Income Tax Expense', accountType: 'EXPENSE', subType: 'tax', parentCode: '5900', normalBalance: 'DEBIT', description: 'Corporate income tax', displayOrder: 960 },
  { code: '5920', name: 'Local Business Tax', accountType: 'EXPENSE', subType: 'tax', parentCode: '5900', normalBalance: 'DEBIT', description: 'Local government business permits and taxes', displayOrder: 970 },
];

/**
 * Seed the chart of accounts. Idempotent — uses upsert by code.
 */
export async function seedChartOfAccounts(prisma: PrismaClient): Promise<void> {
  console.log('\n  Seeding chart of accounts...');

  for (const account of CHART_OF_ACCOUNTS) {
    await prisma.chartOfAccount.upsert({
      where: { code: account.code },
      update: {
        name: account.name,
        accountType: account.accountType,
        subType: account.subType,
        parentCode: account.parentCode,
        normalBalance: account.normalBalance,
        description: account.description,
        displayOrder: account.displayOrder,
        isActive: true,
      },
      create: {
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        subType: account.subType,
        parentCode: account.parentCode,
        normalBalance: account.normalBalance,
        description: account.description,
        displayOrder: account.displayOrder,
        isActive: true,
      },
    });
  }

  console.log(`    ${CHART_OF_ACCOUNTS.length} accounts seeded.`);
}

# LIBERTASIAN — Advanced Accounting System Implementation Prompt

Use this prompt with Claude Code or Claude in your local development environment.

---

## THE PROMPT

```
I need you to implement an advanced accounting and financial intelligence system for LIBERTASIAN, a Philippine legal AI SaaS platform (NestJS 11 + Next.js 15 + Prisma 6 + PostgreSQL 16). The project is already in development with most features built. The monorepo is at /libertasian with apps/api (NestJS), apps/web (Next.js), and existing modules for auth, subscriptions, billing (PayMongo integration), organizations, and users.

Read CLAUDE.md, the PRD, and PDD first to understand the full architecture. Then implement the following advanced accounting system inside the admin panel.

---

## 1. DATABASE SCHEMA — DOUBLE-ENTRY ACCOUNTING CORE

Create a new `accounting` module in `apps/api/src/modules/accounting/`. This system uses proper double-entry bookkeeping where every transaction has balanced debits and credits.

### 1.1 Chart of Accounts

Create Prisma models and migration for:

**`chart_of_accounts`** — the SaaS-adapted chart of accounts:
```
id              UUID PK
code            VARCHAR(20) UNIQUE NOT NULL — hierarchical code (e.g., '1000', '1010', '4100')
name            VARCHAR(255) NOT NULL
account_type    ENUM('asset', 'liability', 'equity', 'revenue', 'expense', 'contra_revenue')
sub_type        VARCHAR(50) — e.g., 'cash', 'accounts_receivable', 'deferred_revenue', 'subscription_revenue', 'cogs', 'opex_engineering', 'opex_sales_marketing', 'opex_general_admin'
parent_code     VARCHAR(20) nullable — for hierarchical grouping
normal_balance  ENUM('debit', 'credit') NOT NULL
is_active       BOOLEAN DEFAULT true
description     TEXT nullable
display_order   INTEGER DEFAULT 0
created_at      TIMESTAMPTZ
```

Seed these accounts on migration (SaaS-specific chart of accounts):

```
ASSETS (1000-1999):
  1000  Cash and Cash Equivalents          asset    cash              debit
  1010  PayMongo Settlement Account         asset    cash              debit
  1020  Bank Account - Operating            asset    cash              debit
  1100  Accounts Receivable                 asset    accounts_receivable  debit
  1110  AR - Subscription Invoices          asset    accounts_receivable  debit
  1120  AR - Enterprise Contracts           asset    accounts_receivable  debit
  1200  Prepaid Expenses                    asset    prepaid           debit
  1210  Prepaid Infrastructure              asset    prepaid           debit
  1220  Prepaid Software Licenses           asset    prepaid           debit
  1300  Fixed Assets                        asset    fixed_asset       debit
  1310  Servers and Equipment               asset    fixed_asset       debit
  1320  Accumulated Depreciation            asset    contra_asset      credit
  1400  Capitalized Development Costs       asset    capitalized_dev   debit
  1410  Accumulated Amortization - Dev      asset    contra_asset      credit
  1500  Capitalized Sales Commissions       asset    capitalized_commission  debit
  1510  Accumulated Amortization - Comm     asset    contra_asset      credit

LIABILITIES (2000-2999):
  2000  Accounts Payable                    liability  accounts_payable    credit
  2100  Deferred Revenue                    liability  deferred_revenue    credit
  2110  Deferred Revenue - Monthly          liability  deferred_revenue    credit
  2120  Deferred Revenue - Annual           liability  deferred_revenue    credit
  2130  Deferred Revenue - Enterprise       liability  deferred_revenue    credit
  2200  Accrued Expenses                    liability  accrued_expense     credit
  2210  Accrued Payroll                     liability  accrued_expense     credit
  2220  Accrued Taxes                       liability  accrued_expense     credit
  2300  Tax Payable                         liability  tax_payable         credit
  2310  VAT Payable                         liability  tax_payable         credit
  2320  Withholding Tax Payable             liability  tax_payable         credit
  2400  Unearned Revenue - Free Trial       liability  deferred_revenue    credit

EQUITY (3000-3999):
  3000  Owner's Equity / Contributed Capital  equity  equity            credit
  3100  Retained Earnings                     equity  retained_earnings credit
  3200  Current Year Net Income               equity  net_income        credit

REVENUE (4000-4999):
  4000  Subscription Revenue                revenue  subscription_revenue  credit
  4010  Revenue - Free Plan (₱0)            revenue  subscription_revenue  credit
  4100  Revenue - Edu Plan                  revenue  subscription_revenue  credit
  4200  Revenue - Pro Plan                  revenue  subscription_revenue  credit
  4300  Revenue - Team Plan                 revenue  subscription_revenue  credit
  4400  Revenue - Enterprise Plan           revenue  subscription_revenue  credit
  4500  Setup / Onboarding Fees             revenue  service_revenue       credit
  4600  API Usage Revenue                   revenue  usage_revenue         credit
  4700  Overage Revenue                     revenue  usage_revenue         credit
  4900  Contra Revenue - Refunds            contra_revenue  refund        debit
  4910  Contra Revenue - Discounts          contra_revenue  discount      debit
  4920  Contra Revenue - Credits            contra_revenue  credit_issued debit

COST OF REVENUE (5000-5499):
  5000  Cost of Revenue                     expense  cogs               debit
  5010  Infrastructure - Hosting/VPS        expense  cogs               debit
  5020  Infrastructure - GPU Compute        expense  cogs               debit
  5030  Infrastructure - Bandwidth/CDN      expense  cogs               debit
  5040  Third-party API Costs (LLM APIs)    expense  cogs               debit
  5050  Payment Processing Fees             expense  cogs               debit
  5060  Data Licensing / Source Fees         expense  cogs               debit
  5070  Customer Support Costs              expense  cogs               debit

OPERATING EXPENSES (5500-5999):
  5500  Engineering & Development           expense  opex_engineering    debit
  5510  Engineering Salaries                expense  opex_engineering    debit
  5520  Software Tools & Licenses           expense  opex_engineering    debit
  5530  Cloud Dev/Test Environments         expense  opex_engineering    debit
  5600  Sales & Marketing                   expense  opex_sales_marketing  debit
  5610  Marketing - Digital Ads             expense  opex_sales_marketing  debit
  5620  Marketing - Content & SEO           expense  opex_sales_marketing  debit
  5630  Sales Commissions                   expense  opex_sales_marketing  debit
  5640  Partnership & Events                expense  opex_sales_marketing  debit
  5700  General & Administrative            expense  opex_general_admin  debit
  5710  Office & Workspace                  expense  opex_general_admin  debit
  5720  Legal & Compliance                  expense  opex_general_admin  debit
  5730  Accounting & Audit                  expense  opex_general_admin  debit
  5740  Insurance                           expense  opex_general_admin  debit
  5750  Depreciation Expense                expense  opex_general_admin  debit
  5760  Amortization Expense                expense  opex_general_admin  debit
  5800  Taxes & Government Fees             expense  tax_expense         debit
```

### 1.2 Core Accounting Tables

**`accounting_periods`** — fiscal month tracking:
```
id              UUID PK
period_name     VARCHAR(20) — e.g., '2026-04'
start_date      DATE NOT NULL
end_date        DATE NOT NULL
status          ENUM('open', 'closing', 'closed') DEFAULT 'open'
closed_by       UUID nullable FK → users
closed_at       TIMESTAMPTZ nullable
created_at      TIMESTAMPTZ
```

**`journal_entries`** — the ledger header:
```
id              UUID PK
entry_number    SERIAL — auto-incrementing human-readable number (JE-000001)
period_id       UUID FK → accounting_periods
entry_date      DATE NOT NULL
description     TEXT NOT NULL
source_type     ENUM('subscription_payment', 'refund', 'manual_adjustment', 'revenue_recognition', 'expense', 'depreciation', 'amortization', 'payroll', 'tax', 'transfer', 'opening_balance', 'closing') NOT NULL
source_ref_id   VARCHAR(255) nullable — e.g., PayMongo payment ID, subscription ID
status          ENUM('draft', 'posted', 'void') DEFAULT 'draft'
posted_by       UUID nullable FK → users
posted_at       TIMESTAMPTZ nullable
voided_by       UUID nullable FK → users
voided_at       TIMESTAMPTZ nullable
void_reason     TEXT nullable
notes           TEXT nullable
is_auto         BOOLEAN DEFAULT false — system-generated vs manual
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```
Constraint: posted entries cannot be modified, only voided with a reversal entry.

**`journal_entry_lines`** — the line items (debits and credits):
```
id              UUID PK
journal_entry_id UUID FK → journal_entries ON DELETE CASCADE
account_id      UUID FK → chart_of_accounts
debit_amount    DECIMAL(15,2) DEFAULT 0 — in PHP (Philippine Peso)
credit_amount   DECIMAL(15,2) DEFAULT 0
description     TEXT nullable
organization_id UUID nullable FK → organizations — for per-org tracking
subscription_id UUID nullable FK → subscriptions — for sub-level tracking
created_at      TIMESTAMPTZ
```
Constraint: CHECK (debit_amount >= 0 AND credit_amount >= 0)
Constraint: CHECK (debit_amount > 0 OR credit_amount > 0) — at least one must be positive
Constraint: CHECK (NOT (debit_amount > 0 AND credit_amount > 0)) — a line is debit OR credit, not both

**Database trigger or application-level validation:** For every journal_entry, SUM(debit_amount) MUST equal SUM(credit_amount) across all lines. Reject any entry that doesn't balance.

### 1.3 Revenue-Specific Tables

**`revenue_schedules`** — deferred revenue recognition schedule per subscription:
```
id                UUID PK
subscription_id   UUID FK → subscriptions
organization_id   UUID FK → organizations
plan_code         VARCHAR(50)
billing_period    ENUM('monthly', 'semi_annual', 'annual')
total_amount      DECIMAL(15,2) — total contract value for the period
recognized_amount DECIMAL(15,2) DEFAULT 0
deferred_amount   DECIMAL(15,2) — = total - recognized
recognition_start DATE
recognition_end   DATE
monthly_recognition DECIMAL(15,2) — = total / number of months
status            ENUM('active', 'completed', 'cancelled', 'refunded')
created_at        TIMESTAMPTZ
updated_at        TIMESTAMPTZ
```

**`revenue_recognition_entries`** — individual monthly recognitions:
```
id                  UUID PK
revenue_schedule_id UUID FK → revenue_schedules
period_id           UUID FK → accounting_periods
recognition_date    DATE
amount              DECIMAL(15,2)
journal_entry_id    UUID FK → journal_entries — links to the JE that recorded this
created_at          TIMESTAMPTZ
```

### 1.4 Expense and Cash Flow Tables

**`expense_records`** — manual and recurring expense tracking:
```
id              UUID PK
period_id       UUID FK → accounting_periods
account_id      UUID FK → chart_of_accounts
category        ENUM('cogs_infrastructure', 'cogs_api', 'cogs_payment_processing', 'cogs_support', 'opex_engineering', 'opex_marketing', 'opex_admin', 'tax', 'depreciation', 'amortization', 'other')
vendor          VARCHAR(255) nullable
description     TEXT NOT NULL
amount          DECIMAL(15,2) NOT NULL
currency        VARCHAR(3) DEFAULT 'PHP'
expense_date    DATE NOT NULL
is_recurring    BOOLEAN DEFAULT false
recurrence      ENUM('monthly', 'quarterly', 'annual') nullable
receipt_ref     TEXT nullable — object storage key for receipt scan
journal_entry_id UUID nullable FK → journal_entries
status          ENUM('pending', 'approved', 'recorded', 'void')
approved_by     UUID nullable FK → users
created_by      UUID FK → users
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

**`budget_items`** — monthly budget targets per account:
```
id              UUID PK
account_id      UUID FK → chart_of_accounts
period_id       UUID FK → accounting_periods
budgeted_amount DECIMAL(15,2) NOT NULL
actual_amount   DECIMAL(15,2) DEFAULT 0 — populated by aggregation
variance        DECIMAL(15,2) DEFAULT 0 — actual - budgeted
notes           TEXT nullable
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
UNIQUE(account_id, period_id)
```

### 1.5 Financial Snapshot Tables (Pre-Computed)

**`financial_snapshots`** — monthly pre-computed financial statements:
```
id              UUID PK
period_id       UUID FK → accounting_periods
snapshot_type   ENUM('income_statement', 'balance_sheet', 'cash_flow') NOT NULL
data            JSONB NOT NULL — structured statement data (see section 3)
generated_at    TIMESTAMPTZ
generated_by    VARCHAR(50) — 'system' or user_id
UNIQUE(period_id, snapshot_type)
```

**`saas_metrics_monthly`** — pre-computed SaaS KPIs per month:
```
id              UUID PK
period_id       UUID FK → accounting_periods
period_date     DATE NOT NULL — first day of month
mrr             DECIMAL(15,2) — total MRR at month end
mrr_new         DECIMAL(15,2) — from new subscriptions
mrr_expansion   DECIMAL(15,2) — from upgrades
mrr_contraction DECIMAL(15,2) — from downgrades
mrr_churn       DECIMAL(15,2) — from cancellations
arr             DECIMAL(15,2) — MRR × 12
net_new_mrr     DECIMAL(15,2) — new + expansion - contraction - churn
subscriber_count INTEGER
new_subscribers  INTEGER
churned_subscribers INTEGER
revenue_churn_rate REAL — mrr_churn / beginning MRR
logo_churn_rate REAL — churned_subscribers / beginning subscribers
net_revenue_retention REAL — (beginning MRR + expansion - contraction - churn) / beginning MRR
gross_revenue_retention REAL — (beginning MRR - churn) / beginning MRR
arpu            DECIMAL(15,2) — MRR / subscriber_count
cac             DECIMAL(15,2) nullable — marketing spend / new subscribers
ltv             DECIMAL(15,2) nullable — ARPU / revenue_churn_rate
ltv_cac_ratio   REAL nullable
cac_payback_months REAL nullable — CAC / ARPU
gross_margin_percent REAL nullable
operating_margin_percent REAL nullable
rule_of_40      REAL nullable — revenue growth % + operating margin %
burn_rate       DECIMAL(15,2) nullable — net cash outflow per month
runway_months   REAL nullable — cash balance / burn rate
total_revenue   DECIMAL(15,2)
total_cogs      DECIMAL(15,2)
gross_profit    DECIMAL(15,2)
total_opex      DECIMAL(15,2)
net_income      DECIMAL(15,2)
cash_balance    DECIMAL(15,2)
deferred_revenue_balance DECIMAL(15,2)
accounts_receivable_balance DECIMAL(15,2)
data            JSONB — additional breakdowns (revenue by plan, expenses by category, etc.)
created_at      TIMESTAMPTZ
UNIQUE(period_date)
```

**`financial_forecasts`** — projected monthly figures:
```
id              UUID PK
forecast_name   VARCHAR(255) — e.g., 'Base Case Q2-Q4 2026', 'Conservative', 'Optimistic'
created_by      UUID FK → users
is_active       BOOLEAN DEFAULT true
assumptions     JSONB NOT NULL — { churn_rate, growth_rate, new_subs_monthly, arpu_change, expense_growth, ... }
periods         JSONB NOT NULL — array of monthly projections (see section 5)
forecast_start  DATE
forecast_end    DATE
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

---

## 2. ACCOUNTING SERVICE LAYER (NestJS)

### 2.1 Core Accounting Service

Create `AccountingService` with double-entry transaction safety:

```typescript
// CRITICAL: All journal entries must be created within a Prisma transaction
// to guarantee debit/credit balance. Never create lines outside a transaction.

async createJournalEntry(data: CreateJournalEntryDto): Promise<JournalEntry> {
  return this.prisma.$transaction(async (tx) => {
    // 1. Validate all account IDs exist and are active
    // 2. Validate SUM(debits) === SUM(credits) — reject if not balanced
    // 3. Validate period is open
    // 4. Create journal_entry header
    // 5. Create all journal_entry_lines
    // 6. Return complete entry with lines
  });
}

async postJournalEntry(entryId: string, userId: string): Promise<void>
// Changes status from draft → posted. Posted entries are immutable.

async voidJournalEntry(entryId: string, userId: string, reason: string): Promise<void>
// Creates a reversal entry (mirror entry with swapped debits/credits),
// marks original as void. Never deletes.

async getTrialBalance(periodId: string): Promise<TrialBalance>
// Computes running balances for all accounts in the period.
// SUM(all debits) must equal SUM(all credits). If not, flag error.

async getAccountBalance(accountId: string, asOfDate: Date): Promise<Decimal>
// Computes balance for a single account up to a given date.
// Assets/Expenses: SUM(debits) - SUM(credits)
// Liabilities/Equity/Revenue: SUM(credits) - SUM(debits)
```

### 2.2 Subscription Revenue Automation

Create `RevenueRecognitionService`:

```typescript
// Called automatically by a webhook handler when PayMongo payment succeeds
async onPaymentReceived(payment: PaymentEvent): Promise<void> {
  // 1. Identify the subscription and plan
  // 2. Determine billing period (monthly or annual)
  // 3. Create revenue_schedule if annual (deferred revenue)
  //    - For monthly: recognize immediately (DR Cash, CR Revenue)
  //    - For annual: defer (DR Cash, CR Deferred Revenue), create schedule
  // 4. Create the journal entry automatically
}

// Called by monthly cron job on the 1st of each month
async recognizeMonthlyRevenue(periodId: string): Promise<void> {
  // For each active revenue_schedule with remaining deferred amount:
  //   1. Compute monthly recognition amount
  //   2. Create journal entry: DR Deferred Revenue, CR Subscription Revenue
  //   3. Create revenue_recognition_entry record
  //   4. Update revenue_schedule.recognized_amount
}

async onRefundIssued(refund: RefundEvent): Promise<void> {
  // 1. Reverse the original revenue entry proportionally
  // 2. DR Contra Revenue - Refunds, CR Cash
  // 3. If deferred revenue remains, reduce the schedule
}

async onSubscriptionUpgrade(event: UpgradeEvent): Promise<void> {
  // 1. Prorate remaining period on old plan
  // 2. Create new revenue schedule for upgraded plan
  // 3. Journal entries for the proration adjustment
}

async onSubscriptionCancellation(event: CancelEvent): Promise<void> {
  // 1. Stop future recognition on the schedule
  // 2. Handle any remaining deferred balance
  // 3. Record churn MRR
}
```

### 2.3 Expense Management Service

```typescript
async createExpense(data: CreateExpenseDto): Promise<ExpenseRecord>
async approveExpense(expenseId: string, approverUserId: string): Promise<void>
async recordExpense(expenseId: string): Promise<void>
  // Creates journal entry: DR Expense Account, CR Cash/AP

async createRecurringExpenses(periodId: string): Promise<void>
  // Cron job: auto-generate expense records for recurring items

async computeBudgetVariance(periodId: string): Promise<BudgetVariance[]>
  // For each budget_item, compute actual vs budget and variance
```

### 2.4 SaaS Metrics Computation Service

Create `SaasMetricsService`:

```typescript
async computeMonthlyMetrics(periodDate: Date): Promise<SaasMetricsMonthly> {
  // This is the main monthly computation job. It should:
  
  // 1. MRR CALCULATION
  // Query all active subscriptions at month-end
  // Sum monthly-equivalent revenue by plan:
  //   - Monthly plans: subscription price
  //   - Annual plans: annual price / 12
  //   - Team plans: per-seat price × seats
  // Result: total MRR, broken down by plan
  
  // 2. MRR MOVEMENT
  // Compare this month's subscriber set to last month's:
  //   mrr_new = MRR from subscriptions created this month
  //   mrr_expansion = MRR increase from upgrades this month
  //   mrr_contraction = MRR decrease from downgrades this month
  //   mrr_churn = MRR lost from cancellations this month
  //   net_new_mrr = new + expansion - contraction - churn
  
  // 3. ARR
  //   arr = mrr × 12
  
  // 4. SUBSCRIBER COUNTS
  //   subscriber_count = total active paid subscribers at month-end
  //   new_subscribers = subscriptions created this month
  //   churned_subscribers = subscriptions cancelled/expired this month
  
  // 5. CHURN RATES
  //   revenue_churn_rate = mrr_churn / beginning_mrr
  //   logo_churn_rate = churned_subscribers / beginning_subscriber_count
  
  // 6. RETENTION
  //   net_revenue_retention = (beg_mrr + expansion - contraction - churn) / beg_mrr
  //   gross_revenue_retention = (beg_mrr - churn) / beg_mrr
  
  // 7. UNIT ECONOMICS
  //   arpu = mrr / subscriber_count
  //   cac = total marketing spend this month / new_subscribers (if > 0)
  //   ltv = arpu / revenue_churn_rate (if churn > 0)
  //   ltv_cac_ratio = ltv / cac
  //   cac_payback_months = cac / arpu
  
  // 8. PROFITABILITY
  //   total_revenue = sum of all revenue account balances for the period
  //   total_cogs = sum of all COGS account balances (5000-5099)
  //   gross_profit = total_revenue - total_cogs
  //   gross_margin_percent = gross_profit / total_revenue
  //   total_opex = sum of all OpEx accounts (5500-5999)
  //   net_income = gross_profit - total_opex
  //   operating_margin_percent = net_income / total_revenue
  
  // 9. CASH
  //   cash_balance = sum of all cash account balances (1000-1099)
  //   burn_rate = (if net_income < 0) abs(net_income) else 0
  //   runway_months = cash_balance / burn_rate (if burn > 0)
  
  // 10. BALANCE SHEET ITEMS
  //   deferred_revenue_balance = sum of deferred revenue accounts (2100-2199)
  //   accounts_receivable_balance = sum of AR accounts (1100-1199)
  
  // 11. RULE OF 40
  //   revenue_growth_rate = (this_month_mrr - prev_month_mrr) / prev_month_mrr × 12 (annualized)
  //   rule_of_40 = revenue_growth_rate_percent + operating_margin_percent
  
  // 12. ADDITIONAL BREAKDOWNS (stored in `data` JSONB)
  //   revenue_by_plan: { edu: X, pro: Y, team: Z, enterprise: W }
  //   mrr_by_plan: { edu: X, pro: Y, team: Z, enterprise: W }
  //   subscribers_by_plan: { edu: N, pro: N, team: N, enterprise: N }
  //   expenses_by_category: { cogs_infra: X, cogs_api: Y, eng: Z, marketing: W, admin: V }
  //   revenue_by_billing_period: { monthly: X, annual: Y }
}
```

---

## 3. FINANCIAL STATEMENT GENERATION

### 3.1 Income Statement (Profit & Loss)

Create `IncomeStatementService` that generates a structured P&L:

```typescript
async generateIncomeStatement(periodId: string): Promise<IncomeStatement> {
  // Structure:
  // ┌─────────────────────────────────────────┐
  // │         INCOME STATEMENT                │
  // │     Period: April 2026                  │
  // ├─────────────────────────────────────────┤
  // │ REVENUE                                 │
  // │   Subscription Revenue                  │
  // │     Edu Plan                    ₱XXX    │
  // │     Pro Plan                    ₱XXX    │
  // │     Team Plan                   ₱XXX    │
  // │     Enterprise Plan             ₱XXX    │
  // │   API Usage Revenue             ₱XXX    │
  // │   Setup / Onboarding Fees       ₱XXX    │
  // │   Less: Refunds                (₱XXX)   │
  // │   Less: Discounts              (₱XXX)   │
  // │ ─────────────────────────────────────── │
  // │ NET REVENUE                     ₱XXX    │
  // ├─────────────────────────────────────────┤
  // │ COST OF REVENUE                         │
  // │   Infrastructure & Hosting      ₱XXX    │
  // │   GPU Compute                   ₱XXX    │
  // │   Third-party APIs              ₱XXX    │
  // │   Payment Processing            ₱XXX    │
  // │   Data Licensing                ₱XXX    │
  // │   Customer Support              ₱XXX    │
  // │ ─────────────────────────────────────── │
  // │ TOTAL COGS                      ₱XXX    │
  // │ GROSS PROFIT                    ₱XXX    │
  // │ Gross Margin                    XX.X%   │
  // ├─────────────────────────────────────────┤
  // │ OPERATING EXPENSES                      │
  // │   Engineering & Development     ₱XXX    │
  // │   Sales & Marketing             ₱XXX    │
  // │   General & Administrative      ₱XXX    │
  // │   Depreciation & Amortization   ₱XXX    │
  // │ ─────────────────────────────────────── │
  // │ TOTAL OPEX                      ₱XXX    │
  // │ OPERATING INCOME (EBIT)         ₱XXX    │
  // │ Operating Margin                XX.X%   │
  // ├─────────────────────────────────────────┤
  // │ Taxes                          (₱XXX)   │
  // │ ─────────────────────────────────────── │
  // │ NET INCOME                      ₱XXX    │
  // │ Net Margin                      XX.X%   │
  // └─────────────────────────────────────────┘
  //
  // Return as structured JSONB with each line item having:
  // { account_code, account_name, amount, percent_of_revenue, prior_period_amount, variance }
}
```

### 3.2 Balance Sheet

Create `BalanceSheetService`:

```typescript
async generateBalanceSheet(asOfDate: Date): Promise<BalanceSheet> {
  // Structure:
  // ASSETS
  //   Current Assets
  //     Cash & Cash Equivalents
  //     Accounts Receivable
  //     Prepaid Expenses
  //   Non-Current Assets
  //     Fixed Assets (net of depreciation)
  //     Capitalized Development (net of amortization)
  //     Capitalized Commissions (net of amortization)
  //   TOTAL ASSETS
  //
  // LIABILITIES
  //   Current Liabilities
  //     Accounts Payable
  //     Deferred Revenue (current portion)
  //     Accrued Expenses
  //     Tax Payable
  //   Non-Current Liabilities
  //     Deferred Revenue (long-term portion)
  //   TOTAL LIABILITIES
  //
  // EQUITY
  //   Owner's Equity
  //   Retained Earnings
  //   Current Year Net Income
  //   TOTAL EQUITY
  //
  // TOTAL LIABILITIES + EQUITY (must equal TOTAL ASSETS)
  //
  // If assets ≠ liabilities + equity, flag an imbalance error.
}
```

### 3.3 Cash Flow Statement

Create `CashFlowService`:

```typescript
async generateCashFlowStatement(periodId: string): Promise<CashFlowStatement> {
  // INDIRECT METHOD
  //
  // OPERATING ACTIVITIES
  //   Net Income
  //   Adjustments for non-cash items:
  //     + Depreciation & Amortization
  //     + Change in Deferred Revenue
  //     - Change in Accounts Receivable
  //     + Change in Accounts Payable
  //     + Change in Accrued Expenses
  //   Net Cash from Operating Activities
  //
  // INVESTING ACTIVITIES
  //   - Capital Expenditures (server purchases, equipment)
  //   - Capitalized Development Costs
  //   Net Cash from Investing Activities
  //
  // FINANCING ACTIVITIES
  //   + Equity Contributions
  //   - Owner Distributions
  //   Net Cash from Financing Activities
  //
  // NET CHANGE IN CASH
  // BEGINNING CASH BALANCE
  // ENDING CASH BALANCE (must match balance sheet)
}
```

---

## 4. AUTOMATED JOURNAL ENTRIES

### 4.1 Subscription Payment Received (PayMongo Webhook)

When a payment webhook fires, automatically create:

**Monthly subscription payment (e.g., Pro ₱999):**
```
DR  1010 PayMongo Settlement        ₱999
CR  4200 Revenue - Pro Plan         ₱999
```

**Annual subscription payment (e.g., Edu ₱499/mo × 12 = ₱5,988 annual):**
```
DR  1010 PayMongo Settlement        ₱5,988
CR  2120 Deferred Revenue - Annual  ₱5,988
```
Then monthly recognition (₱499/month for 12 months):
```
DR  2120 Deferred Revenue - Annual  ₱499
CR  4100 Revenue - Edu Plan         ₱499
```

**Refund:**
```
DR  4900 Contra Revenue - Refunds   ₱999
CR  1010 PayMongo Settlement        ₱999
```

### 4.2 Payment Processing Fee (auto-computed)

For every PayMongo payment, record the processing fee:
```
DR  5050 Payment Processing Fees    ₱XX.XX
CR  1010 PayMongo Settlement        ₱XX.XX
```
(PayMongo typically charges ~3.5% + ₱15 per transaction. Make this configurable.)

### 4.3 Monthly Revenue Recognition Cron

On the 1st of each month, run `recognizeMonthlyRevenue()` to process all active annual schedules.

### 4.4 Recurring Expense Generation

On the 1st of each month, auto-generate expense records for items flagged as recurring (hosting bills, software licenses, etc.).

---

## 5. FORECASTING ENGINE

### 5.1 Forecast Computation Service

Create `ForecastService`:

```typescript
async generateForecast(assumptions: ForecastAssumptions): Promise<Forecast> {
  // Input assumptions:
  // {
  //   name: "Base Case 2026-2027",
  //   start_month: "2026-05",  // first forecast month
  //   months: 24,              // forecast horizon
  //   
  //   // Growth assumptions
  //   monthly_new_subscribers: { edu: 50, pro: 20, team: 3, enterprise: 1 },
  //   new_sub_growth_rate: 0.05,  // 5% month-over-month growth in new subs
  //   
  //   // Churn assumptions
  //   monthly_churn_rate: { edu: 0.08, pro: 0.05, team: 0.03, enterprise: 0.02 },
  //   churn_improvement_rate: 0.01,  // churn decreases by 1% per quarter
  //   
  //   // Pricing
  //   prices: { edu: 499, pro: 999, team_per_seat: 799, enterprise_avg: 25000 },
  //   avg_team_seats: 5,
  //   annual_billing_percent: 0.30,
  //   annual_discount_percent: 0.15,  // 15% discount for annual billing
  //   
  //   // Expansion
  //   monthly_upgrade_rate: 0.03,  // 3% of edu → pro, 2% of pro → team
  //   
  //   // Expenses
  //   cogs_percent_of_revenue: 0.25,
  //   engineering_monthly: 150000,
  //   engineering_growth_rate: 0.02,
  //   marketing_monthly: 80000,
  //   marketing_growth_rate: 0.03,
  //   admin_monthly: 50000,
  //   admin_growth_rate: 0.01,
  //   
  //   // Cash
  //   starting_cash: 2000000,
  //   planned_funding: [{ month: "2026-09", amount: 5000000 }],
  // }
  
  // For each month in the forecast horizon:
  // 1. Compute subscriber count by plan (beginning + new - churn + upgrades)
  // 2. Compute MRR by plan
  // 3. Compute total revenue (recognized, accounting for annual billing)
  // 4. Compute COGS
  // 5. Compute OpEx (with growth rates applied)
  // 6. Compute net income
  // 7. Compute cash flow (revenue collected - expenses paid + funding)
  // 8. Compute running cash balance
  // 9. Compute all SaaS metrics (ARR, churn rates, retention, ARPU, LTV, CAC, Rule of 40)
  //
  // Output: array of monthly projections, each containing:
  // {
  //   month: "2026-05",
  //   subscribers: { edu: N, pro: N, team: N, enterprise: N, total: N },
  //   mrr: { edu: X, pro: X, team: X, enterprise: X, total: X },
  //   mrr_movement: { new: X, expansion: X, contraction: X, churn: X, net: X },
  //   arr: X,
  //   revenue: { subscription: X, total: X },
  //   cogs: X,
  //   gross_profit: X,
  //   gross_margin: X,
  //   opex: { engineering: X, marketing: X, admin: X, total: X },
  //   net_income: X,
  //   net_margin: X,
  //   cash_in: X,
  //   cash_out: X,
  //   net_cash_flow: X,
  //   ending_cash: X,
  //   burn_rate: X,
  //   runway_months: X,
  //   churn_rate: X,
  //   net_revenue_retention: X,
  //   arpu: X,
  //   ltv: X,
  //   cac: X,
  //   ltv_cac: X,
  //   rule_of_40: X,
  // }
}

async generateScenarioComparison(): Promise<ScenarioComparison> {
  // Generate 3 forecasts: conservative, base, optimistic
  // Using different assumption sets. Return all three for overlay charting.
}
```

---

## 6. ADMIN DASHBOARD PAGES (Next.js)

Build at `apps/web/src/app/(dashboard)/admin/accounting/`. Restricted to admin/owner roles.

### 6.1 API Endpoints

```
# Financial Statements
GET /api/v1/admin/accounting/income-statement?period=2026-04
GET /api/v1/admin/accounting/income-statement?from=2026-01&to=2026-04  (range)
GET /api/v1/admin/accounting/balance-sheet?as_of=2026-04-30
GET /api/v1/admin/accounting/cash-flow?period=2026-04
GET /api/v1/admin/accounting/cash-flow?from=2026-01&to=2026-04

# SaaS Metrics
GET /api/v1/admin/accounting/saas-metrics?from=2025-01&to=2026-04
GET /api/v1/admin/accounting/saas-metrics/current  (latest month)
GET /api/v1/admin/accounting/mrr-breakdown  (current MRR by plan, movement)
GET /api/v1/admin/accounting/arr-waterfall  (ARR bridge chart data)

# Forecasting
GET    /api/v1/admin/accounting/forecasts
POST   /api/v1/admin/accounting/forecasts  (create new forecast with assumptions)
GET    /api/v1/admin/accounting/forecasts/:id
PUT    /api/v1/admin/accounting/forecasts/:id  (update assumptions, recompute)
DELETE /api/v1/admin/accounting/forecasts/:id
GET    /api/v1/admin/accounting/forecasts/compare?ids=id1,id2,id3

# Journal Entries & Ledger
GET    /api/v1/admin/accounting/journal-entries?period=2026-04&status=posted
POST   /api/v1/admin/accounting/journal-entries  (manual entry)
GET    /api/v1/admin/accounting/journal-entries/:id
POST   /api/v1/admin/accounting/journal-entries/:id/post
POST   /api/v1/admin/accounting/journal-entries/:id/void
GET    /api/v1/admin/accounting/trial-balance?period=2026-04
GET    /api/v1/admin/accounting/general-ledger?account=4200&from=2026-01&to=2026-04

# Expenses & Budget
GET    /api/v1/admin/accounting/expenses?period=2026-04&category=cogs_infrastructure
POST   /api/v1/admin/accounting/expenses
PATCH  /api/v1/admin/accounting/expenses/:id
POST   /api/v1/admin/accounting/expenses/:id/approve
GET    /api/v1/admin/accounting/budget?period=2026-04
POST   /api/v1/admin/accounting/budget  (set budget targets)
GET    /api/v1/admin/accounting/budget/variance?period=2026-04

# Revenue
GET    /api/v1/admin/accounting/revenue-schedules?status=active
GET    /api/v1/admin/accounting/deferred-revenue-waterfall
GET    /api/v1/admin/accounting/revenue-by-plan?from=2026-01&to=2026-04

# Periods
GET    /api/v1/admin/accounting/periods
POST   /api/v1/admin/accounting/periods/:id/close
```

### 6.2 Dashboard Pages

Use Recharts for all charts. Use shadcn/ui components. Use TanStack Query with 5-minute stale time. All amounts in ₱ (Philippine Peso) with proper formatting (₱1,234,567.89).

**Page 1: Financial Overview** (`/admin/accounting`)

Top row — 8 KPI cards with sparklines and vs-prior-month change:
  - MRR (current) | ARR | Net New MRR (this month) | Revenue Churn Rate
  - Gross Margin % | Net Income (this month) | Cash Balance | Runway (months)

Second row — 2 large charts:
  - **MRR Trend** (12-month line chart, also showing ARR on secondary Y-axis)
  - **MRR Waterfall / Bridge** (stacked bar: starting MRR → + new → + expansion → - contraction → - churn → ending MRR, one bar group per month)

Third row — 2 charts:
  - **Revenue by Plan** (stacked area chart over time: Edu, Pro, Team, Enterprise)
  - **Subscriber Count by Plan** (stacked area chart over time)

Fourth row — 2 charts:
  - **Net Income Trend** (bar chart, green for positive, red for negative, with margin % line overlay)
  - **Cash Balance Trend** (area chart with projected runway line if burn rate negative)

Bottom — Quick links: Income Statement, Balance Sheet, Cash Flow, Forecasts

**Page 2: Income Statement** (`/admin/accounting/income-statement`)

- Period selector (single month or date range for cumulative)
- Full income statement rendered as a professional financial table with:
  - Account name | Current Period | Prior Period | Variance (₱) | Variance (%) | % of Revenue
  - Subtotal rows for each section (Net Revenue, COGS, Gross Profit, OpEx, Net Income)
  - Bold section headers, indented line items, separator lines between sections
- Below the statement: bar chart comparing current vs prior period by category
- Export as PDF / CSV button

**Page 3: Balance Sheet** (`/admin/accounting/balance-sheet`)

- Date selector (as-of date)
- Two-column layout: Assets (left) | Liabilities + Equity (right)
- Professional financial table format with subtotals
- Balance check indicator at bottom: "Assets = Liabilities + Equity ✓" (green) or "IMBALANCE ✗" (red)
- Deferred revenue waterfall chart showing recognition schedule over next 12 months
- Export as PDF / CSV

**Page 4: Cash Flow** (`/admin/accounting/cash-flow`)

- Period selector (month or range)
- Cash flow statement in indirect method format
- Below: **Cash Flow Waterfall** — horizontal waterfall chart showing:
  Net Income → + Non-cash adjustments → + Working capital changes → + Financing → Ending Cash
- **Monthly Cash Flow Trend** — bar chart (operating / investing / financing stacked)
- **Cash Runway Projection** — line chart showing projected cash balance for next 12 months based on current burn rate, with red line at ₱0

**Page 5: SaaS Metrics Dashboard** (`/admin/accounting/saas-metrics`)

Grid of metric cards, each with a 12-month sparkline trend:
  Row 1: MRR | ARR | Net New MRR | ARPU
  Row 2: Revenue Churn Rate | Logo Churn Rate | Net Revenue Retention | Gross Revenue Retention
  Row 3: CAC | LTV | LTV:CAC Ratio | CAC Payback (months)
  Row 4: Gross Margin % | Operating Margin % | Rule of 40 | Burn Rate / Runway

Below the grid:
- **Cohort Revenue Retention** heatmap (rows = signup month cohort, columns = month 0-12, cells = % of original MRR retained — color from green to red)
- **MRR Movement Detail** table (month | beginning MRR | new | expansion | contraction | churn | ending MRR | net new MRR)

**Page 6: Forecasting** (`/admin/accounting/forecasts`)

- List of saved forecasts with name, date range, created date
- "Create New Forecast" button → opens assumptions form:
  - Sliders and number inputs for all assumptions (new subs by plan, churn rates, pricing, expense budgets, funding events)
  - "Generate Forecast" button → computes and saves
- **Forecast Viewer** — after selecting a forecast:
  - Toggle between: Revenue, Subscribers, Cash, Profitability views
  - Each view: line chart showing the projected path month-by-month
  - **Actuals vs Forecast Overlay** — where historical data exists, show actual values as dots overlaid on the forecast line. Highlight divergence.
  - **Scenario Comparison** — select up to 3 forecasts and overlay them on the same chart (e.g., Conservative vs Base vs Optimistic)
  - **Key Forecast Milestones** table: "Month to profitability", "Month cash runs out (if ever)", "Month to ₱1M MRR", "Month to 10,000 subscribers"
  - Data table below chart with all monthly projected figures

**Page 7: Revenue Detail** (`/admin/accounting/revenue`)

- **Revenue Recognition Schedule** — table of all active revenue_schedules:
  subscription_id | plan | total | recognized | deferred | start | end | status
- **Deferred Revenue Waterfall** — stacked bar chart showing how deferred revenue unwinds month-by-month for the next 12 months
- **Revenue by Plan Trend** — stacked area chart
- **Annual vs Monthly Billing Split** — pie chart + trend
- **Refund & Discount Impact** — bar chart showing contra revenue by month

**Page 8: Expenses & Budget** (`/admin/accounting/expenses`)

- **Expense Entry Form** — create/edit expense records with: date, category, vendor, amount, description, account, recurring toggle, receipt upload
- **Expense List** — filterable table: date | vendor | category | amount | status | actions
- **Budget vs Actual** — grouped bar chart: for each expense category, show budget bar vs actual bar, with variance percentage labels
- **Expense Breakdown** — donut chart: COGS vs Engineering vs Marketing vs Admin
- **Expense Trend** — stacked area chart by category over time
- **Top Vendors** — table of top 10 vendors by total spend

**Page 9: General Ledger & Journal Entries** (`/admin/accounting/ledger`)

- **Journal Entry Form** — create manual entries with multiple debit/credit lines. Real-time balance check (shows "Balanced ✓" or "Unbalanced by ₱XXX ✗"). Cannot submit if unbalanced.
- **Journal Entry List** — filterable table: entry# | date | description | source | total | status
  - Click to expand and show all debit/credit lines
  - Post / Void action buttons
- **Trial Balance** — standard trial balance report: Account | Debit Balance | Credit Balance
  - Bottom row: Total Debits | Total Credits (must match)
- **General Ledger** — select an account → show all transactions with running balance
- **Account Balances** — tree view of chart of accounts with current balances, expandable by parent/child

---

## 7. IMPLEMENTATION REQUIREMENTS

### 7.1 Double-Entry Integrity

- EVERY financial transaction MUST be recorded as a balanced journal entry. No exceptions.
- Use Prisma transactions for all journal entry creation. Validate balance before commit.
- Posted entries are immutable. To correct, void and create reversal.
- Create a database trigger or application-level check that prevents journal_entry_lines from being inserted where SUM(debits) ≠ SUM(credits) for the parent entry.
- Trial balance must always balance. If it doesn't, this is a critical system error — alert immediately.

### 7.2 Automation

- PayMongo webhook → automatic journal entry creation for every payment, refund, and fee.
- Monthly cron (1st of month, 03:00 UTC):
  1. Generate new accounting_period if not exists
  2. Run revenue recognition for all active schedules
  3. Generate recurring expense records
  4. Compute SaaS metrics for prior month
  5. Generate financial snapshots (P&L, balance sheet, cash flow)
  6. Compute budget variance
- All automated entries have `is_auto = true` and `source_type` indicating the trigger.

### 7.3 Performance

- Financial statement endpoints read from `financial_snapshots` (pre-computed) for closed periods. Only compute on-the-fly for the current open period.
- SaaS metrics endpoints read from `saas_metrics_monthly` (pre-computed).
- Forecast computation should complete in <5 seconds for a 24-month horizon.
- Cache all dashboard query results in Redis for 5 minutes.
- Journal entry list and general ledger use cursor-based pagination.

### 7.4 Security

- All accounting endpoints restricted to admin/owner roles via RolesGuard.
- Journal entry creation requires admin role. Posting requires owner role.
- Voiding requires owner role with mandatory reason.
- All actions logged in audit_logs (actor, action, entity, timestamp).
- Expense approval requires a different user than the creator (separation of duties).
- Financial data is never exposed to non-admin API endpoints.
- Export endpoints (PDF/CSV) log the export action with the exporter's identity.

### 7.5 Philippine Tax Context

- All amounts in PHP (Philippine Peso).
- VAT consideration: standard Philippine VAT is 12%. Track in tax accounts (2310).
- Withholding tax on certain payments: track in 2320.
- BIR (Bureau of Internal Revenue) compliance: maintain proper chart of accounts that maps to BIR filing requirements.
- Expense records should capture tax-related metadata for eventual BIR reporting.

### 7.6 File Structure

```
apps/api/src/modules/accounting/
├── accounting.module.ts
├── accounting.controller.ts            # journal entries, ledger, trial balance
├── accounting.service.ts               # core double-entry service
├── revenue-recognition.controller.ts   # revenue endpoints
├── revenue-recognition.service.ts      # deferred revenue, recognition
├── financial-statements.controller.ts  # P&L, balance sheet, cash flow
├── financial-statements.service.ts
├── income-statement.service.ts
├── balance-sheet.service.ts
├── cash-flow.service.ts
├── saas-metrics.controller.ts          # SaaS KPI endpoints
├── saas-metrics.service.ts
├── expense.controller.ts               # expense CRUD + budget
├── expense.service.ts
├── budget.service.ts
├── forecast.controller.ts              # forecasting endpoints
├── forecast.service.ts
├── accounting-automation.service.ts    # cron jobs, webhook handlers
├── dto/
│   ├── journal-entry.dto.ts
│   ├── expense.dto.ts
│   ├── budget.dto.ts
│   ├── forecast-assumptions.dto.ts
│   └── query.dto.ts
├── entities/
├── constants/
│   └── chart-of-accounts.seed.ts      # seed data
└── utils/
    ├── currency.ts                    # PHP formatting utilities
    └── financial-math.ts              # rounding, percentage, variance calc

apps/web/src/app/(dashboard)/admin/accounting/
├── page.tsx                           # Financial Overview
├── income-statement/page.tsx
├── balance-sheet/page.tsx
├── cash-flow/page.tsx
├── saas-metrics/page.tsx
├── forecasts/page.tsx
├── forecasts/[id]/page.tsx
├── revenue/page.tsx
├── expenses/page.tsx
├── ledger/page.tsx
├── components/
│   ├── financial-table.tsx            # reusable statement renderer
│   ├── kpi-card.tsx
│   ├── mrr-waterfall-chart.tsx
│   ├── cash-runway-chart.tsx
│   ├── revenue-by-plan-chart.tsx
│   ├── budget-variance-chart.tsx
│   ├── deferred-revenue-waterfall.tsx
│   ├── scenario-comparison-chart.tsx
│   ├── cohort-retention-heatmap.tsx
│   ├── journal-entry-form.tsx
│   ├── expense-form.tsx
│   ├── forecast-assumptions-form.tsx
│   ├── trial-balance-table.tsx
│   ├── general-ledger-table.tsx
│   └── period-selector.tsx
└── hooks/
    ├── use-income-statement.ts
    ├── use-balance-sheet.ts
    ├── use-cash-flow.ts
    ├── use-saas-metrics.ts
    └── use-forecast.ts
```

### 7.7 Prisma Migration Order

1. Create chart_of_accounts table + seed data
2. Create accounting_periods table
3. Create journal_entries + journal_entry_lines tables with constraints
4. Create revenue_schedules + revenue_recognition_entries tables
5. Create expense_records + budget_items tables
6. Create financial_snapshots + saas_metrics_monthly tables
7. Create financial_forecasts table
8. Add database trigger for journal entry balance validation

---

Start by reading the existing codebase (especially the subscriptions and billing modules), then implement in this order:
1. Prisma schema + migration + chart of accounts seed
2. Core AccountingService (double-entry journal entries with balance validation)
3. RevenueRecognitionService + PayMongo webhook integration
4. SaasMetricsService computation
5. Financial statement generation (P&L, Balance Sheet, Cash Flow)
6. Expense management service
7. Budget tracking service
8. Forecast engine
9. All API endpoints
10. Dashboard UI pages (Financial Overview first, then statements, then metrics, then forecasts)
11. Monthly cron jobs for automation
12. Tests (double-entry balance validation is critical — test extensively)
```

---

## USAGE NOTES

- Copy everything between the triple backticks and paste as a single prompt to Claude Code.
- This is a large system. Consider splitting into sessions: (1) schema + core accounting service, (2) revenue recognition + metrics, (3) financial statements + forecast engine, (4) all dashboard UI pages.
- The system integrates with the existing `subscriptions` table and PayMongo billing webhooks — Claude needs to read those files first.
- All currency is in PHP (₱). The system does NOT handle multi-currency — add that later if international expansion happens.
- The forecast engine is purely computational (no ML) — it applies growth/churn assumptions mathematically. This keeps it fast and auditable.

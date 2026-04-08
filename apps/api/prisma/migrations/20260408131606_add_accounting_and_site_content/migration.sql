-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "JournalEntrySourceType" AS ENUM ('MANUAL', 'PAYMENT', 'REFUND', 'REVENUE_RECOGNITION', 'EXPENSE', 'SUBSCRIPTION_CHANGE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "RevenueScheduleStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingPeriodType" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('INFRASTRUCTURE', 'PERSONNEL', 'AI_COMPUTE', 'PAYMENT_PROCESSING', 'MARKETING', 'LEGAL', 'OFFICE', 'SOFTWARE_LICENSES', 'PROFESSIONAL_SERVICES', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'RECORDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SnapshotType" AS ENUM ('INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW');

-- AlterTable
ALTER TABLE "analytics_daily_aggregates" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "analytics_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "analytics_funnel_steps" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "analytics_retention_cohorts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "retention_rate" SET DATA TYPE DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "sub_type" VARCHAR(50),
    "parent_code" VARCHAR(10),
    "normal_balance" "NormalBalance" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" UUID NOT NULL,
    "period_name" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closed_by_id" UUID,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "entry_number" SERIAL NOT NULL,
    "period_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "source_type" "JournalEntrySourceType" NOT NULL,
    "source_ref_id" UUID,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "posted_by_id" UUID,
    "posted_at" TIMESTAMPTZ,
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "notes" TEXT,
    "is_auto" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_lines" (
    "id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit_amount" INTEGER NOT NULL DEFAULT 0,
    "credit_amount" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "organization_id" UUID,
    "subscription_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_schedules" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_code" VARCHAR(50) NOT NULL,
    "billing_period" "BillingPeriodType" NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "recognized_amount" INTEGER NOT NULL DEFAULT 0,
    "deferred_amount" INTEGER NOT NULL,
    "recognition_start" DATE NOT NULL,
    "recognition_end" DATE NOT NULL,
    "monthly_recognition" INTEGER NOT NULL,
    "status" "RevenueScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_recognition_entries" (
    "id" UUID NOT NULL,
    "revenue_schedule_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "recognition_date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_recognition_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_records" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "vendor" VARCHAR(255),
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
    "expense_date" DATE NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrence" "RecurrenceType",
    "receipt_ref" VARCHAR(255),
    "journal_entry_id" UUID,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_items" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "budgeted_amount" INTEGER NOT NULL,
    "actual_amount" INTEGER NOT NULL DEFAULT 0,
    "variance" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_snapshots" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "snapshot_type" "SnapshotType" NOT NULL,
    "data" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by" VARCHAR(50),

    CONSTRAINT "financial_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_metrics_monthly" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "period_date" DATE NOT NULL,
    "mrr" INTEGER NOT NULL DEFAULT 0,
    "mrr_new" INTEGER NOT NULL DEFAULT 0,
    "mrr_expansion" INTEGER NOT NULL DEFAULT 0,
    "mrr_contraction" INTEGER NOT NULL DEFAULT 0,
    "mrr_churn" INTEGER NOT NULL DEFAULT 0,
    "arr" INTEGER NOT NULL DEFAULT 0,
    "net_new_mrr" INTEGER NOT NULL DEFAULT 0,
    "subscriber_count" INTEGER NOT NULL DEFAULT 0,
    "new_subscribers" INTEGER NOT NULL DEFAULT 0,
    "churned_subscribers" INTEGER NOT NULL DEFAULT 0,
    "revenue_churn_rate" INTEGER NOT NULL DEFAULT 0,
    "logo_churn_rate" INTEGER NOT NULL DEFAULT 0,
    "nrr" INTEGER NOT NULL DEFAULT 0,
    "grr" INTEGER NOT NULL DEFAULT 0,
    "arpu" INTEGER NOT NULL DEFAULT 0,
    "cac" INTEGER NOT NULL DEFAULT 0,
    "ltv" INTEGER NOT NULL DEFAULT 0,
    "ltv_cac_ratio" INTEGER NOT NULL DEFAULT 0,
    "cac_payback_months" INTEGER NOT NULL DEFAULT 0,
    "gross_margin_percent" INTEGER NOT NULL DEFAULT 0,
    "operating_margin_percent" INTEGER NOT NULL DEFAULT 0,
    "rule_of_40" INTEGER NOT NULL DEFAULT 0,
    "burn_rate" INTEGER NOT NULL DEFAULT 0,
    "runway_months" INTEGER NOT NULL DEFAULT 0,
    "total_revenue" INTEGER NOT NULL DEFAULT 0,
    "total_cogs" INTEGER NOT NULL DEFAULT 0,
    "gross_profit" INTEGER NOT NULL DEFAULT 0,
    "total_opex" INTEGER NOT NULL DEFAULT 0,
    "net_income" INTEGER NOT NULL DEFAULT 0,
    "cash_balance" INTEGER NOT NULL DEFAULT 0,
    "deferred_revenue_balance" INTEGER NOT NULL DEFAULT 0,
    "ar_balance" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_metrics_monthly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_forecasts" (
    "id" UUID NOT NULL,
    "forecast_name" VARCHAR(255) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "periods" JSONB NOT NULL DEFAULT '[]',
    "forecast_start" DATE NOT NULL,
    "forecast_end" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_contents" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_contents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_code_key" ON "chart_of_accounts"("code");

-- CreateIndex
CREATE INDEX "idx_coa_account_type" ON "chart_of_accounts"("account_type");

-- CreateIndex
CREATE INDEX "idx_coa_parent_code" ON "chart_of_accounts"("parent_code");

-- CreateIndex
CREATE INDEX "idx_coa_display_order" ON "chart_of_accounts"("display_order");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_period_name_key" ON "accounting_periods"("period_name");

-- CreateIndex
CREATE INDEX "idx_accounting_period_status" ON "accounting_periods"("status");

-- CreateIndex
CREATE INDEX "idx_accounting_period_dates" ON "accounting_periods"("start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_entry_number_key" ON "journal_entries"("entry_number");

-- CreateIndex
CREATE INDEX "idx_je_period_status" ON "journal_entries"("period_id", "status");

-- CreateIndex
CREATE INDEX "idx_je_source" ON "journal_entries"("source_type", "source_ref_id");

-- CreateIndex
CREATE INDEX "idx_je_entry_date" ON "journal_entries"("entry_date");

-- CreateIndex
CREATE INDEX "idx_je_status" ON "journal_entries"("status");

-- CreateIndex
CREATE INDEX "idx_jel_journal_entry" ON "journal_entry_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "idx_jel_account_entry" ON "journal_entry_lines"("account_id", "journal_entry_id");

-- CreateIndex
CREATE INDEX "idx_jel_organization" ON "journal_entry_lines"("organization_id");

-- CreateIndex
CREATE INDEX "idx_rev_schedule_status" ON "revenue_schedules"("status");

-- CreateIndex
CREATE INDEX "idx_rev_schedule_org" ON "revenue_schedules"("organization_id");

-- CreateIndex
CREATE INDEX "idx_rev_schedule_sub" ON "revenue_schedules"("subscription_id");

-- CreateIndex
CREATE INDEX "idx_rre_schedule" ON "revenue_recognition_entries"("revenue_schedule_id");

-- CreateIndex
CREATE INDEX "idx_rre_period" ON "revenue_recognition_entries"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_records_journal_entry_id_key" ON "expense_records"("journal_entry_id");

-- CreateIndex
CREATE INDEX "idx_expense_period_status" ON "expense_records"("period_id", "status");

-- CreateIndex
CREATE INDEX "idx_expense_category" ON "expense_records"("category");

-- CreateIndex
CREATE INDEX "idx_expense_account" ON "expense_records"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_budget_account_period" ON "budget_items"("account_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_snapshot_period_type" ON "financial_snapshots"("period_id", "snapshot_type");

-- CreateIndex
CREATE UNIQUE INDEX "saas_metrics_monthly_period_id_key" ON "saas_metrics_monthly"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "saas_metrics_monthly_period_date_key" ON "saas_metrics_monthly"("period_date");

-- CreateIndex
CREATE INDEX "idx_saas_metrics_period_date" ON "saas_metrics_monthly"("period_date");

-- CreateIndex
CREATE INDEX "idx_forecast_active" ON "financial_forecasts"("is_active");

-- CreateIndex
CREATE INDEX "idx_forecast_created_by" ON "financial_forecasts"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_contents_key_key" ON "site_contents"("key");

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_schedules" ADD CONSTRAINT "revenue_schedules_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_schedules" ADD CONSTRAINT "revenue_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_recognition_entries" ADD CONSTRAINT "revenue_recognition_entries_revenue_schedule_id_fkey" FOREIGN KEY ("revenue_schedule_id") REFERENCES "revenue_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_recognition_entries" ADD CONSTRAINT "revenue_recognition_entries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_recognition_entries" ADD CONSTRAINT "revenue_recognition_entries_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_metrics_monthly" ADD CONSTRAINT "saas_metrics_monthly_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_forecasts" ADD CONSTRAINT "financial_forecasts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Provider-neutral billing columns.
--
-- RENAME COLUMN only — never DROP/ADD. Production holds 3 subscriptions with a
-- non-null gateway plan id, 3 payments and 0 payment_methods, all created with
-- test-mode keys. Renaming preserves those rows; a drop/add would silently
-- blank them. The unique indexes are renamed alongside their columns so Prisma's
-- expected `<table>_<column>_key` names keep matching.

-- subscriptions
ALTER TABLE "subscriptions" RENAME COLUMN "xendit_customer_id" TO "provider_customer_id";
ALTER TABLE "subscriptions" RENAME COLUMN "xendit_subscription_id" TO "provider_subscription_id";
ALTER INDEX "subscriptions_xendit_subscription_id_key" RENAME TO "subscriptions_provider_subscription_id_key";
ALTER TABLE "subscriptions" ADD COLUMN "provider" VARCHAR(20) NOT NULL DEFAULT 'xendit';

-- payment_methods
ALTER TABLE "payment_methods" RENAME COLUMN "xendit_payment_method_id" TO "provider_payment_method_id";
ALTER INDEX "payment_methods_xendit_payment_method_id_key" RENAME TO "payment_methods_provider_payment_method_id_key";
ALTER TABLE "payment_methods" ADD COLUMN "provider" VARCHAR(20) NOT NULL DEFAULT 'xendit';

-- payments
ALTER TABLE "payments" RENAME COLUMN "xendit_invoice_id" TO "provider_invoice_id";
ALTER INDEX "payments_xendit_invoice_id_key" RENAME TO "payments_provider_invoice_id_key";
ALTER TABLE "payments" ADD COLUMN "provider" VARCHAR(20) NOT NULL DEFAULT 'xendit';

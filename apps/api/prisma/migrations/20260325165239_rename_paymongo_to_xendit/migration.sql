/*
  Warnings:

  - You are about to drop the column `paymongo_payment_method_id` on the `payment_methods` table. All the data in the column will be lost.
  - You are about to drop the column `paymongo_payment_intent_id` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `paymongo_subscription_id` on the `subscriptions` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[xendit_payment_method_id]` on the table `payment_methods` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[xendit_invoice_id]` on the table `payments` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[xendit_subscription_id]` on the table `subscriptions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `xendit_payment_method_id` to the `payment_methods` table without a default value. This is not possible if the table is not empty.
  - Added the required column `xendit_invoice_id` to the `payments` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "payment_methods_paymongo_payment_method_id_key";

-- DropIndex
DROP INDEX "payments_paymongo_payment_intent_id_key";

-- DropIndex
DROP INDEX "subscriptions_paymongo_subscription_id_key";

-- AlterTable
ALTER TABLE "payment_methods" DROP COLUMN "paymongo_payment_method_id",
ADD COLUMN     "xendit_payment_method_id" VARCHAR(255) NOT NULL;

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "paymongo_payment_intent_id",
ADD COLUMN     "xendit_invoice_id" VARCHAR(255) NOT NULL;

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "paymongo_subscription_id",
ADD COLUMN     "plan_id" UUID,
ADD COLUMN     "xendit_subscription_id" VARCHAR(255);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(50) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "description" VARCHAR(500),
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "requires_mfa" BOOLEAN NOT NULL DEFAULT false,
    "max_per_org" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_hierarchy" (
    "id" UUID NOT NULL,
    "parent_role_id" UUID NOT NULL,
    "child_role_id" UUID NOT NULL,

    CONSTRAINT "role_hierarchy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_constraints" (
    "id" UUID NOT NULL,
    "role_a_id" UUID NOT NULL,
    "role_b_id" UUID NOT NULL,
    "constraint_type" VARCHAR(30) NOT NULL,

    CONSTRAINT "role_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_roles" (
    "id" UUID NOT NULL,
    "organization_member_id" UUID NOT NULL,
    "role_definition_id" UUID NOT NULL,
    "assigned_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "type" VARCHAR(30) NOT NULL DEFAULT 'standard',
    "category" VARCHAR(30) NOT NULL DEFAULT 'individual',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "trial_enabled" BOOLEAN NOT NULL DEFAULT false,
    "trial_duration_days" INTEGER NOT NULL DEFAULT 0,
    "grace_period_days" INTEGER NOT NULL DEFAULT 3,
    "auto_renew_required" BOOLEAN NOT NULL DEFAULT true,
    "admin_only_assignment" BOOLEAN NOT NULL DEFAULT false,
    "invite_only" BOOLEAN NOT NULL DEFAULT false,
    "eligible_segments" JSONB NOT NULL DEFAULT '[]',
    "default_seats" INTEGER NOT NULL DEFAULT 1,
    "max_seats" INTEGER,
    "internal_notes" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "is_legacy" BOOLEAN NOT NULL DEFAULT false,
    "legacy_mapping_code" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "billing_interval" VARCHAR(20) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_entitlements" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value_type" VARCHAR(20) NOT NULL,
    "numeric_value" INTEGER,
    "boolean_value" BOOLEAN,
    "description" TEXT,

    CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_feature_flags" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "flag_key" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "plan_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rollout_percentage" INTEGER NOT NULL DEFAULT 100,
    "allowed_org_ids" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_history" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "from_state" VARCHAR(30) NOT NULL,
    "to_state" VARCHAR(30) NOT NULL,
    "from_plan_code" VARCHAR(50),
    "to_plan_code" VARCHAR(50),
    "reason" TEXT,
    "actor_user_id" UUID,
    "actor_type" VARCHAR(20) NOT NULL,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_lifecycle_events" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_lifecycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "plan_code" VARCHAR(50) NOT NULL,
    "trial_started_at" TIMESTAMPTZ NOT NULL,
    "trial_ends_at" TIMESTAMPTZ NOT NULL,
    "trial_duration_days" INTEGER NOT NULL,
    "converted_at" TIMESTAMPTZ,
    "converted_to_plan_code" VARCHAR(50),
    "expired_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complimentary_access" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "plan_code" VARCHAR(50) NOT NULL,
    "granted_by_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by_user_id" UUID,
    "revoke_reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complimentary_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_migrations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "from_subscription_id" UUID NOT NULL,
    "to_subscription_id" UUID NOT NULL,
    "from_plan_code" VARCHAR(50) NOT NULL,
    "to_plan_code" VARCHAR(50) NOT NULL,
    "direction" VARCHAR(20) NOT NULL,
    "from_billing_period" VARCHAR(20),
    "to_billing_period" VARCHAR(20),
    "prorated_credit_amount" INTEGER NOT NULL DEFAULT 0,
    "prorated_charge_amount" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
    "effective_at" TIMESTAMPTZ NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "payment_id" UUID,
    "initiated_by_user_id" UUID,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_overrides" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entitlement_key" VARCHAR(100) NOT NULL,
    "override_type" VARCHAR(30) NOT NULL,
    "numeric_value" INTEGER,
    "boolean_value" BOOLEAN,
    "reason" TEXT NOT NULL,
    "source_type" VARCHAR(30) NOT NULL,
    "source_id" UUID,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by_user_id" UUID,
    "revoke_reason" TEXT,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlement_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "internal_notes" TEXT,
    "discount_type" VARCHAR(30) NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
    "applies_to_billing_period" VARCHAR(10) NOT NULL DEFAULT 'any',
    "max_redemptions" INTEGER,
    "max_redemptions_per_org" INTEGER NOT NULL DEFAULT 1,
    "current_redemptions" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "minimum_plan_tier" VARCHAR(30),
    "bonus_entitlement_key" VARCHAR(100),
    "bonus_entitlement_value" INTEGER,
    "bonus_duration_days" INTEGER,
    "trial_extension_days" INTEGER,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subscription_id" UUID,
    "payment_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'reserved',
    "discount_amount_applied" INTEGER,
    "original_amount" INTEGER,
    "reserved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed_at" TIMESTAMPTZ,
    "rolled_back_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_plan_rules" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "plan_code" VARCHAR(50) NOT NULL,
    "rule_type" VARCHAR(10) NOT NULL,

    CONSTRAINT "coupon_plan_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_user_assignments" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ,

    CONSTRAINT "coupon_user_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_org_assignments" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ,

    CONSTRAINT "coupon_org_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "internal_notes" TEXT,
    "promotion_type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "max_redemptions" INTEGER,
    "max_redemptions_per_org" INTEGER NOT NULL DEFAULT 1,
    "current_redemptions" INTEGER NOT NULL DEFAULT 0,
    "is_stackable_with_coupons" BOOLEAN NOT NULL DEFAULT false,
    "is_stackable_with_promos" BOOLEAN NOT NULL DEFAULT false,
    "is_displayed_on_pricing" BOOLEAN NOT NULL DEFAULT false,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_rules" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "rule_type" VARCHAR(30) NOT NULL,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "promotion_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_benefits" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "benefit_type" VARCHAR(30) NOT NULL,
    "discount_value" INTEGER,
    "bonus_entitlement_key" VARCHAR(100),
    "bonus_entitlement_value" INTEGER,
    "bonus_duration_days" INTEGER,
    "trial_extension_days" INTEGER,
    "applies_to_billing_period" VARCHAR(10) NOT NULL DEFAULT 'any',

    CONSTRAINT "promotion_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subscription_id" UUID,
    "payment_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'applied',
    "discount_amount_applied" INTEGER,
    "original_amount" INTEGER,
    "benefits_applied_json" JSONB NOT NULL DEFAULT '{}',
    "revoked_at" TIMESTAMPTZ,
    "revoke_reason" TEXT,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_plan_rules" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "plan_code" VARCHAR(50) NOT NULL,
    "rule_type" VARCHAR(10) NOT NULL,

    CONSTRAINT "promotion_plan_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_price_snapshots" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_code" VARCHAR(50) NOT NULL,
    "plan_id" UUID,
    "plan_name" VARCHAR(100) NOT NULL,
    "billing_period" VARCHAR(20) NOT NULL,
    "base_price_amount" INTEGER NOT NULL,
    "coupon_id" UUID,
    "coupon_code" VARCHAR(50),
    "coupon_discount_amount" INTEGER NOT NULL DEFAULT 0,
    "promotion_id" UUID,
    "promotion_discount_amount" INTEGER NOT NULL DEFAULT 0,
    "total_discount_amount" INTEGER NOT NULL DEFAULT 0,
    "final_amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
    "discounts_stacked" BOOLEAN NOT NULL DEFAULT false,
    "price_source" VARCHAR(20) NOT NULL DEFAULT 'hardcoded',
    "line_items_json" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "idx_permissions_category" ON "permissions"("category");

-- CreateIndex
CREATE INDEX "idx_permissions_resource" ON "permissions"("resource");

-- CreateIndex
CREATE INDEX "idx_role_definitions_system" ON "role_definitions"("is_system");

-- CreateIndex
CREATE UNIQUE INDEX "uq_role_definition_org_slug" ON "role_definitions"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "idx_role_permissions_role" ON "role_permissions"("role_id");

-- CreateIndex
CREATE INDEX "idx_role_permissions_permission" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_role_permission" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "idx_role_hierarchy_parent" ON "role_hierarchy"("parent_role_id");

-- CreateIndex
CREATE INDEX "idx_role_hierarchy_child" ON "role_hierarchy"("child_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_role_hierarchy_edge" ON "role_hierarchy"("parent_role_id", "child_role_id");

-- CreateIndex
CREATE INDEX "idx_role_constraints_a" ON "role_constraints"("role_a_id");

-- CreateIndex
CREATE INDEX "idx_role_constraints_b" ON "role_constraints"("role_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_role_constraint" ON "role_constraints"("role_a_id", "role_b_id", "constraint_type");

-- CreateIndex
CREATE INDEX "idx_member_roles_member" ON "member_roles"("organization_member_id");

-- CreateIndex
CREATE INDEX "idx_member_roles_role" ON "member_roles"("role_definition_id");

-- CreateIndex
CREATE INDEX "idx_member_roles_expires" ON "member_roles"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_member_role" ON "member_roles"("organization_member_id", "role_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "idx_plans_active_visible" ON "plans"("is_active", "is_visible");

-- CreateIndex
CREATE INDEX "idx_plans_category" ON "plans"("category");

-- CreateIndex
CREATE INDEX "idx_plans_display_order" ON "plans"("display_order");

-- CreateIndex
CREATE INDEX "idx_plan_prices_plan" ON "plan_prices"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_plan_price_interval_currency" ON "plan_prices"("plan_id", "billing_interval", "currency");

-- CreateIndex
CREATE INDEX "idx_plan_entitlements_plan" ON "plan_entitlements"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_plan_entitlement_key" ON "plan_entitlements"("plan_id", "key");

-- CreateIndex
CREATE INDEX "idx_plan_feature_flags_plan" ON "plan_feature_flags"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_plan_feature_flag" ON "plan_feature_flags"("plan_id", "flag_key");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE INDEX "idx_sub_history_sub_created" ON "subscription_history"("subscription_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_sub_history_org_created" ON "subscription_history"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_sub_history_action" ON "subscription_history"("action");

-- CreateIndex
CREATE INDEX "idx_lifecycle_event_status_scheduled" ON "subscription_lifecycle_events"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "idx_lifecycle_event_sub" ON "subscription_lifecycle_events"("subscription_id");

-- CreateIndex
CREATE INDEX "idx_lifecycle_event_type_status" ON "subscription_lifecycle_events"("event_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_trial_org_plan" ON "trial_records"("organization_id", "plan_code");

-- CreateIndex
CREATE INDEX "idx_complimentary_org" ON "complimentary_access"("organization_id");

-- CreateIndex
CREATE INDEX "idx_complimentary_status" ON "complimentary_access"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_migrations_payment_id_key" ON "subscription_migrations"("payment_id");

-- CreateIndex
CREATE INDEX "idx_migration_org" ON "subscription_migrations"("organization_id");

-- CreateIndex
CREATE INDEX "idx_migration_status" ON "subscription_migrations"("status");

-- CreateIndex
CREATE INDEX "idx_override_org_key_active" ON "entitlement_overrides"("organization_id", "entitlement_key", "is_active");

-- CreateIndex
CREATE INDEX "idx_override_org_active_expiry" ON "entitlement_overrides"("organization_id", "is_active", "expires_at");

-- CreateIndex
CREATE INDEX "idx_override_source" ON "entitlement_overrides"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "idx_coupon_code" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "idx_coupon_code_hash" ON "coupons"("code_hash");

-- CreateIndex
CREATE INDEX "idx_coupon_active_archived" ON "coupons"("is_active", "is_archived");

-- CreateIndex
CREATE INDEX "idx_coupon_date_range" ON "coupons"("starts_at", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_payment_id_key" ON "coupon_redemptions"("payment_id");

-- CreateIndex
CREATE INDEX "idx_redemption_coupon_org" ON "coupon_redemptions"("coupon_id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_redemption_coupon_status" ON "coupon_redemptions"("coupon_id", "status");

-- CreateIndex
CREATE INDEX "idx_redemption_org_status" ON "coupon_redemptions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_redemption_status_expiry" ON "coupon_redemptions"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_coupon_plan_rule" ON "coupon_plan_rules"("coupon_id", "plan_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_coupon_user_assignment" ON "coupon_user_assignments"("coupon_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_coupon_org_assignment" ON "coupon_org_assignments"("coupon_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_slug_key" ON "promotions"("slug");

-- CreateIndex
CREATE INDEX "idx_promotion_status_dates" ON "promotions"("status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "idx_promotion_status_priority" ON "promotions"("status", "priority");

-- CreateIndex
CREATE INDEX "idx_promotion_display_status" ON "promotions"("is_displayed_on_pricing", "status");

-- CreateIndex
CREATE INDEX "idx_promo_rule_promo_active" ON "promotion_rules"("promotion_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_promo_benefit_promo" ON "promotion_benefits"("promotion_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_payment_id_key" ON "promotion_redemptions"("payment_id");

-- CreateIndex
CREATE INDEX "idx_promo_redemption_promo_org" ON "promotion_redemptions"("promotion_id", "organization_id");

-- CreateIndex
CREATE INDEX "idx_promo_redemption_promo_status" ON "promotion_redemptions"("promotion_id", "status");

-- CreateIndex
CREATE INDEX "idx_promo_redemption_org_status" ON "promotion_redemptions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_promotion_plan_rule" ON "promotion_plan_rules"("promotion_id", "plan_code");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_price_snapshots_payment_id_key" ON "checkout_price_snapshots"("payment_id");

-- CreateIndex
CREATE INDEX "idx_checkout_snapshot_org" ON "checkout_price_snapshots"("organization_id");

-- CreateIndex
CREATE INDEX "idx_checkout_snapshot_payment" ON "checkout_price_snapshots"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_xendit_payment_method_id_key" ON "payment_methods"("xendit_payment_method_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_xendit_invoice_id_key" ON "payments"("xendit_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_xendit_subscription_id_key" ON "subscriptions"("xendit_subscription_id");

-- CreateIndex
CREATE INDEX "idx_subscriptions_plan" ON "subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "idx_subscriptions_org" ON "subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX "idx_subscriptions_status" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "idx_subscriptions_org_status" ON "subscriptions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_subscriptions_created_desc" ON "subscriptions"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_definitions" ADD CONSTRAINT "role_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_hierarchy" ADD CONSTRAINT "role_hierarchy_parent_role_id_fkey" FOREIGN KEY ("parent_role_id") REFERENCES "role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_hierarchy" ADD CONSTRAINT "role_hierarchy_child_role_id_fkey" FOREIGN KEY ("child_role_id") REFERENCES "role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_constraints" ADD CONSTRAINT "role_constraints_role_a_id_fkey" FOREIGN KEY ("role_a_id") REFERENCES "role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_constraints" ADD CONSTRAINT "role_constraints_role_b_id_fkey" FOREIGN KEY ("role_b_id") REFERENCES "role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_organization_member_id_fkey" FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_role_definition_id_fkey" FOREIGN KEY ("role_definition_id") REFERENCES "role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_feature_flags" ADD CONSTRAINT "plan_feature_flags_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_lifecycle_events" ADD CONSTRAINT "subscription_lifecycle_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_lifecycle_events" ADD CONSTRAINT "subscription_lifecycle_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_records" ADD CONSTRAINT "trial_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_records" ADD CONSTRAINT "trial_records_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complimentary_access" ADD CONSTRAINT "complimentary_access_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complimentary_access" ADD CONSTRAINT "complimentary_access_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complimentary_access" ADD CONSTRAINT "complimentary_access_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complimentary_access" ADD CONSTRAINT "complimentary_access_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_migrations" ADD CONSTRAINT "subscription_migrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_migrations" ADD CONSTRAINT "subscription_migrations_from_subscription_id_fkey" FOREIGN KEY ("from_subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_migrations" ADD CONSTRAINT "subscription_migrations_to_subscription_id_fkey" FOREIGN KEY ("to_subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_migrations" ADD CONSTRAINT "subscription_migrations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_migrations" ADD CONSTRAINT "subscription_migrations_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_plan_rules" ADD CONSTRAINT "coupon_plan_rules_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_user_assignments" ADD CONSTRAINT "coupon_user_assignments_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_user_assignments" ADD CONSTRAINT "coupon_user_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_org_assignments" ADD CONSTRAINT "coupon_org_assignments_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_org_assignments" ADD CONSTRAINT "coupon_org_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_rules" ADD CONSTRAINT "promotion_rules_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_benefits" ADD CONSTRAINT "promotion_benefits_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_plan_rules" ADD CONSTRAINT "promotion_plan_rules_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_price_snapshots" ADD CONSTRAINT "checkout_price_snapshots_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_price_snapshots" ADD CONSTRAINT "checkout_price_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_price_snapshots" ADD CONSTRAINT "checkout_price_snapshots_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_price_snapshots" ADD CONSTRAINT "checkout_price_snapshots_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_price_snapshots" ADD CONSTRAINT "checkout_price_snapshots_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

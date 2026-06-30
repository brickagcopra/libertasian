-- Add refund tracking columns to payments, populated from Xendit refund.succeeded webhooks.
-- All columns are additive + nullable: existing rows keep NULL until a refund is processed.
-- refund_id is unique so a replayed refund webhook cannot create a second refunded row,
-- and refunded_amount is stored in centavos to match the existing `amount` column.
ALTER TABLE "payments"
  ADD COLUMN "refunded_at" TIMESTAMPTZ,
  ADD COLUMN "refunded_amount" INTEGER,
  ADD COLUMN "refund_id" VARCHAR(255),
  ADD COLUMN "refund_reason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payments_refund_id_key" ON "payments"("refund_id");

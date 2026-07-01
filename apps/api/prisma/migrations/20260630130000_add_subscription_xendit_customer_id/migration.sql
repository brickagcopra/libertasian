-- Add the Xendit Customer id to subscriptions, populated when a recurring
-- subscription checkout session is created. Additive + nullable; reusable across
-- re-subscriptions for the same organization. Not unique: an org may have
-- multiple subscription rows (history) referencing the same Xendit Customer.
ALTER TABLE "subscriptions" ADD COLUMN "xendit_customer_id" VARCHAR(255);

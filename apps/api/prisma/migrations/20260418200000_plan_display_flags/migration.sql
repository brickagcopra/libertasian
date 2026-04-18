-- AlterTable
ALTER TABLE "plans" ADD COLUMN "is_featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plans" ADD COLUMN "featured_label" VARCHAR(50);
ALTER TABLE "plans" ADD COLUMN "cta_text" VARCHAR(50);
ALTER TABLE "plans" ADD COLUMN "highlight_color" VARCHAR(20);

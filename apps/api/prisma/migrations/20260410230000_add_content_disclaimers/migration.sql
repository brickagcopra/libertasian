-- CreateTable
CREATE TABLE "content_disclaimers" (
    "id" UUID NOT NULL,
    "content_class" VARCHAR(100) NOT NULL,
    "body_html" TEXT NOT NULL,
    "body_plain" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "author_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "content_disclaimers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_disclaimers_content_class_key" ON "content_disclaimers"("content_class");

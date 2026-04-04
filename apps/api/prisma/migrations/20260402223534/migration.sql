-- AlterTable
ALTER TABLE "document_similarities" ADD COLUMN     "canonical_document_id" UUID,
ADD COLUMN     "classification_confidence" REAL,
ADD COLUMN     "classification_metadata_json" JSONB,
ADD COLUMN     "classification_tier" VARCHAR(30),
ADD COLUMN     "reviewed_at" TIMESTAMPTZ,
ADD COLUMN     "reviewed_by_user_id" UUID;

-- AlterTable
ALTER TABLE "ingestion_candidates" ADD COLUMN     "dedup_classification" VARCHAR(30),
ADD COLUMN     "dedup_confidence" REAL,
ADD COLUMN     "ingestion_job_id" UUID,
ADD COLUMN     "matched_document_id" UUID,
ADD COLUMN     "processed_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "ingestion_jobs" ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "records_duplicate" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "records_skipped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trigger_type" VARCHAR(20) NOT NULL DEFAULT 'scheduled',
ADD COLUMN     "triggered_by_user_id" UUID;

-- AlterTable
ALTER TABLE "legal_document_tag_map" ADD COLUMN     "classified_by" VARCHAR(30) NOT NULL DEFAULT 'rule_based',
ADD COLUMN     "confidence" REAL,
ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "review_status" VARCHAR(20) NOT NULL DEFAULT 'auto';

-- CreateTable
CREATE TABLE "feed_posts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "text_content" TEXT,
    "visibility" VARCHAR(20) NOT NULL DEFAULT 'organization',
    "status" VARCHAR(20) NOT NULL DEFAULT 'published',
    "media_id" UUID,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "bookmark_count" INTEGER NOT NULL DEFAULT 0,
    "report_count" INTEGER NOT NULL DEFAULT 0,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "edited_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "feed_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_post_media" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "original_object_key" TEXT NOT NULL,
    "processed_object_key" TEXT,
    "thumbnail_object_key" TEXT,
    "mime_type" VARCHAR(50) NOT NULL,
    "original_file_size" INTEGER NOT NULL,
    "processed_file_size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "sha256_checksum" VARCHAR(64) NOT NULL,
    "processing_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "moderation_status" VARCHAR(20) NOT NULL DEFAULT 'unreviewed',
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_post_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_media_processing_jobs" (
    "id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "job_type" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_media_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_comments" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "parent_id" UUID,
    "text_content" TEXT NOT NULL,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'published',
    "edited_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "feed_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_post_likes" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_comment_likes" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_comment_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_post_bookmarks" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_post_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_post_reports" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "reason" VARCHAR(30) NOT NULL,
    "details" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "resolved_by_user_id" UUID,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_post_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content_type" VARCHAR(30) NOT NULL,
    "content_id" UUID NOT NULL,
    "format" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "object_key" TEXT,
    "filename" VARCHAR(255),
    "file_size_bytes" INTEGER,
    "failure_reason" TEXT,
    "expires_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feed_posts_media_id_key" ON "feed_posts"("media_id");

-- CreateIndex
CREATE INDEX "idx_feed_post_org_created" ON "feed_posts"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_feed_post_author_created" ON "feed_posts"("author_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_feed_post_vis_status_created" ON "feed_posts"("visibility", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_feed_post_vis_status_org_created" ON "feed_posts"("visibility", "status", "organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_feed_media_owner" ON "feed_post_media"("owner_user_id");

-- CreateIndex
CREATE INDEX "idx_feed_media_org" ON "feed_post_media"("organization_id");

-- CreateIndex
CREATE INDEX "idx_feed_media_processing_status" ON "feed_post_media"("processing_status");

-- CreateIndex
CREATE INDEX "idx_feed_media_job_media" ON "feed_media_processing_jobs"("media_id");

-- CreateIndex
CREATE INDEX "idx_feed_comment_post_created" ON "feed_comments"("post_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_feed_comment_author" ON "feed_comments"("author_id");

-- CreateIndex
CREATE INDEX "idx_feed_comment_parent" ON "feed_comments"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_feed_post_like_post_user" ON "feed_post_likes"("post_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_feed_comment_like_comment_user" ON "feed_comment_likes"("comment_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_feed_post_bookmark_post_user" ON "feed_post_bookmarks"("post_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_feed_post_report_status" ON "feed_post_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_feed_post_report_post_reporter" ON "feed_post_reports"("post_id", "reporter_user_id");

-- CreateIndex
CREATE INDEX "idx_export_jobs_user" ON "export_jobs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_export_jobs_status_expiry" ON "export_jobs"("status", "expires_at");

-- CreateIndex
CREATE INDEX "idx_doc_similarity_tier" ON "document_similarities"("classification_tier");

-- CreateIndex
CREATE INDEX "idx_candidate_job_id" ON "ingestion_candidates"("ingestion_job_id");

-- CreateIndex
CREATE INDEX "idx_candidate_dedup_class" ON "ingestion_candidates"("dedup_classification");

-- CreateIndex
CREATE INDEX "idx_tag_map_review_status" ON "legal_document_tag_map"("review_status");

-- AddForeignKey
ALTER TABLE "document_similarities" ADD CONSTRAINT "document_similarities_canonical_document_id_fkey" FOREIGN KEY ("canonical_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_similarities" ADD CONSTRAINT "document_similarities_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_candidates" ADD CONSTRAINT "ingestion_candidates_matched_document_id_fkey" FOREIGN KEY ("matched_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_candidates" ADD CONSTRAINT "ingestion_candidates_ingestion_job_id_fkey" FOREIGN KEY ("ingestion_job_id") REFERENCES "ingestion_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "feed_post_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_media" ADD CONSTRAINT "feed_post_media_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_media" ADD CONSTRAINT "feed_post_media_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_media_processing_jobs" ADD CONSTRAINT "feed_media_processing_jobs_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "feed_post_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "feed_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_likes" ADD CONSTRAINT "feed_post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_likes" ADD CONSTRAINT "feed_post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comment_likes" ADD CONSTRAINT "feed_comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "feed_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_comment_likes" ADD CONSTRAINT "feed_comment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_bookmarks" ADD CONSTRAINT "feed_post_bookmarks_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_bookmarks" ADD CONSTRAINT "feed_post_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_reports" ADD CONSTRAINT "feed_post_reports_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_reports" ADD CONSTRAINT "feed_post_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_post_reports" ADD CONSTRAINT "feed_post_reports_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

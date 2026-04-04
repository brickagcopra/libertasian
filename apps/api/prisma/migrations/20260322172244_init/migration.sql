-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255),
    "full_name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verify_token" VARCHAR(255),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" VARCHAR(500),
    "google_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "onboarding_completed_at" TIMESTAMPTZ,
    "user_role" VARCHAR(30),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "family_id" UUID NOT NULL,
    "device_fingerprint" VARCHAR(500),
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "replaced_by_token_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'individual',
    "billing_owner_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'member',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_code" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "billing_period" VARCHAR(20) NOT NULL DEFAULT 'monthly',
    "current_period_start" TIMESTAMPTZ,
    "current_period_end" TIMESTAMPTZ,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "entitlements_json" JSONB NOT NULL DEFAULT '{}',
    "paymongo_subscription_id" VARCHAR(255),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ,
    "trial_start" TIMESTAMPTZ,
    "trial_end" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "paymongo_payment_method_id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "brand" VARCHAR(50),
    "last4" VARCHAR(4),
    "expiry_month" INTEGER,
    "expiry_year" INTEGER,
    "billing_email" VARCHAR(255),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID,
    "payment_method_id" UUID,
    "paymongo_payment_intent_id" VARCHAR(255) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "payment_type" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "paid_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID,
    "payment_id" UUID,
    "invoice_number" VARCHAR(50) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "description" TEXT,
    "line_items_json" JSONB NOT NULL DEFAULT '[]',
    "billing_period_start" TIMESTAMPTZ,
    "billing_period_end" TIMESTAMPTZ,
    "due_date" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_invites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'member',
    "token_hash" VARCHAR(128) NOT NULL,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "domain" VARCHAR(255),
    "trust_level" VARCHAR(10) NOT NULL DEFAULT 'medium',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "fetch_strategy" VARCHAR(20) NOT NULL DEFAULT 'crawler',
    "health_score" REAL,
    "last_health_check_at" TIMESTAMPTZ,
    "health_metadata_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_endpoints" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "endpoint_url" TEXT NOT NULL,
    "content_type_hint" VARCHAR(50),
    "schedule_cron" VARCHAR(100),
    "parser_type" VARCHAR(50) NOT NULL,
    "last_fetched_at" TIMESTAMPTZ,
    "last_success_at" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',

    CONSTRAINT "source_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" UUID NOT NULL,
    "source_id" UUID,
    "canonical_url" TEXT,
    "external_id" VARCHAR(255),
    "document_type" VARCHAR(30) NOT NULL,
    "jurisdiction" VARCHAR(50) DEFAULT 'PH',
    "title" TEXT NOT NULL,
    "short_title" VARCHAR(500),
    "citation_text" VARCHAR(500),
    "gr_no" VARCHAR(100),
    "docket_no" VARCHAR(100),
    "promulgation_date" DATE,
    "decision_date" DATE,
    "publication_date" DATE,
    "ponente" VARCHAR(255),
    "court" VARCHAR(255),
    "agency" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "language" VARCHAR(10) DEFAULT 'en',
    "checksum" VARCHAR(128),
    "version_no" INTEGER NOT NULL DEFAULT 1,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "truthfulness_status" VARCHAR(20) NOT NULL DEFAULT 'needs_review',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_document_versions" (
    "id" UUID NOT NULL,
    "legal_document_id" UUID NOT NULL,
    "raw_file_object_key" TEXT,
    "normalized_text_object_key" TEXT,
    "html_object_key" TEXT,
    "extracted_json" JSONB,
    "snapshot_hash" VARCHAR(128) NOT NULL,
    "parser_version" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_document_sections" (
    "id" UUID NOT NULL,
    "legal_document_id" UUID NOT NULL,
    "parent_section_id" UUID,
    "section_type" VARCHAR(30) NOT NULL,
    "section_label" VARCHAR(255),
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "plain_text" TEXT,
    "html_text" TEXT,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "token_count" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_document_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_metadata_tags" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "tag_type" VARCHAR(30) NOT NULL,

    CONSTRAINT "legal_metadata_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_document_tag_map" (
    "id" UUID NOT NULL,
    "legal_document_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "legal_document_tag_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citations" (
    "id" UUID NOT NULL,
    "from_document_id" UUID NOT NULL,
    "from_section_id" UUID,
    "to_document_id" UUID,
    "citation_text" TEXT NOT NULL,
    "citation_type" VARCHAR(20) NOT NULL,
    "normalized_citation" VARCHAR(500),
    "confidence" REAL,
    "resolved_at" TIMESTAMPTZ,
    "resolver_method" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embeddings" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "embedding_model" VARCHAR(100) NOT NULL,
    "vector_ref" TEXT NOT NULL,
    "sparse_vector_ref" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digests" (
    "id" UUID NOT NULL,
    "legal_document_id" UUID,
    "organization_id" UUID,
    "user_id" UUID,
    "assigned_reviewer_user_id" UUID,
    "source_origin" VARCHAR(30) NOT NULL,
    "title" TEXT NOT NULL,
    "digest_type" VARCHAR(30) NOT NULL,
    "facts" TEXT,
    "issues" TEXT,
    "ruling" TEXT,
    "doctrine" TEXT,
    "dispositive" TEXT,
    "summary" TEXT,
    "petitioner_arguments" TEXT,
    "respondent_arguments" TEXT,
    "cited_authorities_json" JSONB NOT NULL DEFAULT '[]',
    "confidence_score" REAL,
    "review_status" VARCHAR(30) NOT NULL DEFAULT 'draft',
    "visibility" VARCHAR(20) NOT NULL DEFAULT 'private',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digest_reviews" (
    "id" UUID NOT NULL,
    "digest_id" UUID NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "verdict" VARCHAR(10) NOT NULL,
    "notes" TEXT,
    "truthfulness_score" REAL,
    "completeness_score" REAL,
    "citation_accuracy_score" REAL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digest_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctrine_extracts" (
    "id" UUID NOT NULL,
    "legal_document_id" UUID,
    "digest_id" UUID,
    "text" TEXT NOT NULL,
    "normalized_text" TEXT,
    "doctrine_type" VARCHAR(50),
    "source_section_id" UUID,
    "confidence" REAL,
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctrine_extracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctrine_links" (
    "id" UUID NOT NULL,
    "from_doctrine_id" UUID NOT NULL,
    "to_doctrine_id" UUID NOT NULL,
    "link_type" VARCHAR(30) NOT NULL,
    "confidence" REAL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctrine_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_similarities" (
    "id" UUID NOT NULL,
    "document_a_id" UUID NOT NULL,
    "document_b_id" UUID NOT NULL,
    "similarity_score" REAL NOT NULL,
    "similarity_type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_similarities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_codal_links" (
    "id" UUID NOT NULL,
    "case_document_id" UUID NOT NULL,
    "codal_document_id" UUID NOT NULL,
    "codal_section_id" UUID,
    "link_type" VARCHAR(30) NOT NULL,
    "notes" TEXT,
    "confidence" REAL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_codal_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "matter_type" VARCHAR(50),
    "court" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_documents" (
    "id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "legal_document_id" UUID,
    "user_upload_id" UUID,
    "title" VARCHAR(500),
    "role" VARCHAR(20) NOT NULL DEFAULT 'reference',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matter_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "matter_id" UUID,
    "title" VARCHAR(500),
    "body" JSONB NOT NULL DEFAULT '{}',
    "visibility" VARCHAR(20) NOT NULL DEFAULT 'private',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legal_document_id" UUID NOT NULL,
    "legal_document_section_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legal_document_id" UUID NOT NULL,
    "section_id" UUID,
    "text_anchor" JSONB NOT NULL,
    "annotation_text" TEXT,
    "color" VARCHAR(20) DEFAULT 'yellow',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "matter_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'todo',
    "priority" VARCHAR(10) NOT NULL DEFAULT 'medium',
    "due_date" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_comments" (
    "id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matter_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_shares" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "permission" VARCHAR(10) NOT NULL DEFAULT 'view',
    "password_hash" VARCHAR(255),
    "label" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ,
    "last_accessed_at" TIMESTAMPTZ,
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_uploads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "upload_type" VARCHAR(20) NOT NULL,
    "original_filename" VARCHAR(500),
    "mime_type" VARCHAR(100),
    "object_key" TEXT NOT NULL,
    "checksum" VARCHAR(128),
    "page_count" INTEGER,
    "ocr_status" VARCHAR(20) DEFAULT 'pending',
    "processing_status" VARCHAR(20) DEFAULT 'pending',
    "privacy_level" VARCHAR(30) NOT NULL DEFAULT 'private',
    "classified_document_type" VARCHAR(50),
    "extracted_citations_json" JSONB,
    "ocr_text_object_key" TEXT,
    "digest_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camera_captures" (
    "id" UUID NOT NULL,
    "user_upload_id" UUID NOT NULL,
    "device_platform" VARCHAR(20),
    "capture_mode" VARCHAR(20) NOT NULL DEFAULT 'single_page',
    "image_count" INTEGER NOT NULL DEFAULT 1,
    "enhancement_profile" VARCHAR(50),
    "capture_quality_score" REAL,
    "extracted_text_status" VARCHAR(20) DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camera_captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_processing_jobs" (
    "id" UUID NOT NULL,
    "user_upload_id" UUID NOT NULL,
    "job_type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_results" (
    "id" UUID NOT NULL,
    "user_upload_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "quality_score" REAL,
    "ocr_confidence" REAL,
    "language_detected" VARCHAR(10),
    "extracted_text_object_key" TEXT NOT NULL,
    "word_count" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocr_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_jobs" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "source_endpoint_id" UUID,
    "job_type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "records_found" INTEGER DEFAULT 0,
    "records_created" INTEGER DEFAULT 0,
    "records_updated" INTEGER DEFAULT 0,
    "errors_json" JSONB DEFAULT '[]',

    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_candidates" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "detected_url" TEXT,
    "detected_title" TEXT,
    "detected_document_type" VARCHAR(30),
    "checksum" VARCHAR(128),
    "similarity_key" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editorial_flags" (
    "id" UUID NOT NULL,
    "legal_document_id" UUID,
    "digest_id" UUID,
    "flag_type" VARCHAR(30) NOT NULL,
    "severity" VARCHAR(10) NOT NULL DEFAULT 'medium',
    "details" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "editorial_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "actor_user_id" UUID,
    "actor_type" VARCHAR(10) NOT NULL DEFAULT 'user',
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "metadata_json" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "body" TEXT,
    "entity_type" VARCHAR(50),
    "entity_id" UUID,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_runs" (
    "id" UUID NOT NULL,
    "run_type" VARCHAR(30) NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "model_version" VARCHAR(100),
    "prompt_template_version" VARCHAR(50),
    "input_ref" TEXT,
    "output_ref" TEXT,
    "confidence" REAL,
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provenance_records" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "source_document_id" UUID NOT NULL,
    "source_section_id" UUID,
    "provenance_type" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flashcard_sets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "bar_subject" VARCHAR(50),
    "topic" VARCHAR(255),
    "visibility" VARCHAR(20) NOT NULL DEFAULT 'private',
    "card_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flashcard_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flashcards" (
    "id" UUID NOT NULL,
    "flashcard_set_id" UUID NOT NULL,
    "legal_document_id" UUID,
    "section_id" UUID,
    "digest_id" UUID,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "source_type" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flashcards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewer_packs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "creator_user_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "bar_subject" VARCHAR(50),
    "topic" VARCHAR(255),
    "visibility" VARCHAR(20) NOT NULL DEFAULT 'private',
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviewer_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewer_pack_items" (
    "id" UUID NOT NULL,
    "reviewer_pack_id" UUID NOT NULL,
    "item_type" VARCHAR(20) NOT NULL,
    "legal_document_id" UUID,
    "digest_id" UUID,
    "section_id" UUID,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviewer_pack_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'not_started',
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "last_accessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flashcard_reviews" (
    "id" UUID NOT NULL,
    "flashcard_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "response" VARCHAR(10) NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 3,
    "reviewed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "interval" INTEGER NOT NULL DEFAULT 0,
    "ease_factor" REAL NOT NULL DEFAULT 2.5,

    CONSTRAINT "flashcard_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_streaks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "longest_streak" INTEGER NOT NULL DEFAULT 0,
    "last_study_date" DATE,
    "total_study_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_streaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" UUID NOT NULL,
    "bar_subject" VARCHAR(50),
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "duration_secs" INTEGER,
    "items_studied" INTEGER NOT NULL DEFAULT 0,
    "items_correct" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bar_syllabi" (
    "id" UUID NOT NULL,
    "bar_subject_code" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "exam_year" INTEGER,
    "topic_count" INTEGER NOT NULL DEFAULT 0,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bar_syllabi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_topics" (
    "id" UUID NOT NULL,
    "syllabus_id" UUID NOT NULL,
    "parent_topic_id" UUID,
    "slug" VARCHAR(200) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syllabus_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_topic_resources" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "resource_type" VARCHAR(30) NOT NULL,
    "resource_id" UUID NOT NULL,
    "title" VARCHAR(500),
    "note" TEXT,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syllabus_topic_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_memos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "matter_id" UUID,
    "query" TEXT NOT NULL,
    "memo_type" VARCHAR(30) NOT NULL,
    "structured_output" JSONB,
    "citations_json" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "confidence_score" REAL,
    "model_run_id" UUID,
    "job_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_memos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pleading_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "court" VARCHAR(255),
    "description" TEXT,
    "template_json" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pleading_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pleadings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "matter_id" UUID,
    "template_id" UUID NOT NULL,
    "input_data" JSONB NOT NULL,
    "generated_output" JSONB,
    "citations_json" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "model_run_id" UUID,
    "job_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pleadings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_comparisons" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "matter_id" UUID,
    "document_ids" JSONB NOT NULL,
    "comparison_type" VARCHAR(30) NOT NULL,
    "result_json" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "model_run_id" UUID,
    "job_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_timelines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "matter_id" UUID,
    "title" VARCHAR(500) NOT NULL,
    "document_ids" JSONB NOT NULL,
    "timeline_json" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "model_run_id" UUID,
    "job_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_timelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hearing_prep_packs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "matter_id" UUID,
    "topic" VARCHAR(500) NOT NULL,
    "issue" TEXT,
    "document_ids" JSONB NOT NULL DEFAULT '[]',
    "input_context" JSONB,
    "pack_json" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "model_run_id" UUID,
    "job_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hearing_prep_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contradiction_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_ids" JSONB NOT NULL,
    "scope" VARCHAR(20) NOT NULL DEFAULT 'selected',
    "topic" VARCHAR(500),
    "result_json" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "model_run_id" UUID,
    "job_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contradiction_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_workspaces" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "context_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_queries" (
    "id" UUID NOT NULL,
    "research_workspace_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "response_json" JSONB,
    "citations_json" JSONB NOT NULL DEFAULT '[]',
    "model_run_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "key_hash" VARCHAR(128) NOT NULL,
    "key_prefix" VARCHAR(12) NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE INDEX "idx_refresh_token_hash" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_refresh_token_user" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_refresh_token_family" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "idx_password_reset_token" ON "password_resets"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_paymongo_subscription_id_key" ON "subscriptions"("paymongo_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_paymongo_payment_method_id_key" ON "payment_methods"("paymongo_payment_method_id");

-- CreateIndex
CREATE INDEX "idx_payment_methods_org" ON "payment_methods"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_paymongo_payment_intent_id_key" ON "payments"("paymongo_payment_intent_id");

-- CreateIndex
CREATE INDEX "idx_payments_org" ON "payments"("organization_id");

-- CreateIndex
CREATE INDEX "idx_payments_status" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "idx_invoices_org" ON "invoices"("organization_id");

-- CreateIndex
CREATE INDEX "idx_invoices_status" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pending_invites_token_hash_key" ON "pending_invites"("token_hash");

-- CreateIndex
CREATE INDEX "idx_pending_invites_token" ON "pending_invites"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "pending_invites_organization_id_email_key" ON "pending_invites"("organization_id", "email");

-- CreateIndex
CREATE INDEX "idx_legal_docs_type" ON "legal_documents"("document_type");

-- CreateIndex
CREATE INDEX "idx_legal_docs_gr_no" ON "legal_documents"("gr_no");

-- CreateIndex
CREATE INDEX "idx_legal_docs_citation" ON "legal_documents"("citation_text");

-- CreateIndex
CREATE INDEX "idx_legal_docs_court_date" ON "legal_documents"("court", "decision_date");

-- CreateIndex
CREATE INDEX "idx_legal_docs_status" ON "legal_documents"("status", "is_published");

-- CreateIndex
CREATE INDEX "idx_sections_doc_id" ON "legal_document_sections"("legal_document_id");

-- CreateIndex
CREATE INDEX "idx_sections_type" ON "legal_document_sections"("section_type");

-- CreateIndex
CREATE UNIQUE INDEX "legal_metadata_tags_code_key" ON "legal_metadata_tags"("code");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_tag_map_legal_document_id_tag_id_key" ON "legal_document_tag_map"("legal_document_id", "tag_id");

-- CreateIndex
CREATE INDEX "idx_citations_from" ON "citations"("from_document_id");

-- CreateIndex
CREATE INDEX "idx_citations_to" ON "citations"("to_document_id");

-- CreateIndex
CREATE INDEX "idx_embeddings_entity" ON "embeddings"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_digests_doc" ON "digests"("legal_document_id");

-- CreateIndex
CREATE INDEX "idx_digests_user" ON "digests"("user_id");

-- CreateIndex
CREATE INDEX "idx_digests_review" ON "digests"("review_status");

-- CreateIndex
CREATE INDEX "idx_digests_reviewer" ON "digests"("assigned_reviewer_user_id");

-- CreateIndex
CREATE INDEX "idx_doctrine_extracts_doc" ON "doctrine_extracts"("legal_document_id");

-- CreateIndex
CREATE INDEX "idx_doctrine_extracts_type" ON "doctrine_extracts"("doctrine_type");

-- CreateIndex
CREATE INDEX "idx_doctrine_extracts_review" ON "doctrine_extracts"("review_status");

-- CreateIndex
CREATE INDEX "idx_doctrine_links_from" ON "doctrine_links"("from_doctrine_id");

-- CreateIndex
CREATE INDEX "idx_doctrine_links_to" ON "doctrine_links"("to_doctrine_id");

-- CreateIndex
CREATE INDEX "idx_doc_similarity_a" ON "document_similarities"("document_a_id");

-- CreateIndex
CREATE INDEX "idx_doc_similarity_b" ON "document_similarities"("document_b_id");

-- CreateIndex
CREATE INDEX "idx_doc_similarity_status" ON "document_similarities"("status");

-- CreateIndex
CREATE INDEX "idx_case_codal_case" ON "case_codal_links"("case_document_id");

-- CreateIndex
CREATE INDEX "idx_case_codal_codal" ON "case_codal_links"("codal_document_id");

-- CreateIndex
CREATE INDEX "idx_case_codal_section" ON "case_codal_links"("codal_section_id");

-- CreateIndex
CREATE INDEX "idx_tasks_org_status" ON "tasks"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_tasks_assignee" ON "tasks"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "idx_tasks_matter" ON "tasks"("matter_id");

-- CreateIndex
CREATE INDEX "idx_tasks_due_date" ON "tasks"("due_date");

-- CreateIndex
CREATE INDEX "idx_task_comments_task" ON "task_comments"("task_id");

-- CreateIndex
CREATE INDEX "idx_matter_comments_matter" ON "matter_comments"("matter_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_shares_token_hash_key" ON "workspace_shares"("token_hash");

-- CreateIndex
CREATE INDEX "idx_workspace_shares_entity" ON "workspace_shares"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_workspace_shares_org" ON "workspace_shares"("organization_id");

-- CreateIndex
CREATE INDEX "idx_user_uploads_digest" ON "user_uploads"("digest_id");

-- CreateIndex
CREATE INDEX "idx_ocr_results_upload" ON "ocr_results"("user_upload_id");

-- CreateIndex
CREATE INDEX "idx_audit_org" ON "audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_actor" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_entity" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_notifications_user_unread" ON "notifications"("user_id", "is_read", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_user_date" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_provenance_entity" ON "provenance_records"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_provenance_source" ON "provenance_records"("source_document_id");

-- CreateIndex
CREATE INDEX "idx_flashcard_sets_user" ON "flashcard_sets"("user_id");

-- CreateIndex
CREATE INDEX "idx_flashcard_sets_subject" ON "flashcard_sets"("bar_subject");

-- CreateIndex
CREATE INDEX "idx_flashcards_set" ON "flashcards"("flashcard_set_id");

-- CreateIndex
CREATE INDEX "idx_reviewer_packs_creator" ON "reviewer_packs"("creator_user_id");

-- CreateIndex
CREATE INDEX "idx_reviewer_packs_subject" ON "reviewer_packs"("bar_subject");

-- CreateIndex
CREATE INDEX "idx_reviewer_pack_items_pack" ON "reviewer_pack_items"("reviewer_pack_id");

-- CreateIndex
CREATE INDEX "idx_study_progress_user" ON "study_progress"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "study_progress_user_id_entity_type_entity_id_key" ON "study_progress"("user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_flashcard_reviews_card" ON "flashcard_reviews"("flashcard_id");

-- CreateIndex
CREATE INDEX "idx_flashcard_reviews_user_date" ON "flashcard_reviews"("user_id", "reviewed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "study_streaks_user_id_key" ON "study_streaks"("user_id");

-- CreateIndex
CREATE INDEX "idx_study_sessions_user_date" ON "study_sessions"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_study_sessions_subject" ON "study_sessions"("bar_subject");

-- CreateIndex
CREATE UNIQUE INDEX "bar_syllabi_bar_subject_code_key" ON "bar_syllabi"("bar_subject_code");

-- CreateIndex
CREATE INDEX "idx_bar_syllabi_ordering" ON "bar_syllabi"("ordering");

-- CreateIndex
CREATE INDEX "idx_syllabus_topics_parent" ON "syllabus_topics"("syllabus_id", "parent_topic_id");

-- CreateIndex
CREATE INDEX "idx_syllabus_topics_ordering" ON "syllabus_topics"("syllabus_id", "ordering");

-- CreateIndex
CREATE UNIQUE INDEX "uq_syllabus_topic_slug" ON "syllabus_topics"("syllabus_id", "slug");

-- CreateIndex
CREATE INDEX "idx_syllabus_topic_resources_ordering" ON "syllabus_topic_resources"("topic_id", "ordering");

-- CreateIndex
CREATE INDEX "idx_legal_memos_org" ON "legal_memos"("organization_id");

-- CreateIndex
CREATE INDEX "idx_legal_memos_user" ON "legal_memos"("user_id");

-- CreateIndex
CREATE INDEX "idx_legal_memos_status" ON "legal_memos"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pleading_templates_slug_key" ON "pleading_templates"("slug");

-- CreateIndex
CREATE INDEX "idx_pleading_templates_category" ON "pleading_templates"("category");

-- CreateIndex
CREATE INDEX "idx_pleadings_org" ON "pleadings"("organization_id");

-- CreateIndex
CREATE INDEX "idx_pleadings_user" ON "pleadings"("user_id");

-- CreateIndex
CREATE INDEX "idx_pleadings_template" ON "pleadings"("template_id");

-- CreateIndex
CREATE INDEX "idx_pleadings_status" ON "pleadings"("status");

-- CreateIndex
CREATE INDEX "idx_case_comparisons_org" ON "case_comparisons"("organization_id");

-- CreateIndex
CREATE INDEX "idx_case_comparisons_user" ON "case_comparisons"("user_id");

-- CreateIndex
CREATE INDEX "idx_case_comparisons_status" ON "case_comparisons"("status");

-- CreateIndex
CREATE INDEX "idx_case_timelines_org" ON "case_timelines"("organization_id");

-- CreateIndex
CREATE INDEX "idx_case_timelines_user" ON "case_timelines"("user_id");

-- CreateIndex
CREATE INDEX "idx_hearing_prep_org" ON "hearing_prep_packs"("organization_id");

-- CreateIndex
CREATE INDEX "idx_hearing_prep_user" ON "hearing_prep_packs"("user_id");

-- CreateIndex
CREATE INDEX "idx_contradiction_reports_org" ON "contradiction_reports"("organization_id");

-- CreateIndex
CREATE INDEX "idx_contradiction_reports_user" ON "contradiction_reports"("user_id");

-- CreateIndex
CREATE INDEX "idx_research_workspaces_org" ON "research_workspaces"("organization_id");

-- CreateIndex
CREATE INDEX "idx_research_workspaces_user" ON "research_workspaces"("user_id");

-- CreateIndex
CREATE INDEX "idx_research_queries_workspace" ON "research_queries"("research_workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "idx_api_keys_org" ON "api_keys"("organization_id");

-- CreateIndex
CREATE INDEX "idx_api_keys_hash" ON "api_keys"("key_hash");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_billing_owner_user_id_fkey" FOREIGN KEY ("billing_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_invites" ADD CONSTRAINT "pending_invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_endpoints" ADD CONSTRAINT "source_endpoints_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_document_sections" ADD CONSTRAINT "legal_document_sections_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_document_sections" ADD CONSTRAINT "legal_document_sections_parent_section_id_fkey" FOREIGN KEY ("parent_section_id") REFERENCES "legal_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_document_tag_map" ADD CONSTRAINT "legal_document_tag_map_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_document_tag_map" ADD CONSTRAINT "legal_document_tag_map_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "legal_metadata_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_from_document_id_fkey" FOREIGN KEY ("from_document_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_from_section_id_fkey" FOREIGN KEY ("from_section_id") REFERENCES "legal_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_to_document_id_fkey" FOREIGN KEY ("to_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digests" ADD CONSTRAINT "digests_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digests" ADD CONSTRAINT "digests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digests" ADD CONSTRAINT "digests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digests" ADD CONSTRAINT "digests_assigned_reviewer_user_id_fkey" FOREIGN KEY ("assigned_reviewer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digest_reviews" ADD CONSTRAINT "digest_reviews_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "digests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digest_reviews" ADD CONSTRAINT "digest_reviews_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctrine_extracts" ADD CONSTRAINT "doctrine_extracts_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctrine_extracts" ADD CONSTRAINT "doctrine_extracts_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "digests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctrine_extracts" ADD CONSTRAINT "doctrine_extracts_source_section_id_fkey" FOREIGN KEY ("source_section_id") REFERENCES "legal_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctrine_links" ADD CONSTRAINT "doctrine_links_from_doctrine_id_fkey" FOREIGN KEY ("from_doctrine_id") REFERENCES "doctrine_extracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctrine_links" ADD CONSTRAINT "doctrine_links_to_doctrine_id_fkey" FOREIGN KEY ("to_doctrine_id") REFERENCES "doctrine_extracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_similarities" ADD CONSTRAINT "document_similarities_document_a_id_fkey" FOREIGN KEY ("document_a_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_similarities" ADD CONSTRAINT "document_similarities_document_b_id_fkey" FOREIGN KEY ("document_b_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_codal_links" ADD CONSTRAINT "case_codal_links_case_document_id_fkey" FOREIGN KEY ("case_document_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_codal_links" ADD CONSTRAINT "case_codal_links_codal_document_id_fkey" FOREIGN KEY ("codal_document_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_codal_links" ADD CONSTRAINT "case_codal_links_codal_section_id_fkey" FOREIGN KEY ("codal_section_id") REFERENCES "legal_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_codal_links" ADD CONSTRAINT "case_codal_links_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_documents" ADD CONSTRAINT "matter_documents_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_documents" ADD CONSTRAINT "matter_documents_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_documents" ADD CONSTRAINT "matter_documents_user_upload_id_fkey" FOREIGN KEY ("user_upload_id") REFERENCES "user_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_legal_document_section_id_fkey" FOREIGN KEY ("legal_document_section_id") REFERENCES "legal_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "legal_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_comments" ADD CONSTRAINT "matter_comments_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_comments" ADD CONSTRAINT "matter_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_shares" ADD CONSTRAINT "workspace_shares_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_shares" ADD CONSTRAINT "workspace_shares_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_uploads" ADD CONSTRAINT "user_uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_uploads" ADD CONSTRAINT "user_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_uploads" ADD CONSTRAINT "user_uploads_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "digests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_captures" ADD CONSTRAINT "camera_captures_user_upload_id_fkey" FOREIGN KEY ("user_upload_id") REFERENCES "user_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_processing_jobs" ADD CONSTRAINT "upload_processing_jobs_user_upload_id_fkey" FOREIGN KEY ("user_upload_id") REFERENCES "user_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_results" ADD CONSTRAINT "ocr_results_user_upload_id_fkey" FOREIGN KEY ("user_upload_id") REFERENCES "user_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_source_endpoint_id_fkey" FOREIGN KEY ("source_endpoint_id") REFERENCES "source_endpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_candidates" ADD CONSTRAINT "ingestion_candidates_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_flags" ADD CONSTRAINT "editorial_flags_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_flags" ADD CONSTRAINT "editorial_flags_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "digests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provenance_records" ADD CONSTRAINT "provenance_records_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provenance_records" ADD CONSTRAINT "provenance_records_source_section_id_fkey" FOREIGN KEY ("source_section_id") REFERENCES "legal_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcard_sets" ADD CONSTRAINT "flashcard_sets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcard_sets" ADD CONSTRAINT "flashcard_sets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_flashcard_set_id_fkey" FOREIGN KEY ("flashcard_set_id") REFERENCES "flashcard_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "legal_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "digests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_packs" ADD CONSTRAINT "reviewer_packs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_packs" ADD CONSTRAINT "reviewer_packs_creator_user_id_fkey" FOREIGN KEY ("creator_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_pack_items" ADD CONSTRAINT "reviewer_pack_items_reviewer_pack_id_fkey" FOREIGN KEY ("reviewer_pack_id") REFERENCES "reviewer_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_pack_items" ADD CONSTRAINT "reviewer_pack_items_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_pack_items" ADD CONSTRAINT "reviewer_pack_items_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "digests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_pack_items" ADD CONSTRAINT "reviewer_pack_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "legal_document_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_progress" ADD CONSTRAINT "study_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcard_reviews" ADD CONSTRAINT "flashcard_reviews_flashcard_id_fkey" FOREIGN KEY ("flashcard_id") REFERENCES "flashcards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcard_reviews" ADD CONSTRAINT "flashcard_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_streaks" ADD CONSTRAINT "study_streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_syllabus_id_fkey" FOREIGN KEY ("syllabus_id") REFERENCES "bar_syllabi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_parent_topic_id_fkey" FOREIGN KEY ("parent_topic_id") REFERENCES "syllabus_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_topic_resources" ADD CONSTRAINT "syllabus_topic_resources_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "syllabus_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_memos" ADD CONSTRAINT "legal_memos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_memos" ADD CONSTRAINT "legal_memos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_memos" ADD CONSTRAINT "legal_memos_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pleadings" ADD CONSTRAINT "pleadings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pleadings" ADD CONSTRAINT "pleadings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pleadings" ADD CONSTRAINT "pleadings_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pleadings" ADD CONSTRAINT "pleadings_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "pleading_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_comparisons" ADD CONSTRAINT "case_comparisons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_comparisons" ADD CONSTRAINT "case_comparisons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_comparisons" ADD CONSTRAINT "case_comparisons_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_timelines" ADD CONSTRAINT "case_timelines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_timelines" ADD CONSTRAINT "case_timelines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_timelines" ADD CONSTRAINT "case_timelines_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_prep_packs" ADD CONSTRAINT "hearing_prep_packs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_prep_packs" ADD CONSTRAINT "hearing_prep_packs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_prep_packs" ADD CONSTRAINT "hearing_prep_packs_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contradiction_reports" ADD CONSTRAINT "contradiction_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contradiction_reports" ADD CONSTRAINT "contradiction_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_workspaces" ADD CONSTRAINT "research_workspaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_workspaces" ADD CONSTRAINT "research_workspaces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_research_workspace_id_fkey" FOREIGN KEY ("research_workspace_id") REFERENCES "research_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

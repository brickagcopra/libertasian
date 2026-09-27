-- Deep Research runs: one row per multi-query verified research answer.
-- Tenant-scoped (organization_id), listed per user newest-first.

-- CreateTable
CREATE TABLE "deep_research_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'running',
    "result_json" JSONB,
    "sources_json" JSONB,
    "sub_queries_json" JSONB,
    "model_name" VARCHAR(100),
    "prompt_template_version" VARCHAR(50),
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "cost_usd" DECIMAL(12,6),
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deep_research_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_deep_research_runs_org_user_created" ON "deep_research_runs"("organization_id", "user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "deep_research_runs" ADD CONSTRAINT "deep_research_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deep_research_runs" ADD CONSTRAINT "deep_research_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

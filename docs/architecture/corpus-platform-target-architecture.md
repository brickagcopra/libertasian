# LIBERTASIAN Corpus Platform — Target Architecture

> **Status:** Draft for review by prod Claude (domain-expert pass) and user sign-off.
> **Scope:** Phase 0 design only. No code, schema, or migrations until this document is approved.
> **Companion:** [research-notes-corpus-platform.md](./research-notes-corpus-platform.md) — every external claim cited there with a URL.
> **Prepared:** 2026-04-10, branch `docs/corpus-platform-architecture`.

---

## 0. Executive summary

LIBERTASIAN today has a working **daily watch loop**: a Celery-driven ingestion pipeline that discovers newly published documents from four Philippine legal sources (LawPhil, SC e-library, Official Gazette, Congress), dedupes them against the existing corpus, and lands them as `legal_document` rows in PostgreSQL with provenance to an S3-backed raw-HTML snapshot. PR #1 repaired the scheduler and parser registry; PR #2 aligned seed defaults with a tiered Option A schedule. The infrastructure works. It is also the **wrong shape** for what the product needs to be.

The target product is three things stacked on top of each other:

1. A **historical corpus** of every legally-reachable Philippine primary source, walked backward as far as each source's archive permits — LawPhil's jurisprudence archive back to 1901, every Republic Act and codal, every Official Gazette issue we can crack, every bar examination the SC has published.
2. An **AI-generated derivative layer** over that corpus — IRAC digests, doctrine extracts, multiple-choice bar review questions, essay prompts, model answers, flashcards, subject outlines, sample pleadings, sample contracts — each carrying a hard "educational purposes only, not legal advice" disclaimer in the database schema itself.
3. An **admin-controlled ingestion engine** where the admin panel exposes start/stop scheduling, a monthly budget ceiling, an optional daily sub-ceiling, backfill batch controls with checkpoint/resume semantics, and explicit halt/resume controls that take effect within the lifetime of the current document rather than the current batch.

The single most important architectural decision in this document is to **add a new `backfill_batches` orchestration layer beside the existing `ingestion_jobs` table rather than overloading `ingestion_jobs`**. A backfill batch is an admin-defined unit of historical work with a budget ceiling, checkpoint state, and a start/finish year-range. It spawns many `ingestion_jobs` as children — one per source-per-month or per-source-per-year window — and those children continue to flow through the same fetcher/dedup/parser pipeline that PR #1 repaired. This keeps the daily watch loop unchanged and intact while giving the historical walk a proper home. Every other piece of the design — the derivative fanout, the prompt strategy, the admin panel, the cost model — flows from this split.

A second material finding from the Phase 0a research pass: **the Supreme Court has moved from the traditional eight-subject bar examination structure to a six core-subject structure** for the 2025 and 2026 bar cycles, per Bar Bulletin No. 1, Series of 2026 (as reported by PhilSTAR Life and corroborated by LexRex and Respicio — the SC's own domain `sc.judiciary.gov.ph` returned HTTP 403 for all programmatic fetches in this research round; see [research notes §6](./research-notes-corpus-platform.md)). The subject-taxonomy section below is designed around the **current six-subject reality** with a back-compat mapping to the legacy eight-subject structure, because our historical corpus of bar exam questions (LawPhil archive 2006–2022) was written under the legacy structure and must stay addressable under it.

A third decision worth flagging up front: **prompt text for every LLM call is deferred to prod Claude**. Every LLM call in Section 5 of this document is specified down to the input schema, output schema, validator, and evaluator — but the actual prompt body is a `<<PROD_CLAUDE_DRAFT_PROMPT_HERE>>` placeholder. Prod Claude is the domain expert and will fill those placeholders in. Local Claude (me) does not have the Philippine legal-pedagogy grounding to write those prompts defensibly.

The document below is organised into twelve sections: current-state and headline findings (§1), target data model (§2), backfill engine design (§3), derivative generation pipeline (§4), prompt strategy (§5), subject taxonomy (§6), admin panel additions (§7), disclaimer and rights tracking (§8), cost model (§9), test strategy (§10), migration plan from current state (§11), and phase plan for implementation (§12). Each section that contains a materially unverified assumption ends with an "Open questions" subsection listing what needs human or prod-Claude input.

---

## 1. Current state and the two headline findings

### 1.1 What already works (and must keep working)

From the codebase reconnaissance pass, the following subsystems are production-quality or very close to it and **carry forward unchanged** into the target architecture:

- **Prisma schema** at `apps/api/prisma/schema.prisma` — 80+ models, extensively indexed. The schema already contains `Source`, `SourceEndpoint`, `LegalDocument`, `LegalDocumentVersion`, `LegalDocumentSection`, `IngestionJob`, `IngestionCandidate`, `Digest`, `DigestReview`, `DoctrineExtract`, `DoctrineLink`, `ProvenanceRecord`, `ModelRun`, `AuditLog`, `AiSettings`, `LegalMetadataTag`, `LegalDocumentTagMap`, `Citation`, `CaseCodalLink`, `Flashcard`, `FlashcardSet`, `LegalMemo`, `Pleading`, and `CaseComparison`. This is a much richer starting point than a greenfield design — several of the "new" derivative tables the architecture needs already exist as skeletons.
- **Fetcher layer** at `services/worker-service/src/fetchers/` — `BaseFetcher` enforces SSRF allowlisting, per-request rate limiting (2s default via `settings.ingestion_request_delay`), browser-like User-Agent headers, exponential backoff retry on 429/5xx, and a `CloudflareBlockedError` exception wired into the discover path. Four concrete subclasses (`SupremeCourtFetcher`, `LawphilFetcher`, `OfficialGazetteFetcher`, `CongressFetcher`) extend it. The Congress panel-layout pagination bug is the one known incomplete area.
- **Fetcher registry** at `services/worker-service/src/fetchers/registry.py` — a plain `FETCHER_REGISTRY` dict keyed by `parser_type` string, looked up by `get_fetcher(parser_type)`. Extensible by adding a single dict entry per new source.
- **Dedup classifier** at `services/worker-service/src/classifiers/dedup_classifier.py` — five-tier classification (`EXACT_DUPLICATE`, `MIRROR_DUPLICATE`, `VERSION_UPDATE`, `POSSIBLE_DUPLICATE`, `NEW_DOCUMENT`) with Levenshtein-based title similarity scoped to same-source-same-type. The `DedupResult` dataclass exposes `should_skip_ingestion`, `is_version_update`, and `needs_review` convenience properties. This works well and nothing in the target architecture changes it.
- **Celery task graph** at `services/worker-service/src/tasks/ingestion_tasks.py` — `poll_pending_ingestion_jobs` → `run_ingestion_job` → `process_ingestion_candidate` → optional `chain_post_ingestion`. All tasks declared `acks_late=True`, `reject_on_worker_lost=True`. The backfill engine in §3 plugs into this graph as a **new parent task** rather than replacing any of it.
- **NestJS scheduler service** at `apps/api/src/modules/sources/ingestion-scheduler.service.ts` — reads the `ingestion_schedule` value from the `ai_settings` table on a one-minute Nest `@Cron` tick, parses standard five-field cron, matches against current time, and inserts `IngestionJob` rows with the correct `sourceEndpointId`. This was the subject of the PR #1 fix and is now the source of truth for *what* runs and *when*. Celery Beat remains in place only to poll for pending jobs on a 60-second interval.
- **Cost killswitch** — Redis keys `llm:config:monthly_budget_usd` (admin-set ceiling) and `llm:usage:{YYYY-MM}` (accumulated tokens/cost hash), with enforcement at `services/rag-service/src/core/generation.py::_check_budget()` raising `BudgetExceededError` which the FastAPI app maps to HTTP 503. The NestJS side (`apps/api/src/modules/ai-settings/ai-settings.service.ts::syncBudgetToRedis`) pushes the admin-set value from Postgres into Redis on update. The primitive is correct; the target architecture extends it rather than replacing it.
- **Truthfulness validator** at `services/worker-service/src/validators/truthfulness_validator.py` — a pure function `validate_document(**kwargs) -> ValidationResult` with three verdicts (`PUBLISH`, `HUMAN_REVIEW`, `QUARANTINE`). The function is a clean boundary for generalisation to derivative validation (see §4).
- **Admin panel surface** at `apps/web/src/app/(dashboard)/admin/` — 20+ existing pages including `/admin/ingestion` (full job history + stats + per-endpoint status), `/admin/ai-settings` (budget + schedule editor), `/admin/sources` (source CRUD), `/admin/duplicates`, `/admin/flags`, `/admin/doctrines`, `/admin/review`, `/admin/classification`. The target architecture adds pages, it does not rebuild the admin shell.
- **LLM client** at `services/rag-service/src/core/generation.py` — dual backend (OpenAI-primary, vLLM-fallback), streaming and non-streaming paths, per-request token and cost accounting writing through to the Redis monthly hash, `MODEL_PRICING` dict covering `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini`, `gpt-4.1-nano`. Default model is `gpt-4o-mini` at $0.15 per 1M input / $0.60 per 1M output.
- **Audit log** (`AuditLog` model + `AuditService`) — append-only at the application level, schema has indexes on `(organizationId, createdAt DESC)`, `(actorUserId, createdAt DESC)`, and `(entityType, entityId)`. The append-only contract is **not enforced at the database role level** currently — that is a gap the migration plan closes.

### 1.2 What needs to change, at a glance

- **New tables:** `backfill_batches`, `backfill_checkpoints`, `derivative_artifacts`, `derivative_generation_jobs`, `mcq_questions`, `mcq_options`, `essay_prompts`, `essay_rubrics`, `bar_exam_sittings`, `subjects`, `subject_topics`, `document_subject_assignments`, `content_disclaimers`, `budget_ledger`. A few existing tables get small additive columns (see §2.3).
- **New Celery tasks:** `start_backfill_batch`, `enumerate_backfill_candidates`, `run_backfill_batch_tick`, `generate_derivative`, `validate_derivative`, `classify_document_subjects`.
- **Generalised validator:** `validate_output(output_type, ...)` replaces the call site of `validate_document(...)` where derivatives are concerned. Legal-document ingestion keeps using `validate_document(...)` unchanged.
- **Admin panel additions:** Backfill page, Budget page (extends AI-Settings), Schedule page (extends AI-Settings with form-driven cron editor), Derivatives page (re-trigger generation per type per date range), Subjects page (taxonomy browser with AI-assigned counts per subject).
- **Rights and disclaimers:** A new `content_rights` enum on every derivative, and a foreign key from every derivative row into a canonical `content_disclaimers` table that stores the full disclaimer text per content class. The disclaimer must be part of the API response, not a frontend afterthought.

### 1.3 Headline finding #1 — the bar exam uses six subjects now, not eight

The prompt that kicked off this work assumes the Philippine bar examination covers eight subjects: Civil Law, Criminal Law, Remedial Law, Political Law (with Public International Law), Labor Law (with Social Legislation), Commercial/Mercantile Law, Taxation, and Legal/Judicial Ethics. Research (§6 of the research notes) established that the Supreme Court has consolidated the exam into **six core subjects** for at least 2025 and 2026, per Bar Bulletin No. 1, Series of 2026:

1. Political and Public International Law (15%)
2. Commercial and Taxation Laws (20%)
3. Civil Law and Land Titles and Deeds (20%)
4. Labor Law and Social Legislation (10%)
5. Criminal Law (10%)
6. Remedial Law, Legal and Judicial Ethics with Practical Exercises (25%)

This matters architecturally because our historical corpus of bar exam questions — LawPhil's archive under `/courts/bm/barQ/[year]/[subject]_Q.html` — covers **2006 through 2022**, and those questions were written against the legacy eight-subject taxonomy. The 2023 and later bar exams, if and when we acquire them, will be under the six-subject taxonomy. We therefore design the `subjects` table as **versioned by `taxonomy_version`** (see §6) so that a 2015 Mercantile Law question maps cleanly to legacy-8.mercantile, a 2026 Commercial and Taxation Laws question maps cleanly to modern-6.commercial_taxation, and both can be surfaced to a student filtering by "Commercial Law" through a compatibility layer. This is tractable but it is not the frame the original prompt anticipated, and it is load-bearing enough that I want it flagged before any schema work begins.

### 1.4 Headline finding #2 — sc.judiciary.gov.ph blocks programmatic fetches

Every attempted fetch to `sc.judiciary.gov.ph` during the research round returned HTTP 403 from the cloud-originated egress used for this session. Attempted URLs included `/bar-exams/`, `/bar-2025/`, `/category/bar-matters/`, and the Bar Bulletin PDF at `/wp-content/uploads/2025/10/2026-BAR-Bar-Bulletin-No.-1-October-16-2025.pdf`. This means:

- The architecture cannot assume the SC website is a directly crawlable source for bar bulletins, syllabi, or decisions without additional work on the egress side (residential-grade exit, polite compliance policy, or a formal PIO data-access request). Treat SC as a **semi-accessible source** that may require human-in-the-loop fetching for some paths.
- LawPhil (Arellano Law Foundation) remains the primary machine-addressable source for SC decisions and pre-2022 bar questions. Its URL structure is fully enumerable (verified in the research notes) — year index → month index → decision file with a `gr_[NUMBER]_[YEAR].html`, `am_[PREFIX]_[YEAR].html`, or `ac_[NUMBER]_[YEAR].html` filename pattern, back to 1901.
- Official Gazette remains gated on Cloudflare detection that the fetcher base class handles by marking the endpoint blocked rather than crashing the job — but this means OG decisions, EOs, and proclamations may only be ingestible in bursts when Cloudflare is lenient. Treat OG as **semi-official and best-effort**, not as a backbone source.

### 1.5 Open questions

- Does the user have an existing relationship with the SC PIO or Office of the Bar Confidant that we can use to unblock the bar bulletin / syllabus PDFs? The detailed sub-topic taxonomy in §6 is bounded by what the Respicio secondary source summarised — the actual SC syllabus PDFs would let us tag documents with sub-topics at a level the current research notes cannot reach.
- Is there a budget for a residential-grade egress IP specifically for the ingestion worker, or should we design around the assumption that sc.judiciary.gov.ph will remain partially inaccessible for automated fetches?

---

## 2. Target data model

This section specifies the schema changes in Prisma syntax. **These are design artifacts, not schema migrations.** No `schema.prisma` edits happen until this document is signed off.

The changes fall into four buckets: (a) backfill orchestration, (b) derivative artifacts and per-type child tables, (c) subject taxonomy, and (d) small additive columns on existing tables.

### 2.1 Backfill orchestration

A `BackfillBatch` is an admin-defined unit of historical work. It has a source, an optional `sourceEndpointId` if the admin wants to scope by parser type, a year range (start and end inclusive), a budget ceiling in USD, a current spend counter, a checkpoint blob, and a status state machine. Each batch spawns many `IngestionJob` children over its lifetime and is therefore the parent of a many-to-one relationship.

```prisma
model BackfillBatch {
  id                     String    @id @default(uuid()) @db.Uuid
  sourceId               String    @db.Uuid
  sourceEndpointId       String?   @db.Uuid
  name                   String    @db.VarChar(255)  // admin-facing label
  description            String?   @db.Text
  yearStart              Int
  yearEnd                Int
  monthStart             Int?      // 1-12, optional granularity
  monthEnd               Int?
  status                 String    @default("pending") @db.VarChar(20)
  //   pending | enumerating | running | paused | halted_budget | halted_admin | completed | failed
  budgetCeilingUsd       Decimal   @db.Decimal(10, 4)
  budgetConsumedUsd      Decimal   @default(0) @db.Decimal(10, 4)
  candidatesDiscovered   Int       @default(0)
  candidatesProcessed    Int       @default(0)
  candidatesSkipped      Int       @default(0)
  candidatesFailed       Int       @default(0)
  documentsCreated       Int       @default(0)
  documentsUpdated       Int       @default(0)
  checkpointState        Json      @default("{}")
  //   shape: { cursor: { year: 2012, month: 3, decisionIndex: 47 }, lastRunAt: ISO }
  startedAt              DateTime? @db.Timestamptz
  finishedAt             DateTime? @db.Timestamptz
  lastTickAt             DateTime? @db.Timestamptz
  adminNotes             String?   @db.Text
  createdByUserId        String    @db.Uuid
  createdAt              DateTime  @default(now()) @db.Timestamptz
  updatedAt              DateTime  @updatedAt @db.Timestamptz

  source                 Source              @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  sourceEndpoint         SourceEndpoint?     @relation(fields: [sourceEndpointId], references: [id])
  createdByUser          User                @relation("BackfillBatchCreatedBy", fields: [createdByUserId], references: [id])
  ingestionJobs          IngestionJob[]      // children
  checkpoints            BackfillCheckpoint[]

  @@index([sourceId, status])
  @@index([status, lastTickAt])
  @@map("backfill_batches")
}

model BackfillCheckpoint {
  id              String   @id @default(uuid()) @db.Uuid
  backfillBatchId String   @db.Uuid
  cursorJson      Json     // structured cursor (year, month, position within month)
  candidatesSeen  Int      @default(0)
  createdAt       DateTime @default(now()) @db.Timestamptz

  backfillBatch   BackfillBatch @relation(fields: [backfillBatchId], references: [id], onDelete: Cascade)

  @@index([backfillBatchId, createdAt])
  @@map("backfill_checkpoints")
}
```

Key design points:

- `BackfillBatch.status` is a controlled state machine. `halted_budget` is set when the batch hits its ceiling mid-run. `halted_admin` is set when the admin clicks "Halt" in the panel. `paused` is reserved for automatic pauses (e.g., rate-limit backoff on the source exceeded a threshold and the batch should sleep for an hour before resuming). The state machine is enforced at the service layer, not in the database.
- `budgetCeilingUsd` is **per-batch**, independent of the global monthly `llm:config:monthly_budget_usd` killswitch. Both limits apply: a batch stops when it hits either its own ceiling or the global ceiling, whichever comes first. The batch records the reason in `adminNotes` on halt so the admin can see which limit fired.
- `checkpointState` is a JSON blob rather than typed columns because different fetchers will want different cursor shapes. LawPhil's cursor is `{year, month, decisionIndex}`. A SC e-library cursor will be something else. The fetcher owns the cursor shape; the service layer treats it as opaque. The separate `BackfillCheckpoint` table is a write-ahead log of cursor positions for post-mortem recovery if `checkpointState` gets corrupted.
- `BackfillBatch` has a **one-to-many** relation to `IngestionJob` via a new nullable foreign key `ingestion_jobs.backfill_batch_id` (see §2.4). A non-null `backfillBatchId` means "this job was created by a backfill batch"; a null value means "this job was created by the daily watch loop." This single foreign key is the entire integration point between the new backfill engine and the existing ingestion pipeline.

### 2.2 Derivative artifacts

The existing `Digest` table is rich but digest-specific. The target architecture introduces a generalised `DerivativeArtifact` table as the parent of all AI-generated content, with per-type child tables for the data that is specific to each kind. `Digest` stays as-is for backward compatibility; new digests written by the derivative generation pipeline populate both the legacy `Digest` row *and* a `DerivativeArtifact` row during the migration window, then new code reads from `DerivativeArtifact` exclusively. (See migration plan in §11.)

```prisma
model DerivativeArtifact {
  id                    String   @id @default(uuid()) @db.Uuid
  derivativeType        String   @db.VarChar(40)
  //   case_digest | doctrine_extract | mcq_question | essay_prompt | essay_model_answer
  //   | flashcard | subject_outline | sample_pleading | sample_contract | one_page_summary
  sourceDocumentId      String?  @db.Uuid        // NULL for standalone derivatives
  sourceSectionId       String?  @db.Uuid
  organizationId        String?  @db.Uuid        // NULL for editorial-corpus derivatives
  createdByUserId       String?  @db.Uuid        // NULL for system-generated
  derivativeGenerationJobId String? @db.Uuid     // which job produced this

  title                 String   @db.Text
  contentJson           Json     // type-specific structured payload
  contentPlainText      String?  @db.Text        // for search indexing
  contentHash           String   @db.VarChar(128)
  tokenCount            Int?

  confidenceScore       Float?
  reviewStatus          String   @default("draft") @db.VarChar(20)
  //   draft | needs_human_review | approved | rejected
  validatorVerdict      String?  @db.VarChar(20)
  validatorReasonsJson  Json?
  visibility            String   @default("private") @db.VarChar(20)
  //   private | public_editorial | unlisted

  audience              String   @default("both") @db.VarChar(20)
  //   student | practitioner | both

  contentRights         String   @db.VarChar(40)
  //   public_domain_government | ai_generated_derivative | mixed
  contentDisclaimerId   String   @db.Uuid

  modelRunId            String?  @db.Uuid        // links to model_runs
  taxonomyVersion       String?  @db.VarChar(20) // "modern_6" | "legacy_8"
  language              String   @default("en") @db.VarChar(10)

  publishedAt           DateTime? @db.Timestamptz
  createdAt             DateTime @default(now()) @db.Timestamptz
  updatedAt             DateTime @updatedAt @db.Timestamptz

  sourceDocument        LegalDocument?        @relation(fields: [sourceDocumentId], references: [id])
  sourceSection         LegalDocumentSection? @relation(fields: [sourceSectionId], references: [id])
  organization          Organization?         @relation(fields: [organizationId], references: [id])
  createdByUser         User?                 @relation("DerivativeCreatedBy", fields: [createdByUserId], references: [id])
  derivativeGenerationJob DerivativeGenerationJob? @relation(fields: [derivativeGenerationJobId], references: [id])
  modelRun              ModelRun?             @relation(fields: [modelRunId], references: [id])
  contentDisclaimer     ContentDisclaimer     @relation(fields: [contentDisclaimerId], references: [id])

  mcqQuestion           McqQuestion?
  essayPrompt           EssayPrompt?
  provenanceRecords     ProvenanceRecord[]
  subjectAssignments    DocumentSubjectAssignment[]

  @@index([derivativeType, reviewStatus])
  @@index([sourceDocumentId, derivativeType])
  @@index([organizationId, derivativeType])
  @@index([visibility, derivativeType, publishedAt])
  @@unique([sourceDocumentId, derivativeType, taxonomyVersion]) // one digest per source per taxonomy
  @@map("derivative_artifacts")
}

model McqQuestion {
  id                    String   @id @default(uuid()) @db.Uuid
  derivativeArtifactId  String   @unique @db.Uuid
  questionStem          String   @db.Text
  explanation           String?  @db.Text
  difficulty            String   @default("medium") @db.VarChar(10)
  //   easy | medium | hard | bar_exam_level
  questionFormat        String   @default("single_best") @db.VarChar(20)
  //   single_best | multi_select | true_false
  subjectTopicId        String?  @db.Uuid

  derivativeArtifact    DerivativeArtifact @relation(fields: [derivativeArtifactId], references: [id], onDelete: Cascade)
  subjectTopic          SubjectTopic?      @relation(fields: [subjectTopicId], references: [id])
  options               McqOption[]

  @@index([subjectTopicId, difficulty])
  @@map("mcq_questions")
}

model McqOption {
  id               String  @id @default(uuid()) @db.Uuid
  mcqQuestionId    String  @db.Uuid
  optionLabel      String  @db.VarChar(4)    // "A", "B", "C", "D"
  optionText       String  @db.Text
  isCorrect        Boolean @default(false)
  rationale        String? @db.Text          // why this option is right/wrong

  mcqQuestion      McqQuestion @relation(fields: [mcqQuestionId], references: [id], onDelete: Cascade)

  @@unique([mcqQuestionId, optionLabel])
  @@map("mcq_options")
}

model EssayPrompt {
  id                    String   @id @default(uuid()) @db.Uuid
  derivativeArtifactId  String   @unique @db.Uuid
  promptText            String   @db.Text
  suggestedTimeMinutes  Int?
  modelAnswerJson       Json?    // structured model answer (e.g., IRAC outline)
  rubricJson            Json?    // scoring criteria
  subjectTopicId        String?  @db.Uuid
  barExamSittingId      String?  @db.Uuid

  derivativeArtifact    DerivativeArtifact @relation(fields: [derivativeArtifactId], references: [id], onDelete: Cascade)
  subjectTopic          SubjectTopic?      @relation(fields: [subjectTopicId], references: [id])
  barExamSitting        BarExamSitting?    @relation(fields: [barExamSittingId], references: [id])

  @@index([subjectTopicId])
  @@index([barExamSittingId])
  @@map("essay_prompts")
}

model BarExamSitting {
  id                String   @id @default(uuid()) @db.Uuid
  year              Int
  part              String?  @db.VarChar(20)  // e.g., "Day 1 AM", "remedial-I"
  subjectLegacyCode String?  @db.VarChar(40)  // e.g., "remedial_law", "mercantile_law"
  subjectModernCode String?  @db.VarChar(40)
  chairperson       String?  @db.VarChar(255)
  sourceDocumentId  String?  @db.Uuid
  sourceUrl         String?  @db.Text
  taxonomyVersion   String   @db.VarChar(20)

  sourceDocument    LegalDocument? @relation(fields: [sourceDocumentId], references: [id])
  essayPrompts      EssayPrompt[]

  @@unique([year, part, subjectLegacyCode])
  @@index([year])
  @@map("bar_exam_sittings")
}

model DerivativeGenerationJob {
  id                    String   @id @default(uuid()) @db.Uuid
  derivativeType        String   @db.VarChar(40)
  triggerType           String   @db.VarChar(20) // scheduled | manual | backfill_followup
  sourceDocumentId      String?  @db.Uuid
  backfillBatchId       String?  @db.Uuid
  status                String   @default("pending") @db.VarChar(20)
  // pending | running | validating | completed | failed | skipped_budget
  promptTemplateVersion String?  @db.VarChar(40)
  modelName             String?  @db.VarChar(100)
  tokensIn              Int      @default(0)
  tokensOut             Int      @default(0)
  estimatedCostUsd      Decimal  @default(0) @db.Decimal(10, 6)
  startedAt             DateTime? @db.Timestamptz
  finishedAt            DateTime? @db.Timestamptz
  errorJson             Json?
  triggeredByUserId     String?  @db.Uuid
  createdAt             DateTime @default(now()) @db.Timestamptz

  sourceDocument        LegalDocument?    @relation(fields: [sourceDocumentId], references: [id])
  backfillBatch         BackfillBatch?    @relation(fields: [backfillBatchId], references: [id])
  triggeredByUser       User?             @relation("DerivativeJobTriggeredBy", fields: [triggeredByUserId], references: [id])
  derivativeArtifacts   DerivativeArtifact[]

  @@index([derivativeType, status])
  @@index([backfillBatchId])
  @@index([sourceDocumentId, derivativeType])
  @@map("derivative_generation_jobs")
}
```

Key design points:

- **Every derivative type is a row in `derivative_artifacts` plus zero or more rows in a type-specific child table.** A case digest has no child table — its full payload lives in `contentJson` (structured IRAC fields). An MCQ has one `mcq_questions` row and four `mcq_options` rows. An essay prompt has one `essay_prompts` row with an optional `bar_exam_sittings` foreign key if it was sourced from a past bar exam.
- **`contentJson` carries the type-specific structured payload.** For a case digest it is `{ factsHtml, issuesHtml, rulingHtml, doctrineHtml, dispositiveHtml, citedAuthorities: [] }`. For a subject outline it is `{ sections: [{ heading, paragraphs: [] }] }`. For a flashcard it is `{ front, back, mnemonicHint? }`. The canonical shape per type is defined in the TypeScript types package (`packages/legal-schema`) and validated by Zod at the API boundary — see §5 for the list.
- **Provenance is enforced via `ProvenanceRecord`.** The existing `ProvenanceRecord` table already has `entityType` and `entityId` columns that accept any derivative type. The migration adds `"derivative_artifact"` as a valid `entityType` value and wires every generated derivative to one or more `ProvenanceRecord` rows pointing at the source sections used to produce it. No derivative is ever written without at least one `ProvenanceRecord`. This is enforced at the service layer (transactional write) and covered by tests in §10.
- **`content_rights` is an enum-like string column on every derivative.** Values: `public_domain_government` (raw statutes, decisions — no derivative AI), `ai_generated_derivative` (anything an LLM produced), `mixed` (a derivative that quotes public-domain text verbatim under a layer of AI annotation). Frontend rendering checks this column and shows the appropriate disclaimer from `content_disclaimers`.
- **`contentDisclaimerId` is a non-nullable foreign key.** You cannot write a `DerivativeArtifact` row without associating a disclaimer. This is the database-level enforcement of the "disclaimer is not a frontend afterthought" requirement (see §8).
- **`@@unique([sourceDocumentId, derivativeType, taxonomyVersion])`** prevents duplicate generation of the same artifact for the same source in the same taxonomy version. Regeneration means deleting the old row first (cascaded to child tables) and writing a new one, with the old artifact preserved via audit log if needed. See the regeneration flow in §4.

### 2.3 Subject taxonomy tables

```prisma
model Subject {
  id              String   @id @default(uuid()) @db.Uuid
  code            String   @db.VarChar(40)   // stable machine id
  //   modern_6.political_pil, modern_6.commercial_taxation, modern_6.civil_land_titles,
  //   modern_6.labor_social, modern_6.criminal, modern_6.remedial_ethics_practical
  //   legacy_8.civil_law, legacy_8.criminal_law, legacy_8.remedial_law, legacy_8.political_law,
  //   legacy_8.labor_law, legacy_8.mercantile_law, legacy_8.taxation, legacy_8.legal_ethics
  name            String   @db.VarChar(200)
  taxonomyVersion String   @db.VarChar(20)  // modern_6 | legacy_8
  weightPercent   Float?                    // e.g., 15.0 for 2026 Political/PIL
  effectiveFrom   Int?                      // year this subject became effective
  effectiveTo     Int?                      // year it stopped being effective (null = current)
  displayOrder    Int      @default(0)
  description     String?  @db.Text
  createdAt       DateTime @default(now()) @db.Timestamptz

  topics                     SubjectTopic[]
  documentAssignments        DocumentSubjectAssignment[]
  equivalencesAsModern       SubjectEquivalence[] @relation("EquivalenceModern")
  equivalencesAsLegacy       SubjectEquivalence[] @relation("EquivalenceLegacy")

  @@unique([code, taxonomyVersion])
  @@index([taxonomyVersion])
  @@map("subjects")
}

model SubjectTopic {
  id          String   @id @default(uuid()) @db.Uuid
  subjectId   String   @db.Uuid
  parentId    String?  @db.Uuid             // nullable = top-level topic
  code        String   @db.VarChar(80)      // e.g., civil.obligations_contracts.consent
  name        String   @db.VarChar(255)
  description String?  @db.Text
  displayOrder Int     @default(0)

  subject           Subject                    @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  parent            SubjectTopic?              @relation("TopicHierarchy", fields: [parentId], references: [id])
  children          SubjectTopic[]             @relation("TopicHierarchy")
  documentAssignments DocumentSubjectAssignment[]
  mcqQuestions      McqQuestion[]
  essayPrompts      EssayPrompt[]

  @@unique([subjectId, code])
  @@index([subjectId, parentId, displayOrder])
  @@map("subject_topics")
}

model SubjectEquivalence {
  id                String @id @default(uuid()) @db.Uuid
  modernSubjectId   String @db.Uuid
  legacySubjectId   String @db.Uuid
  relationship      String @db.VarChar(20) // "equivalent" | "partial" | "subset" | "superset"
  notes             String? @db.Text

  modernSubject     Subject @relation("EquivalenceModern", fields: [modernSubjectId], references: [id])
  legacySubject     Subject @relation("EquivalenceLegacy", fields: [legacySubjectId], references: [id])

  @@unique([modernSubjectId, legacySubjectId])
  @@map("subject_equivalences")
}

model DocumentSubjectAssignment {
  id                    String   @id @default(uuid()) @db.Uuid
  legalDocumentId       String?  @db.Uuid
  derivativeArtifactId  String?  @db.Uuid
  subjectId             String   @db.Uuid
  subjectTopicId        String?  @db.Uuid
  isPrimary             Boolean  @default(false)
  confidence            Float?
  classifiedBy          String   @default("ai") @db.VarChar(20)
  //   manual | ai | rule_based | import
  classifierModelRunId  String?  @db.Uuid
  manualOverride        Boolean  @default(false)
  reviewStatus          String   @default("auto") @db.VarChar(20)
  createdAt             DateTime @default(now()) @db.Timestamptz
  updatedAt             DateTime @updatedAt @db.Timestamptz

  legalDocument         LegalDocument?      @relation(fields: [legalDocumentId], references: [id], onDelete: Cascade)
  derivativeArtifact    DerivativeArtifact? @relation(fields: [derivativeArtifactId], references: [id], onDelete: Cascade)
  subject               Subject             @relation(fields: [subjectId], references: [id])
  subjectTopic          SubjectTopic?       @relation(fields: [subjectTopicId], references: [id])
  classifierModelRun    ModelRun?           @relation(fields: [classifierModelRunId], references: [id])

  @@unique([legalDocumentId, subjectId, subjectTopicId])
  @@unique([derivativeArtifactId, subjectId, subjectTopicId])
  @@index([subjectId, isPrimary])
  @@index([subjectTopicId])
  @@map("document_subject_assignments")
}
```

Key design points:

- A single `Subject` row represents a subject **in one taxonomy version**. "Civil Law" exists twice — once with `taxonomy_version = "legacy_8"` and once with `taxonomy_version = "modern_6"` — and the two are joined by a `SubjectEquivalence` row with `relationship = "equivalent"`. For the "Remedial Law, Legal and Judicial Ethics with Practical Exercises" modern subject, the equivalence maps to *three* legacy subjects with `relationship = "superset"`. The compatibility layer lives in the subject service, not in the database.
- A document or derivative can have **multiple subject assignments** in both taxonomy versions. A 2015 SC decision on corporate law gets assigned to `legacy_8.mercantile_law` (primary) *and* to `modern_6.commercial_taxation` (primary) at classification time. A student filtering by "Commercial Law" surfaces either. A bar question from 2012 is assigned only to its legacy subject (that's what it was written under), but the compatibility layer maps the equivalent modern subject on read if the user asks for it.
- `classifiedBy` and `manualOverride` together give the admin the ability to say "this AI classification is wrong, lock it to X, don't let the re-classifier touch it." When `manualOverride = true`, the classifier task skips the row.

### 2.4 Additive columns on existing tables

```prisma
// apps/api/prisma/schema.prisma — small additions, not new tables

model IngestionJob {
  // ... existing fields ...
  backfillBatchId String?        @db.Uuid
  backfillBatch   BackfillBatch? @relation(fields: [backfillBatchId], references: [id])
  @@index([backfillBatchId, status])  // new index
}

model LegalDocument {
  // ... existing fields ...
  backfillBatchId       String? @db.Uuid
  ingestionSource       String  @default("watch_loop") @db.VarChar(20)
  //   watch_loop | backfill | user_upload | manual_import
  // Note: backfillBatchId is denormalised from ingestion_jobs for fast admin filtering;
  // it is populated at insert time by the ingestion worker when the parent IngestionJob
  // has a non-null backfill_batch_id.
}

model ModelRun {
  // ... existing fields ...
  derivativeGenerationJobId String? @db.Uuid
  costUsd                   Decimal? @db.Decimal(10, 6) // denormalised for budget queries
}

model AiSettings {
  // no schema change; new keys only:
  //   "llm_daily_budget_usd"               { amount: 20.0 }
  //   "backfill_concurrency"               { maxConcurrentBatches: 2, maxJobsPerBatch: 5 }
  //   "derivative_generation.enabled"      { enabled: true }
  //   "derivative_generation.types_enabled" { case_digest: true, mcq: false, ... }
}
```

### 2.5 Content rights and disclaimers

```prisma
model ContentDisclaimer {
  id               String   @id @default(uuid()) @db.Uuid
  code             String   @unique @db.VarChar(60)
  //   public_domain_government.v1, ai_digest.v1, ai_mcq.v1, ai_essay_model_answer.v1,
  //   sample_pleading.v1, sample_contract.v1
  title            String   @db.VarChar(255)
  bodyHtml         String   @db.Text
  bodyPlainText    String   @db.Text
  shortText        String   @db.VarChar(500)  // one-line version for cards/headers
  appliesTo        String   @db.VarChar(40)   // which content class
  version          Int      @default(1)
  effectiveFrom    DateTime @default(now()) @db.Timestamptz
  effectiveTo      DateTime? @db.Timestamptz
  lastReviewedAt   DateTime? @db.Timestamptz
  lastReviewedBy   String?  @db.Uuid

  derivativeArtifacts DerivativeArtifact[]

  @@map("content_disclaimers")
}
```

The disclaimer table is a small controlled vocabulary, seeded once and updated only by explicit admin action with audit log entries. Every `DerivativeArtifact` row has a non-nullable foreign key into it. The API layer always joins this table and returns the disclaimer alongside the artifact, so the frontend cannot "forget" to render it.

### 2.6 Budget ledger (optional but recommended)

```prisma
model BudgetLedger {
  id                       String   @id @default(uuid()) @db.Uuid
  periodYearMonth          String   @db.VarChar(7)    // "2026-04"
  periodDay                String?  @db.VarChar(10)   // "2026-04-10" for daily rollups
  scope                    String   @db.VarChar(40)
  //   global | backfill_batch:<uuid> | derivative_type:<type>
  amountUsd                Decimal  @db.Decimal(10, 6)
  tokensIn                 Int      @default(0)
  tokensOut                Int      @default(0)
  requestCount             Int      @default(0)
  modelRunId               String?  @db.Uuid
  createdAt                DateTime @default(now()) @db.Timestamptz

  modelRun                 ModelRun? @relation(fields: [modelRunId], references: [id])

  @@index([periodYearMonth, scope])
  @@index([periodDay, scope])
  @@index([scope, createdAt])
  @@map("budget_ledger")
}
```

`BudgetLedger` is an append-only record of every LLM spend event. The existing Redis hash `llm:usage:{YYYY-MM}` continues to be the hot path for budget enforcement; `BudgetLedger` is the durable history that survives Redis flushes and supports admin reporting (spend by backfill batch, spend by derivative type, spend per day). Redis remains authoritative for the killswitch check; Postgres is authoritative for reporting. A periodic Celery task reconciles the two nightly.

### 2.7 Open questions

- Should `Digest` be deprecated and removed after a migration window, or should it remain indefinitely as a specialised view of `DerivativeArtifact` for backward compatibility? My default recommendation is to keep `Digest` until all frontend code has moved to `DerivativeArtifact` and then drop it in a later PR, but this requires a user preference call.
- `DerivativeArtifact.contentJson` as a single Json blob is flexible but not strongly typed at the database level. An alternative is a separate table per derivative type with typed columns (`case_digest_details`, `subject_outline_details`, etc.). The Json-blob approach is simpler to evolve, easier to add new types against, and fits the "each type has its own Pydantic/Zod schema" model — I recommend the Json blob approach, but this is reversible if prod Claude pushes back on indexability concerns.
- Should `BackfillBatch` support batch dependencies (batch B cannot start until batch A completes)? The current design doesn't model this. It is probably not needed for MVP — the admin can manually sequence them — but if prod Claude sees a derivative-regeneration use case where it matters, we can add a `BackfillBatchDependency` join table later without breaking the existing schema.

---

## 3. Backfill engine design

The backfill engine is the new component that walks historical archives. It is deliberately designed as a **controller loop on top of the existing ingestion pipeline**, not a parallel pipeline.

### 3.1 Lifecycle of a backfill batch

A backfill batch moves through this state machine:

```
pending ──► enumerating ──► running ──► completed
              │               │  │
              │               │  ├──► paused (auto) ──► running
              │               │  ├──► halted_budget ──► running (after admin extends budget)
              │               │  └──► halted_admin ──► running (on admin resume)
              └──────────────►failed
```

1. **`pending`** — admin has created the batch via the admin panel but the enumeration worker hasn't picked it up yet. No side effects yet.
2. **`enumerating`** — a Celery task `enumerate_backfill_candidates` is walking the source's index pages (e.g., LawPhil year → month → decision index) and building the full candidate list without fetching actual document content. This is cheap: year and month index pages on LawPhil are small HTML files. The enumeration task writes the candidate count to `backfill_batches.candidates_discovered` and initialises the cursor in `checkpoint_state`.
3. **`running`** — the main Celery task `run_backfill_batch_tick` runs on a recurring schedule (every 30 seconds, via Celery Beat). Each tick: load the batch, check budget and global killswitch, read the cursor, create N child `IngestionJob` rows for the next N candidates (N controlled by `ai_settings.backfill_concurrency.maxJobsPerBatch`, default 5), advance the cursor, persist it back. The child jobs are processed by the existing `run_ingestion_job` → `process_ingestion_candidate` Celery chain with no modifications other than writing `ingestion_jobs.backfill_batch_id`.
4. **`paused`** — automatic pause, set by the tick task when it detects something transient: the fetcher returned a Cloudflare block for this source in the last N minutes, the source's error rate exceeded a threshold, or Redis is unavailable. A paused batch wakes itself up on the next tick after a cooldown.
5. **`halted_budget`** — terminal until admin intervention. Set when `budgetCeilingUsd - budgetConsumedUsd` drops below the estimated cost of the next derivative generation fanout, or when the global monthly budget is hit. Halt is **mid-document safe**: the tick task finishes the document currently being processed before setting the halted state. The admin gets a notification with the reason and can "Extend budget" or "Halt permanently."
6. **`halted_admin`** — set when the admin clicks Halt. Same mid-document safety. Resumable.
7. **`completed`** — cursor has reached the end of the configured year range. No further ticks scheduled.
8. **`failed`** — terminal. Set only when an unrecoverable error occurs (cursor corruption, source permanently unreachable after N retries). The admin gets a notification; a new batch must be created to retry.

### 3.2 Checkpoint and resume semantics

`backfill_batches.checkpoint_state` is a JSON blob. Its shape is fetcher-specific:

- **LawPhil jurisprudence:** `{ year: 2012, month: 3, decisionFileIndex: 47, decisionUrls: [...] }` — the enumeration pass populated `decisionUrls` once per month; the tick task walks the array and persists the index after each job is created.
- **LawPhil bar questions:** `{ year: 2017, subjectSlug: "civil-II", questionIndex: 0 }` — bar questions are a single HTML file per subject per year, so checkpointing is by year+subject.
- **SC e-library (when reachable):** `{ year: 2021, category: "decisions", paginationToken: "..." }` — the SC e-library uses server-side pagination tokens.
- **Official Gazette:** `{ volume: 117, issue: 22 }` — OG uses volume/issue numbering.

The `BackfillCheckpoint` table is a **write-ahead log**: before updating `backfill_batches.checkpoint_state`, the tick task inserts a new `backfill_checkpoints` row with the new cursor and the `candidatesSeen` count. This lets post-mortem tools reconstruct the cursor history if the live `checkpoint_state` is corrupted by a partial write, and lets the admin see a batch's progress over time. The log is not used for normal operation — it is a safety net.

Resume is trivial: on a worker restart or admin resume, the tick task reads `checkpoint_state` and picks up exactly where the last successful cursor update left off. Idempotency is enforced by the dedup classifier — if the tick task re-creates an `IngestionCandidate` for a document that was already ingested, the dedup classifier marks it `EXACT_DUPLICATE` and the child job becomes a no-op.

### 3.3 Mid-document halt safety

When the admin clicks Halt or the budget ceiling fires, the tick task must not rip the rug out from under a document that's mid-fetch. The design:

- The tick task **only creates new child `IngestionJob` rows**; it does not process documents itself. Processing happens in `process_ingestion_candidate`, which is a separate Celery task chain.
- On halt, the tick task sets `backfill_batches.status` to `halted_*` and stops creating new child jobs. Any child jobs that are already `pending` or `running` are allowed to complete naturally.
- After the admin clicks Halt, the admin panel shows a spinner "Halting — waiting for 4 in-flight jobs to complete" until all existing child jobs reach `completed` or `failed`. Only then is the halt transition considered fully complete.
- If the admin wants a **hard stop**, there is an explicit "Kill in-flight jobs" button that revokes the Celery tasks by ID. This is a separate action from Halt and carries a warning dialog, because it can leave documents half-processed. Default behaviour is the graceful halt.

### 3.4 Rate limiting and politeness

Each backfill batch respects the source's per-request rate limit configured in `BaseFetcher._rate_limit()` (2 seconds by default, overridable per source in `ai_settings`). Beyond that, the backfill engine adds **a second layer of rate limiting at the batch level**:

- `ai_settings.backfill_concurrency.maxConcurrentBatches` — hard cap on the total number of batches in state `running` simultaneously. Default: 2.
- `ai_settings.backfill_concurrency.maxJobsPerBatch` — hard cap on the number of in-flight `IngestionJob` rows per batch. Default: 5.
- Per-source override — `ai_settings.source_rate_limits.lawphil = { requestsPerMinute: 20 }`. If set, the tick task throttles job creation to respect it.
- If the fetcher reports a 429 or a Cloudflare block, the batch transitions to `paused` for 15 minutes before resuming.

This two-layer design keeps the existing per-request rate limit (which is about being polite per-fetch) separate from the batch-level throttle (which is about bounding concurrency and total throughput for a given source). The admin can tune each independently.

### 3.5 How a backfill batch is visible to the admin

The `/admin/backfill` page shows:

- A list of all batches (pending, running, paused, halted, completed, failed) with per-batch progress bars showing `candidatesProcessed / candidatesDiscovered` and `budgetConsumedUsd / budgetCeilingUsd`.
- Per-batch drill-down: cursor position, last tick time, in-flight child jobs, recent errors, per-tick throughput, spend history.
- Per-batch controls: Start, Pause, Resume, Halt, Extend Budget (dialog), Kill In-Flight (danger dialog), Delete (only for completed/failed batches).
- A "New Backfill" button that opens a form: source, year range, optional month range, budget ceiling, optional admin notes.

API endpoints supporting this are specified in §7.

### 3.6 Relationship to the daily watch loop

The daily watch loop — the existing scheduler driven by `ingestion_schedule` in `ai_settings` — stays exactly as it is today. It creates `IngestionJob` rows with `backfill_batch_id = NULL`. The backfill engine creates `IngestionJob` rows with `backfill_batch_id = <uuid>`. They share the same `run_ingestion_job` → `process_ingestion_candidate` worker chain.

The dedup classifier is the key integration point: if the watch loop ingests a document in the morning and a backfill batch stumbles on the same document in the afternoon, the classifier returns `EXACT_DUPLICATE` and the backfill job is a no-op. No coordination needed.

The only small coordination concern is **global rate limit contention**: if the watch loop is actively fetching from LawPhil at the same time the backfill batch is, together they might exceed the polite request rate. The mitigation is a Redis-based token bucket keyed by source domain (`rate_limit:lawphil.net`), checked by `BaseFetcher._rate_limit()` before every request. This is a one-hour implementation task in the first backfill PR.

### 3.7 Open questions

- **How polite is polite enough for LawPhil?** The fetcher currently sleeps 2 seconds per request. For a full backfill of LawPhil jurisprudence 1901–2025 at ~100 decisions per month × 12 × 125 years ≈ 150,000 decisions, 2 seconds per request means ~83 hours of wall-clock fetch time. That's fine as long as LawPhil tolerates it. Should we reach out to Arellano Law Foundation proactively? I recommend yes — a polite "we are doing a one-time historical backfill" email goes a long way toward not getting IP-blocked — but this is an external-relationship call.
- **Does the enumeration pass count toward budget?** Enumeration fetches index pages; it does not call any LLM. Under the current design, enumeration is free (counted only toward rate limits). If we later add LLM-based enumeration (e.g., "ask the model to extract candidate URLs from this index page"), that cost needs to count — but for now, enumeration is pure HTTP.
- **Should there be a shared "global backfill kill switch"?** A single Redis key that, if set, prevents any backfill tick from creating new jobs regardless of per-batch state. This is a cheap safety net for a panic-button scenario. I recommend adding it but it is not blocking.

---

## 4. Derivative generation pipeline

The derivative pipeline takes a `LegalDocument` that is eligible for derivative generation and fans out one or more `DerivativeGenerationJob` rows, each of which produces one or more `DerivativeArtifact` rows. The fanout, validation, and cost accounting are the core of this section.

### 4.1 Eligibility and triggering

A `LegalDocument` is eligible for derivative generation when **all** of the following are true:

1. `status = 'published'` (the ingestion pipeline's truthfulness validator has said "ok to read").
2. `truthfulness_status = 'publish'`.
3. The source's `trust_level` is `high` or `medium`.
4. `document_type` is in the allow-list for the derivative type (e.g., case digests only for `supreme_court_decision`; sample pleadings only for appropriate doctrinal categories).
5. The document has at least one `LegalDocumentSection` row with non-empty `plain_text`.

Eligibility is evaluated by a new service method `DerivativeEligibility.isEligible(doc, derivativeType)`. The method is pure and testable without hitting a network.

Derivative generation is triggered in three ways:

- **Backfill follow-up:** when `process_ingestion_candidate` successfully creates or updates a `LegalDocument`, it emits a domain event `legal_document.ingested`. A listener task `consider_derivative_generation` evaluates eligibility for each enabled derivative type and enqueues `DerivativeGenerationJob` rows for the ones that pass. This is the path new documents take.
- **Scheduled sweep:** a nightly Celery task walks documents that are eligible but have no `DerivativeArtifact` of the expected types. This catches documents that existed before the derivative pipeline was enabled, and documents where an earlier generation attempt failed and was not retried.
- **Manual admin trigger:** the `/admin/derivatives` page has a "Generate" button per derivative type that takes a date range and a source filter and enqueues `DerivativeGenerationJob` rows for everything matching. This is the primary backfill-the-backfill path.

### 4.2 Fanout orchestration

Each `DerivativeGenerationJob` is processed by a Celery task chain:

```
DerivativeGenerationJob (pending)
    │
    ▼
run_derivative_generation (Celery task)
    │
    ├── 1. Budget check (cheap Redis read; raises skipped_budget if over)
    ├── 2. Load source document and relevant sections from Postgres
    ├── 3. Context packer: build the prompt context (within token budget)
    ├── 4. Call LLM via RAG service `generate_completion` (or `stream_completion`)
    ├── 5. Parse output into type-specific Pydantic/Zod schema
    ├── 6. Record model run (model_runs + budget_ledger + Redis usage hash)
    ├── 7. Run validator (type-specific — see §4.4)
    ├── 8. If validator verdict = publish, write derivative_artifacts + child tables
    │       + provenance_records + subject assignments
    │    If verdict = human_review, write with review_status = 'needs_human_review'
    │    If verdict = quarantine, do not write; mark job failed; emit audit log
    └── 9. Update job status → completed / failed / validating
```

The chain is not a Celery `chord` or `group` — it is a single `run_derivative_generation` task that walks through all nine steps in sequence. This simplifies failure handling: if step 4 raises, we retry the whole task with exponential backoff; if step 7 (validator) rejects, we don't write anything and mark the job as `failed` with a reason.

For derivative types that produce **multiple artifacts from one document** (e.g., generating 5 MCQs from one decision), the LLM call returns a list, and step 8 writes one `DerivativeArtifact` row per item, each with its own `provenance_records` and its own validator pass. This is still a single Celery task; the fanout is inside the task, not across tasks. Advantage: simpler accounting (one job = one LLM call = one cost entry). Disadvantage: a partial failure (e.g., 3 of 5 MCQs validate and 2 don't) means the job writes what passed and marks the rest as rejected in the job's `errorJson` field.

Regeneration is a separate top-level admin action. When the admin clicks "Regenerate all case digests from 2012" on the `/admin/derivatives` page, the service:

1. Soft-deletes existing `DerivativeArtifact` rows of that type for the matching source documents (sets a `deleted_at` column we add in an additive migration, or moves to a `derivative_artifacts_archive` table — see open questions).
2. Enqueues new `DerivativeGenerationJob` rows for each source document.
3. Emits an audit log entry per regeneration.

The UI warns loudly about cost before accepting regeneration. Regeneration counts toward the monthly budget ceiling.

### 4.3 Cost accounting per derivative

Every `DerivativeGenerationJob` records its token and cost consumption in three places:

1. **`model_runs`** (existing table, per-LLM-call) — adds a new `derivative_generation_job_id` FK and a `cost_usd` column.
2. **`derivative_generation_jobs`** (new table) — `tokens_in`, `tokens_out`, `estimated_cost_usd` aggregated across the one call the job makes.
3. **`budget_ledger`** (new table) — one row per LLM call, tagged with scope `derivative_type:<type>` and `backfill_batch:<uuid>` if the parent ingestion came from a backfill batch. This lets the admin slice spend by derivative type, by backfill batch, or globally.

The Redis hash `llm:usage:{YYYY-MM}` continues to be the hot-path killswitch check. It is updated by the RAG service's `_track_usage` function on every LLM call, exactly as it does today. The Postgres `budget_ledger` is the durable history; it is written inside the same database transaction as the `DerivativeArtifact` row that the call produced, which means if the transaction rolls back, the spend is also rolled back from Postgres. (Redis is not transactional with Postgres, so Redis may briefly over-count by one call on rollback — the nightly reconcile task corrects this.)

### 4.4 Per-type validators

Each derivative type has its own validator class implementing a common interface:

```python
# services/worker-service/src/validators/derivative_validators/__init__.py
class DerivativeValidator(Protocol):
    def validate(
        self,
        *,
        derivative_type: str,
        content: dict,                 # the structured contentJson
        source_document: LegalDocumentSnapshot,
        source_sections: list[LegalDocumentSectionSnapshot],
    ) -> ValidationResult:
        ...
```

Concrete validator classes:

- **`CaseDigestValidator`** — checks: (a) all five IRAC fields are non-empty; (b) each factual claim in `factsHtml` has a supporting section citation in `provenanceRecords`; (c) cited authorities exist in the corpus (`citation_text` resolves to a real `LegalDocument.id` or is marked "unresolved"); (d) the digest length is within a type-specific range (facts 100–800 words, issues 30–200 words, etc.).
- **`DoctrineExtractValidator`** — checks: (a) the doctrine text exists verbatim or near-verbatim in at least one source section (normalised whitespace); (b) the doctrine type is in an allow-list; (c) the doctrine does not paraphrase the court into saying something the source does not say.
- **`McqQuestionValidator`** — checks: (a) exactly one correct option is marked; (b) distractors are distinct from the correct answer by more than trivial text substitution; (c) the explanation cites at least one source section; (d) the question stem does not leak the answer; (e) the question is well-formed (single question mark, no stray HTML).
- **`EssayPromptValidator`** — checks: (a) the prompt text is non-empty and well-formed; (b) if a `modelAnswerJson` is provided, each paragraph cites at least one source section; (c) the rubric, if provided, has a scoring scale and criteria list; (d) if the prompt is sourced from a past bar exam, the citation to the `BarExamSitting` row matches the expected year/subject.
- **`FlashcardValidator`** — checks: (a) front is a well-formed question or term; (b) back is non-empty and cites at least one source section; (c) front and back do not contain answer leakage (e.g., a definition that restates the term verbatim).
- **`SubjectOutlineValidator`** — checks: (a) at least three sections; (b) each section has at least one paragraph; (c) subject topic anchors in the outline match real `SubjectTopic` rows.
- **`SamplePleadingValidator` / `SampleContractValidator`** — checks: (a) the template contains all required structural components for its pleading type (caption, parties, body, prayer, verification, signature block); (b) the template does not contain any real case details accidentally copied from a source document; (c) the "not legal advice" disclaimer appears at the top of the content; (d) the template passes a format linter.

The validators are **registered in a dispatch map** keyed by `derivative_type`. `validate_derivative(job)` looks up the validator, calls it, and returns the `ValidationResult`. Each validator is a small, pure-ish class (reads from Postgres for section lookups but does no network calls to the LLM or OpenSearch). Unit tests per validator are in `services/worker-service/tests/unit/test_<validator>.py`.

The existing `truthfulness_validator.validate_document(...)` **remains unchanged** for document-level validation during ingestion. It is not generalised — we keep it as the document-level validator and introduce the new derivative validators as a separate family. This limits blast radius of the generalisation.

### 4.5 Provenance enforcement

Every derivative must have at least one `ProvenanceRecord` row before the `DerivativeArtifact` insert transaction commits. The service method that writes a derivative looks like:

```python
# pseudocode for services/worker-service/src/services/derivative_writer.py

@transactional
def write_derivative(job, content, source_sections_used):
    if not source_sections_used:
        raise InvariantViolation("derivative requires at least one source section")
    artifact = insert_derivative_artifact(...)
    for section in source_sections_used:
        insert_provenance_record(
            entity_type="derivative_artifact",
            entity_id=artifact.id,
            source_document_id=section.legal_document_id,
            source_section_id=section.id,
            provenance_type="source_passage",
        )
    for citation in content.get("cited_authorities", []):
        resolved = resolve_citation(citation)
        if resolved:
            insert_provenance_record(
                entity_type="derivative_artifact",
                entity_id=artifact.id,
                source_document_id=resolved.id,
                provenance_type="cited_authority",
            )
    return artifact
```

The `@transactional` decorator ensures that if any part fails, the whole write is rolled back. This is the enforcement mechanism for "no derivative without provenance."

### 4.6 Subject classification at materialization

After a derivative is written and validated, an async task `classify_document_subjects` assigns `DocumentSubjectAssignment` rows:

1. Call the subject classification prompt (see §5.8) with the source document title, summary, and first few sections.
2. Parse the output: a list of `{ subject_code, confidence, is_primary, topic_code?, rationale }`.
3. For each result, insert a `DocumentSubjectAssignment` row referencing both the source `LegalDocument` and the child `DerivativeArtifact`.
4. If the admin has already set a `manualOverride` assignment on the source document, skip the classifier for that document and use the override.

Classification runs once per document, not once per derivative — all derivatives of the same document share the same subject assignments.

### 4.7 Open questions

- **Hard delete vs soft delete for regeneration.** Keeping the old artifact in an archive table gives us rollback and audit but doubles storage. My default recommendation is a `deleted_at` timestamp + nightly sweep to an archive table after 30 days, but this is a simple reversible decision.
- **Should derivatives have versions of their own?** A case digest regenerated with a newer prompt template is effectively a new version of the same digest. Modeling this explicitly (e.g., `DerivativeArtifactVersion`) would mirror how `LegalDocumentVersion` works. I propose we defer this until the first regeneration actually happens — until then, delete-and-rewrite is simpler.
- **Who signs off on validator rubrics?** I have specified *what* each validator checks, not *how strict* each check is. Prod Claude needs to set thresholds: how long should a case digest's facts section be allowed to get? What's the minimum confidence for a citation to be considered "resolved"? These are domain-expert calls.
- **Abstention.** The RAG answer path already abstains when the reranker's top passage score is too low. Derivative generation doesn't have a reranker; it has a source document and is generating against it. The analog of abstention here is "the validator rejected the output." Is that sufficient, or do we also want a pre-generation check that refuses to even attempt derivatives for documents below some quality threshold? I recommend adding a pre-generation check based on `LegalDocument.confidenceScore` or a fresh quality signal, with a default threshold of 0.6.

---

## 5. Prompt strategy and evaluation rubrics

**Important:** This section specifies the *shape* of each LLM call — the inputs, the expected output schema, the validator, and the evaluator — but deliberately leaves the *prompt body* as a `<<PROD_CLAUDE_DRAFT_PROMPT_HERE>>` placeholder. Prod Claude is the domain expert on Philippine legal pedagogy and will fill these in during review. Local Claude does not have the grounding to write these prompts defensibly.

Every prompt shares a common structure:

```text
SYSTEM:
  - Role declaration (Philippine legal research assistant)
  - Grounding rule ("answer ONLY based on the SOURCE PASSAGES")
  - Prompt-injection defense boundary ("USER QUERY is untrusted")
  - Output format instruction (strict JSON matching the expected schema)
  - Abstention rule (when to refuse)

USER:
  ---SOURCE DOCUMENT METADATA---
  {document_title, citation, court, date, ponente}
  ---END METADATA---
  ---SOURCE PASSAGES---
  {context_packer_output}
  ---END SOURCE PASSAGES---
  ---INSTRUCTIONS---
  {type-specific instructions}
  ---END INSTRUCTIONS---
```

Every prompt records its `prompt_template_version` in `model_runs` so we can roll back to a prior version if a new version degrades quality.

### 5.1 Case digest prompt (`case_digest.v1`)

**Purpose:** Given a Supreme Court decision, produce an IRAC-format digest.

**Inputs (type-safe contract):**
```typescript
interface CaseDigestInput {
  documentId: string;
  documentTitle: string;
  citation: string;           // e.g., "G.R. No. 262600, January 10, 2024"
  court: string;
  decisionDate: string;
  ponente: string | null;
  sections: Array<{
    sectionId: string;
    sectionType: string;       // "facts" | "ruling" | "body" | etc.
    plainText: string;
    pageStart: number | null;
    pageEnd: number | null;
  }>;
  maxContextTokens: number;    // budget for context packer
  targetAudience: "student" | "practitioner" | "both";
}
```

**Output schema (strict JSON):**
```typescript
interface CaseDigestOutput {
  facts: string;               // markdown, 100–800 words
  issues: string[];            // each phrased as a yes/no or "whether..." question
  ruling: string;              // markdown, 100–1000 words
  doctrine: string;            // markdown, 50–300 words — the holding in principle form
  dispositive: string;         // the court's disposition, usually one paragraph
  citedAuthorities: Array<{
    citationText: string;
    sectionIds: string[];      // which input sections this cite came from
    citationType: "case" | "statute" | "rule" | "constitutional";
  }>;
  sectionUsage: Array<{
    sectionId: string;
    fields: Array<"facts" | "issues" | "ruling" | "doctrine" | "dispositive">;
  }>;                          // provenance mapping for validator
  confidenceSelfReport: number; // 0.0–1.0
  abstain: boolean;
  abstainReason: string | null;
}
```

**Validator:** `CaseDigestValidator` (see §4.4).

**Evaluator (offline quality check):** Golden set of 20 hand-written digests. Score produced digests against the golden set using (a) BLEU-like n-gram overlap on facts/ruling, (b) exact-match on dispositive, (c) manual review sampling of 5% of runs. Target: 80% of produced digests score > 0.7 on the composite metric in the first stable prompt version.

**Prompt body:**
```
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — case digest>>
```

### 5.2 Doctrine extract prompt (`doctrine_extract.v1`)

**Purpose:** From a case decision, extract one or more doctrines (legal principles) with the exact source text.

**Inputs:** Same as case digest input, plus the optional `existingDoctrines: Doctrine[]` list so the model can link to or refine existing doctrines.

**Output schema:**
```typescript
interface DoctrineExtractOutput {
  doctrines: Array<{
    text: string;                    // the principle phrased as a normative statement
    verbatimSourceText: string;      // the exact text from the decision
    sectionId: string;               // which section it came from
    doctrineType: "rule" | "test" | "definition" | "exception" | "procedural";
    relatedDoctrines: Array<{
      existingDoctrineId: string | null;
      linkType: "supports" | "refines" | "contradicts";
    }>;
  }>;
  abstain: boolean;
  abstainReason: string | null;
}
```

**Validator:** `DoctrineExtractValidator` (see §4.4).

**Prompt body:**
```
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — doctrine extract>>
```

### 5.3 MCQ generation prompt (`mcq_generation.v1`)

**Purpose:** From a source document (decision, statute section, or codal chapter), generate N multiple-choice questions suitable for bar review.

**Inputs:**
```typescript
interface McqGenerationInput {
  sourceDocumentId: string;
  sourceSections: Array<{
    sectionId: string;
    plainText: string;
  }>;
  targetSubject: SubjectCode;
  targetSubjectTopic: SubjectTopicCode | null;
  difficulty: "easy" | "medium" | "hard" | "bar_exam_level";
  questionCount: number;            // default 5
  questionFormat: "single_best" | "multi_select";
}
```

**Output schema:**
```typescript
interface McqGenerationOutput {
  questions: Array<{
    questionStem: string;
    options: Array<{
      label: "A" | "B" | "C" | "D";
      text: string;
      isCorrect: boolean;
      rationale: string;              // why right/wrong
    }>;
    explanation: string;
    supportingSectionIds: string[];
    difficultySelfReport: "easy" | "medium" | "hard" | "bar_exam_level";
  }>;
  abstain: boolean;
  abstainReason: string | null;
}
```

**Validator:** `McqQuestionValidator` (see §4.4). Each question in the output is validated independently; failures are recorded per question, and only passing questions are persisted.

**Evaluator:** Golden set of 50 hand-written MCQs tagged with their source doctrine. Score produced MCQs on (a) whether the correct answer is unambiguously correct per the source, (b) distractor quality (each distractor should be "plausibly wrong" — a lawyer should have to think), (c) coverage of the intended sub-topic.

**Prompt body:**
```
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — MCQ generation>>
```

### 5.4 Essay prompt generation (`essay_prompt.v1`)

**Purpose:** Given a source doctrine or a source bar exam question, generate a practice essay prompt with a model answer and a scoring rubric.

**Inputs:**
```typescript
interface EssayPromptInput {
  sourceType: "doctrine" | "bar_exam_sitting" | "decision";
  sourceId: string;
  sourceText: string;
  targetSubject: SubjectCode;
  targetAudience: "student" | "practitioner" | "both";
  includeModelAnswer: boolean;
  includeRubric: boolean;
}
```

**Output schema:**
```typescript
interface EssayPromptOutput {
  promptText: string;                // the essay question
  suggestedTimeMinutes: number;
  modelAnswer: {
    outlineSections: Array<{
      heading: "Issue" | "Rule" | "Application" | "Conclusion" | string;
      paragraphs: string[];
      citedSectionIds: string[];
    }>;
  } | null;
  rubric: {
    totalPoints: number;
    criteria: Array<{
      name: string;                    // e.g., "Issue identification"
      maxPoints: number;
      description: string;
    }>;
  } | null;
  abstain: boolean;
}
```

**Validator:** `EssayPromptValidator`.

**Prompt body:**
```
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — essay prompt generation>>
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — essay model answer>>
```

Note: two placeholders — the prompt generation and the model answer generation may use different sub-prompts even if they run in the same Celery task.

### 5.5 Flashcard generation prompt (`flashcard.v1`)

**Purpose:** From a doctrine or a codal section, generate spaced-repetition flashcards (front = question or term, back = answer or definition).

**Inputs:**
```typescript
interface FlashcardInput {
  sourceType: "doctrine" | "codal_section" | "case_digest";
  sourceId: string;
  sourceText: string;
  cardCount: number;  // default 3
  cardStyle: "definition" | "application" | "rule_recall";
}
```

**Output schema:**
```typescript
interface FlashcardOutput {
  cards: Array<{
    front: string;
    back: string;
    mnemonicHint: string | null;
    supportingSectionIds: string[];
  }>;
}
```

**Validator:** `FlashcardValidator`.

**Prompt body:**
```
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — flashcard>>
```

### 5.6 Subject outline prompt (`subject_outline.v1`)

**Purpose:** From a set of documents covering a subject or sub-topic, synthesise a structured outline suitable for bar review.

**Inputs:** A subject/topic code, a curated list of source document IDs (up to a max), and a target depth level.

**Output schema:** Hierarchical outline with sections, sub-sections, bullet points, each citing source sections.

**Validator:** `SubjectOutlineValidator`.

**Prompt body:**
```
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — subject outline>>
```

### 5.7 Sample pleading and sample contract prompts

**Purpose:** Generate generic, educational samples of Philippine legal templates (pleadings and contracts).

**Inputs:** Template type (e.g., "motion for reconsideration," "deed of sale"), facts stub, optional jurisdiction specifics.

**Output schema:** Structured template with placeholder fields for user substitution.

**Validator:** `SamplePleadingValidator` / `SampleContractValidator`. Critical check: **the template must not contain real case details from any source document.** The validator runs a near-duplicate scan against the corpus to catch accidental lift-and-shift.

**Prompt body:**
```
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — sample pleading>>
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — sample contract>>
```

### 5.8 Subject classification prompt (`subject_classification.v1`)

**Purpose:** Assign a `LegalDocument` to one or more subjects and sub-topics in both taxonomy versions.

**Inputs:** Document title, first N sections, an optional existing digest summary.

**Output schema:**
```typescript
interface SubjectClassificationOutput {
  assignments: Array<{
    taxonomyVersion: "modern_6" | "legacy_8";
    subjectCode: string;
    subjectTopicCode: string | null;
    confidence: number;                // 0.0–1.0
    isPrimary: boolean;
    rationale: string;
  }>;
}
```

**Validator:** Simple structural validator — subject/topic codes must exist in the `subjects` and `subject_topics` tables.

**Prompt body:**
```
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — subject classification>>
```

### 5.9 Citation extraction prompt (`citation_extraction.v1`)

**Purpose:** Extract canonical citations (G.R. No., R.A. No., Const. Art., Rule No.) from a source text and map them to corpus documents.

**Output schema:**
```typescript
interface CitationExtractionOutput {
  citations: Array<{
    rawText: string;           // as it appears in the source
    normalizedText: string;    // canonical form
    citationType: "case" | "statute" | "constitutional" | "rule" | "administrative";
    resolvedDocumentId: string | null;    // if matched in corpus
    confidence: number;
  }>;
}
```

**Validator:** Citation normalisation library (existing — should be extended, not rewritten). Normalised citations that resolve to a corpus document are inserted into the existing `Citation` table.

**Prompt body:**
```
<<PROD_CLAUDE_DRAFT_PROMPT_HERE — citation extraction>>
```

### 5.10 Open questions

- Which model should each derivative type use? Case digests might be fine on `gpt-4o-mini` but MCQs for the bar might need `gpt-4o` for quality. Prod Claude should propose per-type model assignments; the cost model in §9 assumes `gpt-4o-mini` as default for the baseline estimate.
- Should prompts use structured output (OpenAI's `response_format: {"type": "json_schema", ...}`) or prompt-only JSON instructions? Structured output is more reliable but pins us to OpenAI; prompt-only works on any backend including the vLLM fallback. I recommend structured output on OpenAI and a JSON-repair post-step for vLLM.
- Evaluator golden sets don't exist yet. Prod Claude and the user will need to hand-curate them. The test strategy section (§10) assumes golden sets exist; creating them is a blocking prerequisite for any quality claim.

---

## 6. Subject taxonomy

### 6.1 Two taxonomies, explicitly versioned

The system maintains **two parallel taxonomies**:

- **`modern_6`** — the current SC six-subject bar structure (2025 and 2026 per Bar Bulletins, see [research notes §6](./research-notes-corpus-platform.md)).
- **`legacy_8`** — the traditional eight-subject structure used in past bar exams, old syllabi, and most existing Philippine legal taxonomy apps (eCodal+ uses a variant of this, per research notes §5).

Both taxonomies have their own `Subject` rows and their own `SubjectTopic` children. They are joined by `SubjectEquivalence` rows that declare how a modern subject relates to one or more legacy subjects. The compatibility layer in the subject service translates queries between them at read time: a filter on "Commercial Law" (legacy) can be translated to "Commercial and Taxation Laws" (modern) with a `relationship = 'partial'` flag so the UI can show "also matches Commercial and Taxation Laws documents."

Every `DocumentSubjectAssignment` carries a `subjectId` that already encodes the taxonomy version (because each `Subject` is per-taxonomy). A document classified at ingestion time is assigned under **both** taxonomies when the equivalence is one-to-one or one-to-many. Documents that predate the modern taxonomy (historical bar exam questions from 2006–2022) are classified under their legacy subjects primarily, with modern equivalents computed on read.

### 6.2 Modern 6 subjects (`taxonomy_version = "modern_6"`)

Based on [Bar Bulletin No. 1, Series of 2026 as summarised by PhilSTAR Life](https://philstarlife.com/news-and-views/386662-schedule-subject-coverage-2026-bar-exams) and [Respicio & Co.'s summary of the 2025 syllabus](https://www.respicio.ph/bar/2025/syllabus-for-the-2025-bar-examinations):

| Code | Name | 2026 Weight | Notes |
|---|---|---|---|
| `modern_6.political_pil` | Political and Public International Law | 15% | Day 1 AM |
| `modern_6.commercial_taxation` | Commercial and Taxation Laws | 20% | Day 1 PM |
| `modern_6.civil_land_titles` | Civil Law and Land Titles and Deeds | 20% | Day 2 AM (note the Land Titles inclusion is new for 2026) |
| `modern_6.labor_social` | Labor Law and Social Legislation | 10% | Day 2 PM |
| `modern_6.criminal` | Criminal Law | 10% | Day 3 AM |
| `modern_6.remedial_ethics_practical` | Remedial Law, Legal and Judicial Ethics with Practical Exercises | 25% | Day 3 PM |

### 6.3 Legacy 8 subjects (`taxonomy_version = "legacy_8"`)

The legacy taxonomy is the one LawPhil's bar question archive is organised around (`/courts/bm/barQ/[year]/[subject]_Q.html` with subjects like `civil-I`, `remedial-I`, `mercantile`, `political`, `labor`, `criminal`, `taxation`, `ethics`). The eight subjects:

| Code | Name | Historical weight (typical) |
|---|---|---|
| `legacy_8.political_law` | Political Law and Public International Law | ~15% |
| `legacy_8.labor_law` | Labor Law and Social Legislation | ~10% |
| `legacy_8.civil_law` | Civil Law | ~15% |
| `legacy_8.taxation` | Taxation | ~10% |
| `legacy_8.mercantile_law` | Mercantile (Commercial) Law | ~15% |
| `legacy_8.criminal_law` | Criminal Law | ~10% |
| `legacy_8.remedial_law` | Remedial Law | ~20% |
| `legacy_8.legal_ethics` | Legal and Judicial Ethics | ~5% |

(Historical weights are approximate and varied per bar cycle — the exact weight per year should be sourced from the corresponding year's bar bulletin and stored on the `BarExamSitting` row, not on `Subject`.)

### 6.4 Sub-topics

Sub-topic data comes from the Respicio summary of Bar Bulletin No. 1, Series of 2025, because the primary SC syllabus PDFs were inaccessible in the research round (documented in [research notes §8](./research-notes-corpus-platform.md)). The sub-topics below are **what we can confidently ship with**; they need a second pass from prod Claude with the actual syllabus PDFs in hand before we lock them down.

**`modern_6.political_pil`:**
- Fundamental constitutional doctrines
- Powers and functions of governmental branches (legislative, executive, judicial)
- State sovereignty and territorial questions
- Bill of Rights (substantive and procedural due process, equal protection, privacy, speech, religion, etc.)
- Election law
- Administrative law
- Law on public officers
- Public international law: treaties, international organisations, human rights, humanitarian law, maritime law

**`modern_6.commercial_taxation`:**
- Commercial: Corporation Law, Securities Regulation Code, Transportation (common carriers), Insurance Code, Intellectual Property Code, Banking Laws
- Taxation: General principles of taxation, National Internal Revenue Code (as amended by TRAIN, CREATE, Ease of Paying Taxes Act), Tariff and Customs Code, Local Government taxation, Real Property taxation, Tax remedies

**`modern_6.civil_land_titles`:**
- Persons and Family Relations (Family Code)
- Property (possession, ownership, easements)
- Obligations and Contracts
- Special Contracts (sales, lease, partnership, agency, credit transactions)
- Succession and wills
- Quasi-contracts, quasi-delicts, damages
- **Land Titles and Deeds** — Torrens system, Property Registration Decree (P.D. 1529)

**`modern_6.labor_social`:**
- Labor standards (wages, hours, conditions)
- Labor relations (unions, collective bargaining, strikes)
- Termination and due process
- Social legislation: Social Security Law, GSIS Law, PhilHealth, Pag-IBIG
- POEA Rules and Regulations for OFWs

**`modern_6.criminal`:**
- Book I of the Revised Penal Code (general principles, felonies, penalties)
- Book II of the Revised Penal Code (specific felonies)
- Special penal laws: Comprehensive Dangerous Drugs Act (R.A. 9165), Anti-Hazing Law, Anti-VAWC (R.A. 9262), Cybercrime Prevention Act, Anti-Photo and Video Voyeurism, Anti-Terrorism Act

**`modern_6.remedial_ethics_practical`:**
- Civil Procedure (Rules of Court, Rules 1–71)
- Special Proceedings
- Evidence
- Criminal Procedure
- Legal Ethics (Code of Professional Responsibility and Accountability)
- Judicial Ethics (New Code of Judicial Conduct)
- Practical Exercises: drafting pleadings, notarial acts, bar forms

### 6.5 Classification strategy

Documents are classified by the `classify_document_subjects` task described in §4.6. Classification is AI-driven with a confidence score, and the admin can override via the `manualOverride` flag on `DocumentSubjectAssignment`. The classifier prompt is §5.8.

For the initial backfill, we intentionally do **not** require 100% classification coverage before publishing documents. An unclassified document can be ingested and read; it simply won't appear in subject-filtered views until the classifier runs. The nightly scheduled sweep picks up any unclassified documents and runs the classifier on them, subject to the monthly budget. This decouples the ingestion throughput from the classification throughput.

### 6.6 Open questions

- **Sub-topic granularity.** The list above is the Respicio summary. The actual SC syllabus is more granular (it lists specific articles, rules, and cases). Prod Claude with access to the SC syllabus PDFs (via PIO request or an unblocked egress) should produce the real sub-topic list, and we should regenerate sub-topic rows from it before launching. This is documented as a gap.
- **Who owns taxonomy updates?** When the SC issues a new bar bulletin changing weights or restructuring subjects, some admin has to migrate the `Subject` rows. The architecture supports this — new `Subject` rows with a new `taxonomy_version` and new `SubjectEquivalence` rows — but the process is manual. This is fine for MVP because bar bulletins are annual.
- **Classifier drift.** If we re-prompt the classifier six months from now with a better prompt, existing classifications become inconsistent with new ones. The architecture handles this via `manualOverride` and re-classification jobs, but the admin needs a UI to see classification version skew and schedule re-classification. That UI is out of scope for MVP but should be noted.

---

## 7. Admin panel additions

The existing admin surface already covers a lot — `/admin/ingestion`, `/admin/ai-settings`, `/admin/sources`, `/admin/duplicates`, `/admin/flags`, `/admin/doctrines`, `/admin/review`, `/admin/classification`. The target architecture adds five new pages and extends two existing pages.

### 7.1 New page: `/admin/backfill`

**Route file:** `apps/web/src/app/(dashboard)/admin/backfill/page.tsx`

**Content:**
- **Active batches panel** (top): cards for each batch in `running` or `paused` state showing source, year range, progress bar (`candidatesProcessed / candidatesDiscovered`), budget gauge (`budgetConsumedUsd / budgetCeilingUsd`), last tick time, Pause/Resume/Halt buttons.
- **Batch history table**: all batches with filters by source, status, date range.
- **New batch dialog**: form with Source, Endpoint (optional), Year Start, Year End, Month Start (optional), Month End (optional), Budget Ceiling (USD), Admin Notes, "Create and start" / "Create as pending."
- **Halt/Resume dialog**: warning text explaining mid-document vs hard-kill semantics.
- **Extend budget dialog**: numeric input with a preview of the new ceiling and a required reason field.
- **Kill in-flight jobs** (danger zone): big red button, requires typing the batch name to confirm.

**API endpoints:**
- `POST /admin/backfill/batches` — create a new batch. Body: `{ sourceId, sourceEndpointId?, yearStart, yearEnd, monthStart?, monthEnd?, budgetCeilingUsd, adminNotes?, startImmediately: boolean }`.
- `GET /admin/backfill/batches` — list batches. Query: `?status=running&source=lawphil&page=1`.
- `GET /admin/backfill/batches/:id` — batch detail with full cursor state and recent ticks.
- `POST /admin/backfill/batches/:id/start` — transition pending → enumerating.
- `POST /admin/backfill/batches/:id/pause` — transition running → paused.
- `POST /admin/backfill/batches/:id/resume` — transition paused/halted_* → running.
- `POST /admin/backfill/batches/:id/halt` — transition running → halted_admin (graceful). Body: `{ reason: string }`.
- `POST /admin/backfill/batches/:id/kill-inflight` — revoke in-flight Celery tasks. Body: `{ reason: string, confirmName: string }`.
- `PATCH /admin/backfill/batches/:id/budget` — extend budget. Body: `{ newCeilingUsd: number, reason: string }`.
- `DELETE /admin/backfill/batches/:id` — delete a completed/failed batch (does not delete ingested documents).

All write endpoints write to `audit_logs` with `action = "backfill.<verb>"`.

### 7.2 New page: `/admin/budget`

**Route file:** `apps/web/src/app/(dashboard)/admin/budget/page.tsx` (extracted from `/admin/ai-settings` for cleanliness)

**Content:**
- **Current month gauge** — big donut showing `current_spend_usd / monthly_ceiling_usd`, with a secondary gauge for daily if a daily ceiling is set.
- **Budget editor** — inputs for monthly ceiling and optional daily sub-ceiling, with a confirmation dialog before saving.
- **Alert thresholds** — sliders for 75% / 90% / 100% alert levels, with the admin email recipient list.
- **Spend breakdown** — bar chart of spend by derivative type, pie chart of spend by backfill batch, all based on `budget_ledger`.
- **Per-month history** — table of past months with totals.

**API endpoints:**
- `GET /admin/budget/current` — current month snapshot: `{ monthlyCeiling, dailyCeiling?, monthSpend, daySpend, byType, byBatch }`.
- `PATCH /admin/budget/settings` — update ceilings and alert thresholds. Body: `{ monthlyCeilingUsd?, dailyCeilingUsd?, alertThresholds?: [75, 90, 100] }`.
- `GET /admin/budget/history` — monthly rollups.

The PATCH endpoint writes to the `ai_settings` table **and** calls the existing `AiSettingsService.syncBudgetToRedis()` to push the new value to Redis. The daily sub-ceiling is new — it adds a second Redis key `llm:config:daily_budget_usd` and a second usage key `llm:usage:{YYYY-MM-DD}` updated in parallel by the RAG service's `_track_usage` function (a small additive change).

### 7.3 New page: `/admin/schedule`

**Route file:** `apps/web/src/app/(dashboard)/admin/schedule/page.tsx`

The existing `/admin/ai-settings` page has an `ingestion_schedule` editor but it is a raw JSON editor (per recon). The new page gives it a form-driven UI:

**Content:**
- **Global enable toggle** — single switch, mirrors `ingestion_schedule.enabled`.
- **Per-source schedule table** — row per source with columns: Source Name, Enabled, Cron (form editor), Next Run Time (computed), Last Run, Actions (Edit, Delete).
- **Cron form editor** — user-friendly fields (minute, hour, day, month, weekday) with presets ("Every day at 2 AM", "Every 3 hours", "Weekdays at 6 AM").
- **Test schedule button** — dry run that previews what jobs would be created in the next 24 hours without actually creating them.

**API endpoints:**
- `GET /admin/schedule` — returns the parsed `ingestion_schedule` value from `ai_settings`.
- `PUT /admin/schedule` — replaces the whole schedule. Body: `{ enabled, schedules: [{ sourceKey, cron, enabled }] }`.
- `POST /admin/schedule/preview` — dry-run preview.

### 7.4 New page: `/admin/derivatives`

**Route file:** `apps/web/src/app/(dashboard)/admin/derivatives/page.tsx`

**Content:**
- **Generation status dashboard** — per derivative type: total artifacts, pending jobs, failed jobs, spend this month.
- **Re-trigger panel** — form: Derivative Type (dropdown), Source Filter (date range, source, court, subject), Count Estimate (computed before submission), Estimated Cost (computed), Regenerate Existing (checkbox, warning text), "Start generation" button.
- **Job history table** — `derivative_generation_jobs` with filters.
- **Per-job detail** — open a job to see input document, output artifact (if produced), validator verdict, token/cost breakdown.

**API endpoints:**
- `GET /admin/derivatives/stats` — dashboard stats.
- `POST /admin/derivatives/generate` — enqueue a batch of derivative jobs. Body: `{ derivativeType, filters, regenerateExisting: boolean, maxCount: number }`. Returns: `{ enqueuedCount, estimatedCostUsd, jobIds: [] }`.
- `GET /admin/derivatives/jobs` — list jobs.
- `GET /admin/derivatives/jobs/:id` — job detail.
- `POST /admin/derivatives/jobs/:id/retry` — retry a failed job.
- `POST /admin/derivatives/artifacts/:id/regenerate` — regenerate a single artifact.
- `DELETE /admin/derivatives/artifacts/:id` — soft-delete an artifact (for quality rejection).

### 7.5 New page: `/admin/subjects`

**Route file:** `apps/web/src/app/(dashboard)/admin/subjects/page.tsx`

**Content:**
- **Taxonomy picker** — toggle between `modern_6` and `legacy_8` views.
- **Subject tree** — hierarchical view of subjects → sub-topics with document counts.
- **Equivalence map** — read-only view of `SubjectEquivalence` rows.
- **Classification coverage** — per-subject counts of documents classified vs unclassified.
- **Re-classify button** — triggers a classification sweep for a subject or a sub-topic.
- **Manual override review queue** — list of documents where classification confidence is below threshold, with approve/edit controls.

**API endpoints:**
- `GET /admin/subjects` — taxonomy tree.
- `GET /admin/subjects/:id/documents` — documents in a subject.
- `POST /admin/subjects/:id/reclassify` — enqueue a reclassification sweep. Body: `{ filters, force: boolean }`.
- `PATCH /admin/subjects/assignments/:id` — manual override. Body: `{ subjectId, subjectTopicId?, isPrimary, reason }`.

### 7.6 Extension: `/admin/ai-settings`

Once `/admin/budget` and `/admin/schedule` extract the budget and schedule concerns, `/admin/ai-settings` becomes a lightweight settings index page pointing to the three sub-pages plus a model configuration section (`RAG_OPENAI_MODEL`, `derivative_generation.enabled`, `derivative_generation.types_enabled`).

### 7.7 Extension: `/admin/ingestion`

The existing page gains a **Backfill filter** in its trigger-type facet (the existing facet already supports `scheduled` and `manual` — add `backfill` as a third value) and an optional backfill batch column in the job history table.

### 7.8 Open questions

- **Who can click the danger buttons?** "Kill in-flight jobs" and "Extend budget" and "Regenerate all" are all potentially expensive. Should they be gated to a super-admin role? I recommend a `can_manage_ingestion` permission that gates Backfill + Derivatives pages and a stricter `can_manage_budget` for the Budget page.
- **Notification channels.** Budget alerts and backfill halt notifications need to reach the admin. Email is the baseline. Is Slack/Discord webhook integration in scope? I recommend deferring webhooks to a later PR and starting with email-only, since there's already an email infra.
- **Mobile admin access.** The admin panel is web-only. Is mobile-responsive needed for the new pages? Default: yes, responsive but not optimised; the critical workflow is "halt a runaway backfill from my phone," which just needs the Halt button to be tappable.

---

## 8. Disclaimer and rights tracking

### 8.1 Content rights model

Every piece of content in the system falls into one of three rights classes:

- **`public_domain_government`** — raw Philippine legal sources: statutes, Supreme Court decisions, Official Gazette issuances, Congressional records. These are uncopyrightable under the Philippine Civil Code (works of the government). Stored as `LegalDocument` rows. No disclaimer is legally required for the raw content itself, but the *presentation* of these rows in our product still needs attribution to the source (LawPhil, SC e-library, etc.) and a citation note telling the user to verify against the authoritative source.
- **`ai_generated_derivative`** — anything an LLM produced: case digests, MCQs, essay prompts, model answers, flashcards, subject outlines, sample pleadings, sample contracts. These must carry an "educational purposes only, not legal advice" disclaimer and an explicit acknowledgment that the content was AI-generated.
- **`mixed`** — content that quotes verbatim from public-domain sources with AI annotation layered on top. Example: a digest that quotes the court's dispositive paragraph verbatim and adds AI-generated explanation. Disclaimer: both the source attribution and the AI-generation disclaimer apply.

The `DerivativeArtifact.contentRights` column encodes this. The `DerivativeArtifact.contentDisclaimerId` foreign key points at the specific disclaimer text that applies.

### 8.2 The `content_disclaimers` table as the single source of truth

Seeded disclaimer rows (versioned, never edited in place — new version = new row with incremented version number):

| code | appliesTo | shortText |
|---|---|---|
| `public_domain_government.v1` | raw statute/decision rendering | "Raw text sourced from [Source]. Always verify against the official publication." |
| `ai_digest.v1` | case digest | "AI-generated summary for educational purposes only. Not legal advice. Verify against the original decision." |
| `ai_mcq.v1` | MCQ | "AI-generated practice question for bar review. Not an actual bar exam question. Not legal advice." |
| `ai_essay_model_answer.v1` | essay answer | "AI-generated model answer for study reference. Not a definitive statement of the law. Not legal advice." |
| `sample_pleading.v1` | sample pleading | "Template for educational illustration only. Not a substitute for attorney-drafted pleadings. Not legal advice." |
| `sample_contract.v1` | sample contract | "Template for educational illustration only. Not a substitute for attorney-drafted contracts. Not legal advice." |
| `ai_flashcard.v1` | flashcard | "AI-generated study card. Verify before relying on for exam preparation." |
| `ai_subject_outline.v1` | subject outline | "AI-synthesised study outline. Not a substitute for primary sources or casebook study." |

The full `bodyHtml` for each disclaimer is written by prod Claude / a qualified reviewer and checked in with the seed data, not generated by an LLM.

### 8.3 Where the disclaimer appears

**In the API response.** Every `GET /derivatives/:id` response includes a `disclaimer` object with `{ shortText, bodyHtml, code, version }`. The response shape is:

```json
{
  "id": "...",
  "derivativeType": "case_digest",
  "contentJson": { ... },
  "contentRights": "ai_generated_derivative",
  "disclaimer": {
    "code": "ai_digest.v1",
    "version": 1,
    "shortText": "AI-generated summary for educational purposes only...",
    "bodyHtml": "<p>This document was generated by an AI system...</p>"
  },
  "provenance": [{ "sourceDocumentId": "...", "sourceSectionId": "..." }],
  ...
}
```

**In the database schema.** `DerivativeArtifact.contentDisclaimerId` is a non-nullable foreign key. The INSERT cannot succeed without it. The service layer looks up the right disclaimer by `derivativeType` at write time.

**In the frontend rendering.** Each derivative component in the reader UI displays the `shortText` in a persistent banner at the top of the content. Clicking the banner expands into the full `bodyHtml`. The banner is styled conspicuously (yellow background, warning icon). The reader component has a Storybook test that verifies the banner renders for every derivative type.

**In exports.** PDF exports, clipboard copies, and shareable links all include a footer with the disclaimer text. This is enforced by the export service, not by frontend components.

### 8.4 Audit and revision of disclaimer text

Updating a disclaimer is a privileged admin action. The flow:

1. Admin edits a disclaimer in `/admin/content-disclaimers` (a small new admin sub-page).
2. On save, a new row is inserted with `version = old.version + 1` and `effectiveFrom = now`. The old row's `effectiveTo` is set to `now`.
3. Existing `DerivativeArtifact` rows continue to point at the old row (by FK id), so their rendered disclaimer is frozen at whatever version was in force when they were created. New derivatives use the new version.
4. The admin audit log records the change with the full diff of `bodyHtml`.
5. A manual "Re-link all derivatives of type X to latest disclaimer version" action is available but requires a confirmation and an audit log entry.

### 8.5 Open questions

- **Attorney review.** The disclaimer text should ideally be vetted by a Philippine-licensed attorney before launch, especially the "not legal advice" language. Who is that reviewer? This is a user/organisation question, not a technical one.
- **Source attribution text format.** Attribution to LawPhil, SC e-library, Official Gazette, Congress, etc., needs a canonical format per source. I recommend one attribution template per `Source` row (new column `attributionTemplate`) populated in seed data.
- **Derived-of-derived disclaimers.** If a student's private notes quote a derivative, does the disclaimer propagate? Default: yes, at the time of quoting, the derivative's disclaimer is snapshotted into the note's metadata. This is a product decision with light schema implications (`UserNote.quotedDerivativeDisclaimerId` optional FK).

---

## 9. Cost model

This section estimates what it costs to process the full target corpus into the full derivative set under the current LLM provider and model configuration. Every number is an estimate — actual costs will drift with token counts and model pricing — but the order of magnitude is load-bearing for the phase plan.

### 9.1 Baseline assumptions

- **Default model:** `gpt-4o-mini` at $0.15 per 1M input tokens / $0.60 per 1M output tokens (from `MODEL_PRICING` in `services/rag-service/src/core/generation.py`).
- **Token counts per derivative** (rough — needs empirical tuning after the first 100 runs):
  - **Case digest**: 6,000 input tokens (full decision + system prompt) / 1,500 output tokens.
  - **Doctrine extract**: 3,000 input / 500 output.
  - **MCQ (batch of 5)**: 4,000 input / 1,500 output per batch.
  - **Essay prompt + model answer**: 5,000 input / 2,500 output.
  - **Flashcard (batch of 3)**: 2,000 input / 800 output per batch.
  - **Subject outline**: 10,000 input (cross-document) / 3,000 output.
  - **Subject classification**: 2,000 input / 300 output.
  - **Citation extraction**: 3,000 input / 500 output.
- **Cost per derivative** (using gpt-4o-mini pricing):
  - Case digest: (6000 × 0.15 + 1500 × 0.60) / 1M = **$0.0018**
  - Doctrine extract: (3000 × 0.15 + 500 × 0.60) / 1M = **$0.00075**
  - MCQ batch of 5: (4000 × 0.15 + 1500 × 0.60) / 1M = **$0.0015** = **$0.0003 per question**
  - Essay prompt: (5000 × 0.15 + 2500 × 0.60) / 1M = **$0.00225**
  - Flashcard batch of 3: (2000 × 0.15 + 800 × 0.60) / 1M = **$0.00078** = **$0.00026 per card**
  - Subject classification: (2000 × 0.15 + 300 × 0.60) / 1M = **$0.00048**
  - Citation extraction: (3000 × 0.15 + 500 × 0.60) / 1M = **$0.00075**
- **Full derivative set per SC decision:** digest + doctrine extract + 5 MCQs + 3 flashcards + subject classification + citation extraction ≈ $0.0018 + $0.00075 + $0.0015 + $0.00078 + $0.00048 + $0.00075 = **$0.0050 per decision**.

### 9.2 Target corpus sizes

Verified from research notes and research:

- **LawPhil jurisprudence, 1901–present** — estimated at ~100 decisions per month × 12 months × 125 years ≈ **150,000 decisions**, though early years (1901–1930s) have fewer. Call it **~100,000 decisions** as a conservative-central estimate, to be refined empirically during the enumeration pass.
- **LawPhil bar questions, 2006–2022** — ~8 subjects per year × 17 years × ~20 questions per subject ≈ **~2,700 bar questions**. These are the source material, not derivatives — they get ingested as `LegalDocument` rows and tagged with `BarExamSitting`, then MCQs and essays can be derived from them.
- **Republic Acts** — Congress has passed ~12,000 Republic Acts since 1946. Not all are on congress.gov.ph in machine-readable form; budget for ~5,000 that we can actually ingest via the Congress fetcher.
- **Codals** — the major Philippine codes (Civil Code, Revised Penal Code, Family Code, Labor Code, Tax Code, etc.) total perhaps 30 documents at the code level, but thousands of articles/sections.

### 9.3 Full-corpus processing cost

- **SC decisions full derivative set (100,000 decisions × $0.0050)** = **$500**.
- **Statute/codal processing (digest + classification + MCQs, roughly equivalent cost per unit, ~5,000 units × $0.0050)** = **$25**.
- **Bar exam questions (2,700 × classification + cite extraction, ~$0.0012 each)** = **$3**.
- **Subject outlines (~50 outlines at $0.008 each)** = **$0.40**.
- **Classification sweep on already-ingested documents (~20,000 existing docs × $0.00048)** = **$10**.
- **Total one-time backfill cost**: **~$540**.

This **fits in ~3 months of the current $200/month ceiling** — roughly: pay the bill for three months and the historical corpus is done. It does **not** fit in a single month, which is why the backfill engine needs to support mid-month halt and resume against the budget ceiling. At the current $200/month cap, a full corpus derivative backfill takes approximately **three months of continuous spend**, after which steady-state watch-loop cost is trivial (a handful of new decisions per day × $0.005 = cents per day).

If the admin raises the ceiling to $500/month, the full backfill completes in **one month plus a buffer**. If the admin raises to $1,000/month, it completes within one month with full safety margin.

### 9.4 Phased rollout within budget

Given the $200/month constraint, the phased rollout proposed in §12 does derivatives by source priority:

- **Phase A** (month 1, ~$200): Backfill LawPhil decisions 2015–2025 + full derivative set. ~12,000 decisions × $0.005 = $60 in LLM cost, the rest is headroom for the daily watch loop and iterative prompt tuning.
- **Phase B** (month 2, ~$200): Backfill LawPhil decisions 2001–2014 + full derivative set. ~17,000 decisions × $0.005 = $85.
- **Phase C** (month 3, ~$200): Backfill LawPhil decisions pre-2001 + statutes + bar questions. Remaining ~70,000 SC decisions (many with thinner text) × $0.003–$0.005 ≈ $250 — likely spills into month 4.
- **Phase D** (month 4, ~$100–$200): Finish tail, subject outlines, classification sweep.

These are conservative phases; they assume prompt tuning will double-spend some documents (regeneration). A more aggressive plan that skips regeneration can finish in three months comfortably.

### 9.5 Open questions

- **Which derivative types are actually enabled in phase 1?** Enabling all eight derivative types at once multiplies cost. A minimum viable phase 1 might be digest + subject classification only ($0.0023 per decision instead of $0.0050), which halves the backfill cost. This is a product-priority call I am not qualified to make.
- **Model escalation for quality-sensitive derivatives.** MCQs and essay model answers may need `gpt-4o` ($2.50/$10.00 per 1M) instead of `gpt-4o-mini`. If every MCQ uses gpt-4o, the per-question cost rises from $0.0003 to ~$0.005 — a 16× increase. The decision should be driven by the golden-set evaluation (§5) once prompts are drafted.
- **Embedding costs.** Not modeled here. Every new document needs an embedding for the vector index. At current OpenAI `text-embedding-3-small` prices ($0.02 per 1M tokens), 100,000 decisions × ~2,000 tokens each × $0.02 / 1M = ~$4. Trivial compared to derivative generation, but it should still count against the budget ledger.
- **Retry costs.** Validator rejections force regeneration. If 15% of outputs fail validation and get regenerated once, effective cost rises 15%. If the second attempt also fails, a third attempt at 2% adds marginal cost. Budget with a 20% cushion on top of the §9.3 estimates to cover retries.

---

## 10. Test strategy

The user's framing is explicit: the system has bugs and doesn't work, and this rebuild needs to avoid the same fate. The test strategy is designed around that constraint — every new layer gets tests commensurate with its blast radius, and every layer that the user currently does not trust gets **integration** tests, not just unit tests.

### 10.1 Test pyramid per layer

| Layer | Primary test type | Coverage target | What's being tested |
|---|---|---|---|
| Fetcher base class | Unit | 100% of branches | SSRF allowlist, rate limiting, retry, Cloudflare detection |
| Concrete fetchers (LawPhil, SC, OG, Congress) | Fixture-based integration | 90% | Fetch fixture HTML from `tests/fixtures/<source>/`, assert parsed `CandidateDoc` output matches golden JSON |
| Parsers | Unit | 95% | Section extraction, metadata extraction, edge-case HTML |
| Dedup classifier | Unit | 100% | Every tier and boundary condition with synthetic documents |
| Backfill engine tick task | Integration (with Postgres + Redis) | 85% | Lifecycle transitions, cursor persistence, mid-document halt, budget halt |
| Backfill enumeration task | Integration | 85% | Year-range walk, cursor init, candidate count |
| Derivative generation pipeline | Integration (mocked LLM) | 80% | Fanout, validator dispatch, provenance enforcement, failure handling |
| Per-type validators | Unit | 100% | Each check branch, each rejection reason |
| Subject classification service | Unit + integration | 85% | Classification result parsing, manual override, taxonomy compat layer |
| Admin API endpoints | Integration (E2E) | 80% | Auth guards, tenant scoping, state machine transitions, audit log emission |
| Admin UI pages | Component + Storybook | 70% | Form validation, disabled states, danger dialog confirmations |
| Cost killswitch | Integration | 100% | Budget check on every LLM call path, Redis key shape, 503 response |
| Budget ledger reconciliation | Integration | 90% | Redis vs Postgres reconciliation, rollback safety |
| Disclaimer enforcement | Integration | 100% | Cannot write derivative without disclaimer FK, API response includes disclaimer |

### 10.2 Golden sets

Three golden sets exist for quality validation — they are **prerequisites** for any quality claim about derivatives:

1. **Case digest golden set** — 20 hand-written digests of real SC decisions, covering 5 per subject family. Lives at `services/worker-service/tests/golden/case_digests.json`. Each entry has the source document ID, the expected IRAC fields, and the expected citations. The digest evaluator (offline task) compares generated output to these with BLEU-like metrics plus manual sampling.
2. **MCQ golden set** — 50 hand-written MCQs tagged with subject, sub-topic, and difficulty. Lives at `services/worker-service/tests/golden/mcq_questions.json`. Each entry has the source doctrine, the expected stem, the expected correct answer, and a note on what distractors should *not* look like.
3. **Subject classification golden set** — 100 hand-labeled documents with their expected subject(s) in both taxonomy versions. Lives at `services/worker-service/tests/golden/subject_classification.json`. Used to track classifier accuracy over time as prompts evolve.

These golden sets do not exist yet. Creating them is a blocking prerequisite for Phase 4 of the implementation plan (§12).

### 10.3 End-to-end happy path test

A single high-signal E2E test that exercises the whole stack:

1. Create a `BackfillBatch` for LawPhil, year 2023, month 6, budget $0.50.
2. Run the enumeration task.
3. Run N backfill ticks.
4. Assert that child `IngestionJob` rows are created with `backfillBatchId` set.
5. Mock the fetcher to return a fixed decision HTML.
6. Assert that `LegalDocument` rows land and pass the truthfulness validator.
7. Assert that `DerivativeGenerationJob` rows are enqueued for each enabled derivative type.
8. Mock the LLM to return a valid structured case digest.
9. Assert that the `DerivativeArtifact` row lands with `contentDisclaimerId` populated and at least one `ProvenanceRecord` row.
10. Assert that `budget_ledger` has a spend entry for the generation call.
11. Halt the batch via the admin API.
12. Assert that the batch reaches `halted_admin` after in-flight jobs complete.

This test lives at `services/worker-service/tests/e2e/test_backfill_full_stack.py` and runs in CI against a disposable Postgres + Redis container.

### 10.4 Chaos / fault injection tests

Scenarios that the fixture-based tests should cover explicitly (these are the classes of bug that bit us in PR #1):

- Fetcher returns a Cloudflare challenge mid-batch → batch transitions to paused, not failed.
- LLM call times out → `DerivativeGenerationJob` marks failed, retries once, gives up on second timeout.
- Redis unavailable during budget check → fail closed (raise 503), do not silently succeed.
- Cursor state is corrupt on resume → backfill falls back to the last `BackfillCheckpoint` row.
- Two backfill ticks race to update the same cursor → optimistic locking rejects the second update.
- Validator rejects 100% of an output batch → job marks failed with all reasons.
- Subject classifier returns an unknown subject code → validator rejects, no `DocumentSubjectAssignment` row is written.
- Disclaimer row is deleted out from under a derivative → FK constraint prevents the delete.

### 10.5 Contract tests between Python and TypeScript

Pydantic schemas in `services/worker-service/src/schemas/derivative_outputs.py` and Zod schemas in `packages/legal-schema/src/derivative_outputs.ts` must agree on every derivative output shape. A CI step runs a cross-language contract test that generates JSON Schema from both sides and diffs them. Mismatches fail the build.

### 10.6 Open questions

- **Prompt regression tests.** Do we want prompt-level snapshot tests that re-run every prompt on a fixed input and diff against a committed output? Useful for catching prompt drift, but output nondeterminism makes them flaky. My recommendation: run prompts with `temperature=0` for tests and compare against a small committed snapshot with a tolerance. But this is a judgement call.
- **Load tests.** The backfill engine needs to survive running at high concurrency on a real corpus. A dedicated load test that runs 5 batches × 10 in-flight jobs each for 30 minutes against a test corpus is probably warranted before the first real backfill. Is that in scope for MVP?

---

## 11. Migration plan from current state

This section enumerates, explicitly, what carries forward unchanged, what gets modified, what is new, and what is deprecated.

### 11.1 Carries forward unchanged

All of the following are production-ready after PR #1 and PR #2 and **require no edits** in the new work:

- `services/worker-service/src/fetchers/base.py` — `BaseFetcher` class, SSRF allowlist, rate limiter, retry logic, `CloudflareBlockedError`.
- `services/worker-service/src/fetchers/registry.py` — parser type → fetcher class registry.
- `services/worker-service/src/fetchers/lawphil.py` — LawPhil concrete fetcher (proven on 43 decisions in 9 seconds per PR #1).
- `services/worker-service/src/fetchers/supreme_court.py` — SC e-library fetcher.
- `services/worker-service/src/fetchers/official_gazette.py` — OG fetcher.
- `services/worker-service/src/classifiers/dedup_classifier.py` — 5-tier dedup classifier.
- `services/worker-service/src/parsers/html_parser.py` — `extract_sections`, `parse_legal_document`.
- `services/worker-service/src/parsers/metadata_extractor.py` — metadata extraction.
- `services/worker-service/src/validators/truthfulness_validator.py` — document-level validator, unchanged signature.
- `apps/api/src/modules/sources/ingestion-scheduler.service.ts` — NestJS scheduler (PR #1 fix).
- `apps/api/src/modules/sources/sources.service.ts` — source CRUD.
- `apps/api/src/modules/ai-settings/ai-settings.service.ts::syncBudgetToRedis` — budget → Redis sync.
- `services/rag-service/src/core/generation.py::_check_budget`, `_track_usage`, `generate_completion`, `stream_completion` — LLM client and cost tracking.
- `apps/api/prisma/schema.prisma` existing models: `Source`, `SourceEndpoint`, `LegalDocument`, `LegalDocumentVersion`, `LegalDocumentSection`, `IngestionJob`, `IngestionCandidate`, `Citation`, `DoctrineExtract`, `DoctrineLink`, `ProvenanceRecord`, `ModelRun`, `AuditLog`, `AiSettings`, `LegalMetadataTag`, `LegalDocumentTagMap`, `DocumentSimilarity`, `CaseCodalLink`, `EditorialFlag`.
- `apps/web/src/app/(dashboard)/admin/ingestion/page.tsx` — existing ingestion dashboard.
- `apps/web/src/app/(dashboard)/admin/sources/*` — source management UI.
- The daily watch loop in its entirety. It continues running as a subordinate tributary.

### 11.2 Modified

- **`services/worker-service/src/tasks/ingestion_tasks.py`** — adds:
  - `enumerate_backfill_candidates(batch_id)` task
  - `run_backfill_batch_tick(batch_id)` task
  - domain event emission on successful `process_ingestion_candidate` → triggers derivative consideration
- **`services/worker-service/src/celery_app.py`** — adds a `run_backfill_batch_tick` beat schedule (every 30 seconds) that dispatches ticks for all running batches.
- **`apps/api/src/modules/ai-settings/ai-settings.service.ts`** — adds `syncDailyBudgetToRedis`, extends settings schema to include `llm_daily_budget_usd`, `backfill_concurrency`, `derivative_generation.*`.
- **`services/rag-service/src/core/generation.py::_check_budget`** — extends to also check the daily Redis key and to also write a `budget_ledger` row via the RAG service's new database client.
- **`apps/web/src/app/(dashboard)/admin/ai-settings/page.tsx`** — slimmed down as concerns move to `/admin/budget`, `/admin/schedule`, and `/admin/derivatives`.
- **`apps/web/src/app/(dashboard)/admin/ingestion/page.tsx`** — adds `backfill` as a trigger type filter.
- **`apps/api/prisma/schema.prisma`** — additive only. New models per §2.1–§2.6. New nullable columns per §2.4. No destructive edits.
- **Audit log role enforcement** — a Prisma migration adds a PostgreSQL role that has INSERT-only permission on `audit_logs`. The application connects as this role when writing audit entries. This closes a standing gap.

### 11.3 Net new

- All tables in §2 — `backfill_batches`, `backfill_checkpoints`, `derivative_artifacts`, `mcq_questions`, `mcq_options`, `essay_prompts`, `bar_exam_sittings`, `derivative_generation_jobs`, `subjects`, `subject_topics`, `subject_equivalences`, `document_subject_assignments`, `content_disclaimers`, `budget_ledger`.
- `services/worker-service/src/backfill/` — new module: batch service, enumerator, tick worker, cursor management.
- `services/worker-service/src/validators/derivative_validators/` — per-type validators (§4.4).
- `services/worker-service/src/tasks/derivative_tasks.py` — `run_derivative_generation`, `classify_document_subjects` tasks.
- `services/worker-service/src/services/derivative_writer.py` — transactional derivative persistence.
- `services/worker-service/src/schemas/derivative_outputs.py` — Pydantic schemas for every derivative output type.
- `apps/api/src/modules/backfill/` — new NestJS module with controller, service, DTOs, guards.
- `apps/api/src/modules/derivatives/` — new NestJS module with controller, service, DTOs.
- `apps/api/src/modules/subjects/` — new NestJS module with taxonomy service and compatibility layer.
- `apps/api/src/modules/budget/` — new NestJS module extracting budget concerns from `ai-settings`.
- `apps/web/src/app/(dashboard)/admin/backfill/` — new UI.
- `apps/web/src/app/(dashboard)/admin/budget/` — new UI.
- `apps/web/src/app/(dashboard)/admin/schedule/` — new UI with form-driven cron editor.
- `apps/web/src/app/(dashboard)/admin/derivatives/` — new UI.
- `apps/web/src/app/(dashboard)/admin/subjects/` — new UI.
- `packages/legal-schema/src/derivative_outputs.ts` — TypeScript/Zod schemas shared with the web app.
- `services/worker-service/tests/fixtures/*` — fetcher HTML fixtures.
- `services/worker-service/tests/golden/*` — golden sets for evaluation (created during Phase 4).

### 11.4 Deprecated / removed

- **Nothing is removed in the first several PRs.** The architecture is additive. The `Digest` model continues to exist until an explicit migration PR moves all frontend readers to `DerivativeArtifact`. When that PR lands, `Digest` is scheduled for deprecation with a three-month sunset window.
- The raw JSON editor in `/admin/ai-settings` for `ingestion_schedule` is superseded by the form editor in `/admin/schedule` but remains accessible as a "raw mode" fallback for one release cycle, then removed.

### 11.5 Ordering and safety

Every migration in the phase plan is **additive-only** until the final PR in each phase. No destructive migrations (column drops, type changes, table renames) until the new schema is proven in production and the dependent code has been deployed for at least one cycle. This means:

- Phase 1 migration: add new tables, add nullable columns, add new indexes.
- Phase 2 migrations: continue adding; no drops.
- Phase N (later): once all code paths are proven on the new schema, remove the old columns and tables in a single dedicated "sunset" PR.

### 11.6 Open questions

- **Which database role applies to worker-service's direct Postgres access?** Currently the worker reads from Postgres via a read-only pool (per CLAUDE.md). Writing `ProvenanceRecord`, `DerivativeArtifact`, etc., from the worker may mean the worker now needs write access on those specific tables. The alternative is to route all derivative writes through a NestJS API the worker calls back to — cleaner but adds latency. I recommend the latter (keep the Python worker as read-only on primary data, call back to NestJS for writes) but it's a significant shape decision.

---

## 12. Phase plan — concrete PR sequence

This is the implementation ordering. Each entry is a PR-sized chunk of work with explicit acceptance criteria. Each phase is independently shippable and visible on staging. The first PR in each phase produces a visible change; no "groundwork-only" PRs that take more than a week.

### Phase 1: Foundation (4 PRs)

**PR 1.1 — Schema additions for backfill + disclaimers.**
Add `backfill_batches`, `backfill_checkpoints`, `content_disclaimers`, and `budget_ledger` tables. Seed `content_disclaimers` with initial versions. Add the additive column `ingestion_jobs.backfill_batch_id`. No code yet — migration + seed only.
*Acceptance:* migration applies cleanly on staging; seed produces 8 disclaimer rows; Prisma Studio shows the new tables; audit-log role migration added for append-only enforcement.

**PR 1.2 — Backfill NestJS module + empty admin UI.**
New `/admin/backfill` page rendering an empty table (no data yet) and a "New Batch" dialog that creates a `pending` batch. Corresponding NestJS controller + service + DTOs + guards (`can_manage_ingestion`). No Celery tasks yet.
*Acceptance:* admin can create a pending backfill batch via the UI; the row lands in Postgres; the page shows it; audit log has a `backfill.create` entry.

**PR 1.3 — Subject taxonomy tables and seed.**
Add `subjects`, `subject_topics`, `subject_equivalences`, `document_subject_assignments`. Seed with both `modern_6` and `legacy_8` taxonomies per §6, plus sub-topics at the level of granularity currently available from Respicio (tag them as `source = "respicio_summary"` so a later PR can replace with SC syllabus data).
*Acceptance:* seed produces 6 modern subjects + 8 legacy subjects + their sub-topics + the equivalence rows; `/admin/subjects` placeholder page shows the tree; no classification runs yet.

**PR 1.4 — Budget page extraction and daily sub-ceiling.**
New `/admin/budget` page extracted from `/admin/ai-settings`. Add `llm_daily_budget_usd` setting and the matching Redis key. Extend `_check_budget` to check daily in addition to monthly. Add `BudgetLedger` writes to the LLM call path. Nightly reconcile task.
*Acceptance:* daily and monthly gauges show correct values on staging; attempting to exceed the daily ceiling raises 503; `budget_ledger` rows accumulate; nightly reconcile matches Redis to Postgres within rounding.

### Phase 2: Backfill engine (3 PRs)

**PR 2.1 — Enumeration task for LawPhil jurisprudence.**
Implement `enumerate_backfill_candidates` for the LawPhil fetcher. Walks year → month → decision file using the verified URL structure. Writes cursor state and candidate count to `backfill_batches`. No actual document fetching yet — just enumeration.
*Acceptance:* admin creates a backfill batch for LawPhil 2023, clicks Start, enumeration task runs, `candidatesDiscovered` populates, status transitions to `running`, cursor state visible in admin UI. No decisions fetched yet.

**PR 2.2 — Tick worker and child job creation.**
Implement `run_backfill_batch_tick` Celery Beat task. Each tick reads cursor, creates N child `IngestionJob` rows pointing at the right endpoint, advances cursor, persists. Child jobs flow through existing `run_ingestion_job` → `process_ingestion_candidate` without modification. Add `ingestion_jobs.backfill_batch_id` write.
*Acceptance:* a backfill batch for LawPhil 2023 completes end-to-end on staging with real LawPhil fetches; every decision lands as a `LegalDocument` row with `ingestionSource = "backfill"`; dedup handles re-runs; cursor advances monotonically.

**PR 2.3 — Halt/resume/extend-budget controls.**
Wire the admin UI Pause, Resume, Halt, and Extend Budget actions through to the backfill service. Implement mid-document halt safety. Implement the `halted_budget` automatic transition when a batch hits its ceiling.
*Acceptance:* admin can halt a running batch; it transitions to `halted_admin` after in-flight jobs complete; admin can extend budget and resume; `halted_budget` fires when the batch hits the ceiling, logs an audit entry, and sends an email alert.

### Phase 3: Derivative artifacts core (3 PRs)

**PR 3.1 — `DerivativeArtifact` and `ProvenanceRecord` write path.**
Add `derivative_artifacts`, `derivative_generation_jobs`, `mcq_questions`, `mcq_options`, `essay_prompts`, `bar_exam_sittings`. Implement `derivative_writer.write_derivative` with transactional provenance enforcement. Implement the `DerivativeValidator` protocol and the `CaseDigestValidator` concrete class. No LLM call yet — tests populate artifacts directly.
*Acceptance:* unit tests cover the writer and the case digest validator; attempting to write without provenance raises; attempting to write without a disclaimer FK raises; test coverage ≥ 90% on the validator.

**PR 3.2 — Case digest generation end-to-end.**
Implement `run_derivative_generation` for `case_digest` only. Integrate with the LLM client (`gpt-4o-mini`, `temperature=0`). Context packer, output parser, validator call, provenance write. Wire the domain event `legal_document.ingested` → `consider_derivative_generation` → `DerivativeGenerationJob` enqueue.
*Acceptance:* staging a backfill batch for LawPhil Jan 2024 produces real case digests with real provenance; `budget_ledger` shows the spend; all digests pass the validator (or are cleanly rejected with reasons); `/admin/derivatives` page shows the generated artifacts.

**PR 3.3 — Schedule page with form-driven cron editor.**
New `/admin/schedule` page with the form editor, preview dry-run, and test button. Migrate the existing raw JSON editor to read-only "advanced mode."
*Acceptance:* admin can create and edit schedule entries through the form without writing JSON; the dry-run preview shows correct expected next runs; the existing scheduler reads the new form-produced values unchanged.

### Phase 4: Quality loop (3 PRs)

**PR 4.1 — Golden sets + evaluator.**
Create `services/worker-service/tests/golden/case_digests.json` with 20 hand-written digests, `mcq_questions.json` with 50, `subject_classification.json` with 100. Implement an offline evaluator that runs a prompt version against a golden set and produces a score report. Add a CI step that runs the evaluator on every prompt change and fails if regression exceeds a tolerance.
*Acceptance:* golden sets exist; evaluator produces a JSON report; CI enforces the tolerance; the first baseline prompt's score is committed as the baseline.

**PR 4.2 — Subject classification pipeline.**
Implement `classify_document_subjects` task using the subject classification prompt (prod Claude fills in §5.8 placeholder). Write `DocumentSubjectAssignment` rows. Extend the `/admin/subjects` page with classification coverage and reclassify controls.
*Acceptance:* staging a backfill produces classified documents; the coverage gauge shows the rate; classifier accuracy against the golden set is ≥ 80%.

**PR 4.3 — Second derivative type: doctrine extract.**
Implement the `doctrine_extract` derivative type end-to-end. Reuses the same write path, new prompt, new validator.
*Acceptance:* doctrine extract generates on newly ingested documents; validator rejects doctrines whose text doesn't appear in the source.

### Phase 5: Derivative types for bar review (3 PRs)

**PR 5.1 — MCQ derivative type.**
Implement `mcq` derivative type. Use golden set for evaluation. Default to `gpt-4o-mini` with an override to `gpt-4o` if golden-set eval shows gpt-4o-mini isn't good enough.
*Acceptance:* MCQs generate from source documents; each MCQ has exactly one correct answer; distractors are distinct; provenance points at source sections; evaluator score ≥ baseline.

**PR 5.2 — Essay prompt + model answer derivative type.**
Implement `essay_prompt` and `essay_model_answer` types. Support ingestion of LawPhil bar questions into `BarExamSitting` rows. Wire essay generation from bar sittings.
*Acceptance:* admin can trigger essay generation for a year range of bar sittings; generated essays reference the source sitting row; model answers cite source decisions.

**PR 5.3 — Flashcard and subject outline derivative types.**
Implement `flashcard` and `subject_outline` types. Flashcards generated from doctrine extracts. Subject outlines generated cross-document from a subject-topic bundle.
*Acceptance:* flashcards and outlines land on staging; outlines reference multiple source documents; validators enforce structural rules.

### Phase 6: Admin polish + full rollout (2 PRs)

**PR 6.1 — Derivatives admin page polish + regeneration.**
Complete `/admin/derivatives` with full re-trigger controls, cost preview, regeneration safeguards. Add per-type enable toggles in settings.
*Acceptance:* admin can re-trigger generation for a filtered range with accurate cost preview; regeneration requires confirmation; per-type enable toggle works.

**PR 6.2 — Full LawPhil backfill dry run.**
A test batch: LawPhil 2020–2025, all derivative types enabled, $100 budget ceiling. Document the run in a `docs/runbooks/first-backfill.md` playbook.
*Acceptance:* the run completes within budget; runbook is written; any issues encountered are logged as follow-up PRs.

### Phase 7 and beyond (not scoped here)

- Sample pleadings and contracts (lower priority; needs more legal review than the prior phases).
- Performance optimisation for large backfills (read replica, sharded OpenSearch).
- The user scan → private digest path (already functional; not touched by this plan).
- Mobile app integration with subject-filtered views.

### 12.1 Phase dependencies and parallelism

- Phase 1 PRs can be done mostly in parallel (1.1, 1.3 independent; 1.2 depends on 1.1; 1.4 can be independent or follow 1.1).
- Phase 2 depends on Phase 1 complete.
- Phase 3 depends on Phase 1 complete (does not depend on Phase 2; the first derivatives can be triggered by the daily watch loop before any backfill batch runs).
- Phase 4.1 (golden sets) can start as early as Phase 1 since it is mostly manual curation work.
- Phase 5 depends on Phase 3 and Phase 4.1.
- Phase 6 depends on Phase 5.

### 12.2 Open questions

- **Who writes the golden sets?** This is a meaningful labor investment (at least 10–15 hours of expert time). Prod Claude can draft candidates; the user or an external reviewer needs to verify them. This is the single biggest unquantified item in the plan.
- **Which model for MCQs?** Pending golden-set evaluation. Budget assumes `gpt-4o-mini`; if quality forces `gpt-4o`, rework the cost model for Phase 5.
- **Is there room to parallelise Phase 2 and Phase 3?** Technically yes — they touch different parts of the codebase — but doing them serially makes integration testing much simpler. My recommendation is serial.

---

## Appendix A: File and location index

The files referenced throughout this document, for quick navigation during implementation:

**Existing files (carry forward unchanged unless noted):**
- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/sources/ingestion-scheduler.service.ts`
- `apps/api/src/modules/sources/sources.service.ts`
- `apps/api/src/modules/ai-settings/ai-settings.service.ts`
- `apps/web/src/app/(dashboard)/admin/ingestion/page.tsx`
- `apps/web/src/app/(dashboard)/admin/ai-settings/page.tsx`
- `apps/web/src/app/(dashboard)/admin/sources/`
- `services/worker-service/src/fetchers/base.py`
- `services/worker-service/src/fetchers/registry.py`
- `services/worker-service/src/fetchers/lawphil.py`
- `services/worker-service/src/fetchers/supreme_court.py`
- `services/worker-service/src/fetchers/official_gazette.py`
- `services/worker-service/src/fetchers/congress.py`
- `services/worker-service/src/classifiers/dedup_classifier.py`
- `services/worker-service/src/parsers/html_parser.py`
- `services/worker-service/src/parsers/metadata_extractor.py`
- `services/worker-service/src/tasks/ingestion_tasks.py`
- `services/worker-service/src/validators/truthfulness_validator.py`
- `services/worker-service/src/celery_app.py`
- `services/rag-service/src/core/generation.py`
- `services/rag-service/src/config.py`

**New files (created across the phase plan):**
- `apps/api/src/modules/backfill/` (controller, service, dtos, guards)
- `apps/api/src/modules/derivatives/` (controller, service, dtos)
- `apps/api/src/modules/subjects/` (taxonomy service, compatibility layer)
- `apps/api/src/modules/budget/` (extracted from ai-settings)
- `apps/api/prisma/migrations/*backfill*.sql` (additive)
- `apps/api/prisma/migrations/*derivatives*.sql` (additive)
- `apps/api/prisma/migrations/*subjects*.sql` (additive)
- `apps/web/src/app/(dashboard)/admin/backfill/page.tsx`
- `apps/web/src/app/(dashboard)/admin/budget/page.tsx`
- `apps/web/src/app/(dashboard)/admin/schedule/page.tsx`
- `apps/web/src/app/(dashboard)/admin/derivatives/page.tsx`
- `apps/web/src/app/(dashboard)/admin/subjects/page.tsx`
- `services/worker-service/src/backfill/` (batch service, enumerator, tick worker)
- `services/worker-service/src/validators/derivative_validators/` (per-type validators)
- `services/worker-service/src/tasks/derivative_tasks.py`
- `services/worker-service/src/services/derivative_writer.py`
- `services/worker-service/src/schemas/derivative_outputs.py`
- `services/worker-service/tests/fixtures/<source>/*.html`
- `services/worker-service/tests/golden/case_digests.json`
- `services/worker-service/tests/golden/mcq_questions.json`
- `services/worker-service/tests/golden/subject_classification.json`
- `services/worker-service/tests/e2e/test_backfill_full_stack.py`
- `packages/legal-schema/src/derivative_outputs.ts`

## Appendix B: Glossary

- **Backfill batch** — an admin-defined unit of historical ingestion work with a budget ceiling and checkpoint state. Parent of many `IngestionJob` rows.
- **Watch loop** — the daily scheduler-driven ingestion that catches new content. Continues unchanged.
- **Derivative artifact** — any AI-generated content layered over a source document (digest, MCQ, essay, flashcard, outline, sample pleading, sample contract).
- **Taxonomy version** — either `modern_6` (SC 2025/2026 structure) or `legacy_8` (traditional Philippine bar structure). Every subject belongs to exactly one taxonomy version.
- **Provenance** — the chain of `ProvenanceRecord` rows linking a derivative artifact back to the source document sections that produced it. Mandatory for every derivative.
- **Content rights** — `public_domain_government`, `ai_generated_derivative`, or `mixed`. Encoded on every derivative.
- **Validator verdict** — `publish`, `human_review`, or `quarantine`. Returned by every per-type derivative validator.

---

*End of target architecture document. Ready for prod Claude review.*





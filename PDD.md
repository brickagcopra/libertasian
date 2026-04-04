# LIBERTASIAN — Product Design Document (PDD)

**Version:** 1.0
**Date:** March 18, 2026
**Author:** Brick (Product & Technical Lead)
**Status:** Draft
**Classification:** Internal — Confidential
**Companion Document:** LIBERTASIAN PRD v1.0

---

## Table of Contents

1. [Overview & Design Goals](#1-overview--design-goals)
2. [Technology Stack](#2-technology-stack)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Service Breakdown](#4-service-breakdown)
5. [Database Schema](#5-database-schema)
6. [RAG Pipeline Design](#6-rag-pipeline-design)
7. [Mobile Camera Scan Architecture](#7-mobile-camera-scan-architecture)
8. [Admin Ingestion Pipeline Architecture](#8-admin-ingestion-pipeline-architecture)
9. [Monorepo Folder Structure](#9-monorepo-folder-structure)
10. [Infrastructure & Deployment](#10-infrastructure--deployment)
11. [Security Architecture](#11-security-architecture)
12. [API Design Conventions](#12-api-design-conventions)
13. [Data Flow Diagrams](#13-data-flow-diagrams)
14. [Performance & Scalability](#14-performance--scalability)
15. [Monitoring & Observability](#15-monitoring--observability)
16. [Implementation Sequence](#16-implementation-sequence)
17. [Coding Standards & Agent Guide](#17-coding-standards--agent-guide)

---

## 1. Overview & Design Goals

LIBERTASIAN is a Philippine legal AI platform combining AI-powered legal research, case digest generation, codal reading, mobile camera scanning, and editorial corpus management. This PDD defines the technical architecture, data models, service decomposition, and implementation strategy.

### 1.1 Design Goals

- **Monolith-first, modular-ready** — Start with a NestJS monolith using domain-driven modules that can be extracted to microservices when scale demands.
- **Authoritative-source-first retrieval** — Every data path and ranking signal must prioritize official government legal sources.
- **Private-by-default** — User-generated content (scans, uploads, notes) is architecturally isolated from the editorial corpus with explicit promotion gates.
- **Offline-capable mobile** — React Native app must support offline codal reading and cached digests via local storage.
- **Self-hosted LLM inference** — vLLM for model serving to control costs, latency, and data sovereignty.
- **VPS-friendly Phase 1** — The initial deployment must run on commodity VPS infrastructure without requiring GPU clusters.

### 1.2 Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend (Web) | Next.js 15 + TypeScript + Tailwind CSS + shadcn/ui | Server components, SEO for public corpus pages, rich component library |
| Frontend (Mobile) | React Native + Expo + Expo Router | React Native docs recommend Expo as the preferred framework path for most new apps |
| Backend (App) | NestJS + TypeScript | Modular domain-driven structure, guards/interceptors/decorators for RBAC, WebSocket support for collaboration |
| Backend (AI/ML) | Python + FastAPI + Celery workers | Python ecosystem for ML/NLP, FastAPI for high-throughput async endpoints, Celery for background job orchestration |
| Database | PostgreSQL 16 | System of record, JSONB for flexible metadata, pgvector extension for initial vector storage |
| ORM | Prisma | Type-safe queries, migration management, schema-as-code |
| Cache / Rate Limit | Redis 7 | Pub/sub for real-time, sorted sets for rate limiting, job coordination |
| Search | OpenSearch 2.x | Hybrid search combining keyword (BM25) and semantic (kNN) via search pipelines |
| Vector (optional) | Qdrant (Phase 5+) | Advanced hybrid retrieval with dense+sparse+reranking when scale requires dedicated vector infra |
| Object Storage | S3-compatible (MinIO self-hosted or cloud) | Raw PDFs, scan images, OCR text, snapshots, exports |
| LLM Serving | vLLM | OpenAI-compatible API, high-throughput distributed inference, Docker deployment |
| State Management (Web) | Zustand + TanStack Query | Zustand for lightweight UI state, TanStack Query for server state cache |
| State Management (Mobile) | TanStack Query + MMKV/SQLite | MMKV for key-value, SQLite for structured offline cache |
| Monorepo | Turborepo | Shared packages, incremental builds, task orchestration |

---

## 2. Technology Stack

### 2.1 Frontend — Web

```
Framework:        Next.js 15 (App Router)
Language:         TypeScript 5.x (strict mode)
Styling:          Tailwind CSS 4.x
Components:       shadcn/ui (Radix primitives)
State:            Zustand (UI state), TanStack Query v5 (server state)
Forms:            React Hook Form + Zod validation
Rich Text:        Tiptap (for notes/annotations editor)
Charts:           Recharts (for admin dashboards)
Auth:             NextAuth.js / custom JWT flow
Testing:          Vitest + React Testing Library + Playwright (E2E)
```

### 2.2 Frontend — Mobile

```
Framework:        React Native 0.76+ with Expo SDK 52+
Navigation:       Expo Router (file-based)
State:            TanStack Query v5 (server state)
Local Storage:    react-native-mmkv (fast KV), expo-sqlite (structured cache)
Camera:           expo-camera + expo-image-manipulator
Document Scan:    react-native-document-scanner (edge detection, perspective correction)
OCR Preview:      expo-ml-kit or tesseract.js (optional on-device OCR)
Offline:          Custom sync manager with SQLite + MMKV
Styling:          NativeWind (Tailwind for RN) or StyleSheet
Testing:          Jest + React Native Testing Library + Detox (E2E)
```

### 2.3 Backend — NestJS App Core

```
Runtime:          Node.js 22 LTS
Framework:        NestJS 11
Language:         TypeScript 5.x (strict mode)
ORM:              Prisma 6 with PostgreSQL
Validation:       class-validator + class-transformer
Auth:             Passport.js (JWT strategy) + custom guards
WebSocket:        @nestjs/websockets (Socket.IO adapter) for live collaboration
Queue:            BullMQ (Redis-backed) for async NestJS jobs
Events:           @nestjs/event-emitter for domain events
API Docs:         @nestjs/swagger (OpenAPI 3.1)
Testing:          Jest + Supertest (E2E)
```

### 2.4 Backend — Python AI/ML Services

```
Runtime:          Python 3.12
Framework:        FastAPI 0.110+
Task Queue:       Celery 5 with Redis broker (or Dramatiq/Arq)
OCR:              Tesseract 5 + pytesseract, optional PaddleOCR for complex layouts
PDF Parsing:      PyMuPDF (fitz) + pdfplumber
Image Processing: Pillow + OpenCV (deskew, enhance, crop)
NLP:              spaCy (Philippine legal NER, citation extraction)
Embedding:        sentence-transformers (via FastAPI endpoint or direct vLLM)
Reranker:         cross-encoder models served via FastAPI
LLM Client:       openai Python SDK (pointed at vLLM's OpenAI-compatible API)
Web Scraping:     httpx + BeautifulSoup4 + Scrapy (for complex crawl jobs)
Testing:          pytest + httpx (async testing)
```

### 2.5 Data Layer

```
PostgreSQL 16:    System of record, pgvector extension
Redis 7:          Cache, rate limits, BullMQ queues, pub/sub
OpenSearch 2.x:   Full-text + kNN hybrid search
MinIO:            S3-compatible object storage (self-hosted)
Qdrant:           Optional Phase 5+ vector store
```

### 2.6 LLM / ML Models

```
vLLM Server:      Self-hosted, Docker-deployed, OpenAI-compatible API
Instruct Model:   Strong open instruct model (e.g., Llama 3.1 70B or Qwen 2.5 72B)
Reasoning Model:  Reasoning-heavy model for digest/memo (e.g., DeepSeek-R1 or Qwen-QwQ)
Embedding Model:  Dedicated embedding model (e.g., BGE-M3 or E5-Mistral)
Reranker Model:   Cross-encoder reranker (e.g., BGE-Reranker-v2 or Jina Reranker)
OCR Vision:       Optional vision model for difficult scans (e.g., Qwen-VL or Florence-2)
```

---

## 3. High-Level Architecture

```
┌──────────────────────┐       ┌─────────────────────────────┐
│   Web App (Next.js)  │       │  Mobile App (RN + Expo)     │
│   SSR + CSR          │       │  Camera Scan / Offline      │
└──────────┬───────────┘       └──────────────┬──────────────┘
           │                                  │
           └────────────── HTTPS/API ─────────┘
                              │
                   ┌──────────▼──────────┐
                   │  API Gateway / BFF  │
                   │  (Rate Limit, Auth, │
                   │   Tenant Resolution,│
                   │   Feature Gating)   │
                   └──────────┬──────────┘
                              │
    ┌─────────┬───────────┬───┴────┬──────────┬──────────────┐
    │         │           │        │          │              │
┌───▼──┐ ┌───▼───┐ ┌─────▼──┐ ┌──▼───┐ ┌───▼────┐ ┌───────▼───────┐
│ Auth │ │Worksp.│ │ Search │ │Billing│ │ Admin  │ │  Upload /     │
│Module│ │Module │ │ Module │ │Module │ │Console │ │  Camera Cap.  │
└──┬───┘ └──┬────┘ └───┬────┘ └──┬───┘ └───┬────┘ └───────┬───────┘
   │        │          │         │          │              │
   └────────┴──────────┴────┬────┴──────────┴──────────────┘
                            │
                ┌───────────▼────────────┐
                │    NestJS App Core     │
                │  (Domain Modules)      │
                └───────────┬────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
    ┌─────▼─────┐    ┌─────▼─────┐    ┌──────▼──────┐
    │ PostgreSQL │    │   Redis   │    │ Object Store│
    │  + pgvector│    │           │    │ (MinIO/S3)  │
    └─────┬─────┘    └───────────┘    └─────────────┘
          │
    ┌─────┴──────────────────────────┐
    │  Tables: users, orgs, legal_   │
    │  documents, digests, matters,  │
    │  uploads, audit_logs, etc.     │
    └────────────────────────────────┘
                            │
              ┌─────────────▼──────────────┐
              │   AI / Retrieval Layer     │
              │   (Python Microservices)   │
              └─────────────┬──────────────┘
                            │
    ┌───────────┬───────────┼──────────┬──────────────┐
    │           │           │          │              │
┌───▼───┐ ┌────▼────┐ ┌────▼───┐ ┌────▼────┐ ┌──────▼──┐
│Crawler│ │  OCR    │ │Embedding│ │  RAG    │ │  vLLM   │
│Fetcher│ │Service  │ │Service  │ │Orchestr.│ │ Server  │
└───┬───┘ └────┬────┘ └────┬───┘ └────┬────┘ └─────────┘
    │          │           │          │
    └──────────┴───────────┴──────┬───┘
                                  │
                    ┌─────────────▼──────────────┐
                    │  OpenSearch + pgvector      │
                    │  (Hybrid Search Index)      │
                    │  [Optional: Qdrant Phase 5] │
                    └────────────────────────────┘
```

---

## 4. Service Breakdown

### 4.1 API Gateway / BFF Layer

**Responsibilities:** Route web and mobile requests, validate JWT auth tokens, resolve tenant/organization context, enforce subscription entitlements and feature gates, apply rate limits, normalize response shapes.

**Implementation:** NestJS middleware chain with custom guards and interceptors. Rate limiting via Redis sliding window. Feature flags checked against subscription entitlements stored in PostgreSQL.

```typescript
// Example guard chain on a protected endpoint
@UseGuards(JwtAuthGuard, TenantGuard, SubscriptionGuard('pro'))
@Get('digests/generate')
async generateDigest(@Param('documentId') documentId: string) { ... }
```

### 4.2 Auth & Identity Service

**Responsibilities:** Email/password authentication, Google OAuth, email verification, password reset, MFA (TOTP), device/session management, organization membership, RBAC enforcement, JWT issuance/refresh.

**Key Design Decisions:**
- JWT access tokens (15-minute TTL) + refresh tokens (7-day TTL, rotated on use)
- Refresh tokens stored in PostgreSQL for revocation capability
- Organization roles: owner, admin, editor, member, reviewer, student
- Permission checks implemented as NestJS guards composable with decorators

### 4.3 Workspace Service

**Responsibilities:** Matter CRUD, folder management, notes (rich text), saved digests, user uploads, private knowledge base, sharing controls.

**Key Design Decisions:**
- Matters are org-scoped — every matter belongs to an organization (individual users get a personal org)
- Document attachments link to either legal_documents (corpus) or user_uploads (private)
- Notes use Tiptap-compatible JSON storage for rich text rendering
- Sharing uses a capability-based model: share tokens with expiry and permission level

### 4.4 Search Service

**Responsibilities:** Query parsing, exact citation search, metadata filtering, hybrid search orchestration, result merging, highlighting, related authorities resolution.

**Key Design Decisions:**
- OpenSearch serves as the primary search backend with two index types: `legal_documents_keyword` (BM25) and `legal_documents_vector` (kNN with HNSW)
- Hybrid search uses OpenSearch's search pipeline feature to combine BM25 and kNN results
- Citation regex patterns normalize Philippine legal citations (G.R. No., RA No., PD No., etc.)
- Results include highlighted snippets with section-level anchors for deep linking

```
OpenSearch Index Structure:
├── legal_documents_keyword (BM25)
│   ├── title, citation_text, plain_text, section_text
│   ├── metadata: court, date, ponente, document_type, jurisdiction
│   └── tags: subject, topic, bar_subject
│
└── legal_documents_vector (kNN / HNSW)
    ├── embedding_vector (float[768] or float[1024])
    ├── document_id, section_id
    └── metadata filters for pre-filtering
```

### 4.5 RAG Service (Python)

**Responsibilities:** Query intent detection, retrieval orchestration (call Search Service + vector store), reranking, context packing with citation anchors, grounded generation via vLLM, structured output validation, abstention handling.

**Key Design Decisions:**
- FastAPI service with async endpoints
- Intent classifier runs first (lightweight model or rule-based) to route query to correct retrieval strategy
- Context packer enforces a token budget and selects passages by reranker score
- Generation prompt template enforces citation rules (see RAG Pipeline Design section)
- Output validator checks that every cited source ID exists and supports the generated claim
- Abstention is a first-class response type — not an error

### 4.6 Document Processing Service (Python)

**Responsibilities:** PDF parsing, OCR, image enhancement, layout detection, page segmentation, language detection, citation extraction, structured section extraction.

**Key Design Decisions:**
- PyMuPDF for native PDF text extraction (fast, reliable for digital PDFs)
- Tesseract 5 for OCR with Philippine/English language packs
- OpenCV for image pre-processing (deskew, denoise, contrast enhancement)
- Layout analysis segments legal documents into standard sections (headnote, facts, issue, ruling, ratio, dispositive)
- Citation extraction uses regex patterns + spaCy NER for Philippine legal citation formats

### 4.7 Digest Generation Service (Python)

**Responsibilities:** Summary generation, facts extraction, petitioner/respondent arguments extraction, issues identification, ruling extraction, ratio/doctrine extraction, dispositive portion identification, cited authorities extraction, digest formatting, confidence scoring, human review hook triggering.

**Key Design Decisions:**
- Uses the reasoning-heavy LLM (via vLLM) with a structured DFIR+ output prompt (`digest_dfir_plus_v1`)
- All 8 DFIR+ sections generated in a single JSON response with provenance markers
- **Auto-generation in ingestion pipeline:** The `generate_ingestion_digest` Celery task fires as part of `chain_post_ingestion()`, producing a draft digest alongside citation/doctrine extraction. Non-blocking — failure does not block document publishing.
- Confidence score is computed from: source field coverage (6 required + 2 optional fields), provenance record mapping, section availability factor
- If confidence < 0.7: `review_status = 'needs_human_review'`; if >= 0.7: `review_status = 'ai_generated'` (auto-approvable for official sources)
- Dedicated RAG endpoint `POST /digests/generate` (separate from `/memos/generate`) with digest-specific prompt template

### 4.8 Source Ingestion Service (Python)

**Responsibilities:** Crawl official sources, scheduled fetches, source deduplication, metadata extraction, authenticity checks, canonical source selection, snapshot storage, re-indexing triggers.

**Key Design Decisions:**
- Scrapy-based crawlers with per-source spider configurations
- Each source endpoint has a parser_type determining how content is extracted
- Every fetched document is stored as a raw snapshot with hash + timestamp before normalization
- Deduplication uses a similarity_key (normalized title + citation + date hash) plus content checksum
- Updated documents create new legal_document_versions rows — never overwrite

### 4.9 Mobile Capture Service

**Responsibilities:** Receive camera scan uploads, trigger quality scoring, orchestrate OCR pipeline, trigger legal document classification, trigger digest generation for entitled users, manage privacy flags.

**Key Design Decisions:**
- Uploads received via multipart/form-data to NestJS Upload Module
- Images stored in object storage under `uploads/{org_id}/{user_id}/{capture_id}/`
- Quality score computed from image resolution, blur detection, contrast analysis
- Low-quality scans are flagged with a warning but not rejected (user can retry or accept)
- Privacy level defaults to 'private' — user must explicitly change

### 4.10 Billing / Plan Enforcement Service

**Responsibilities:** Subscription management, plan entitlements, quota tracking, seat management, API usage metering.

**Key Design Decisions:**
- Integrate with payment provider supporting Philippine market (Xendit)
- Entitlements stored as JSONB on subscriptions table for flexible feature gating
- Quota tracking via Redis counters with daily/monthly reset
- Seat management enforces max members per organization based on plan

### 4.11 Audit / Compliance Service

**Responsibilities:** Immutable activity logging, source provenance tracking, admin action logging, model/prompt version logging, legal document lineage history.

**Key Design Decisions:**
- audit_logs table is append-only (no UPDATE/DELETE permissions for app role)
- model_runs table tracks every LLM invocation with prompt template version, model version, input/output references
- provenance_records table links every derivative (digest, answer, summary) back to its source document and section
- All admin editorial actions (approve, reject, publish, quarantine) are logged with actor, timestamp, and metadata

---

## 5. Database Schema

### 5.1 Core Identity & Tenancy

```sql
-- Users
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255),
    full_name       VARCHAR(255) NOT NULL,
    phone           VARCHAR(50),
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    -- status: active, suspended, deactivated
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Organizations (individuals get a personal org)
CREATE TABLE organizations (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  VARCHAR(255) NOT NULL,
    slug                  VARCHAR(100) UNIQUE NOT NULL,
    type                  VARCHAR(20) NOT NULL DEFAULT 'individual',
    -- type: individual, firm, school, editorial
    billing_owner_user_id UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Organization Members
CREATE TABLE organization_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL DEFAULT 'member',
    -- role: owner, admin, editor, member, reviewer, student
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- Subscriptions
CREATE TABLE subscriptions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_code             VARCHAR(50) NOT NULL,
    -- plan_code: free, edu, pro, team, enterprise
    status                VARCHAR(20) NOT NULL DEFAULT 'active',
    -- status: active, past_due, cancelled, expired
    billing_period        VARCHAR(20) NOT NULL DEFAULT 'monthly',
    current_period_start  TIMESTAMPTZ,
    current_period_end    TIMESTAMPTZ,
    seats                 INTEGER NOT NULL DEFAULT 1,
    entitlements_json     JSONB NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.2 Legal Corpus

```sql
-- Source Registry
CREATE TABLE sources (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(255) NOT NULL,
    type           VARCHAR(30) NOT NULL,
    -- type: official, semi_official, editorial, user_upload, camera_capture
    domain         VARCHAR(255),
    trust_level    VARCHAR(10) NOT NULL DEFAULT 'medium',
    -- trust_level: high, medium, low
    enabled        BOOLEAN NOT NULL DEFAULT true,
    fetch_strategy VARCHAR(20) NOT NULL DEFAULT 'crawler',
    -- fetch_strategy: crawler, manual, api, upload
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source Endpoints
CREATE TABLE source_endpoints (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id          UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    endpoint_url       TEXT NOT NULL,
    content_type_hint  VARCHAR(50),
    schedule_cron      VARCHAR(100),
    parser_type        VARCHAR(50) NOT NULL,
    last_fetched_at    TIMESTAMPTZ,
    last_success_at    TIMESTAMPTZ,
    status             VARCHAR(20) NOT NULL DEFAULT 'active'
);

-- Legal Documents (the core corpus table)
CREATE TABLE legal_documents (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id            UUID REFERENCES sources(id),
    canonical_url        TEXT,
    external_id          VARCHAR(255),
    document_type        VARCHAR(30) NOT NULL,
    -- document_type: case, statute, rule, issuance, memorandum, order,
    --               digest, reviewer, user_private_doc
    jurisdiction         VARCHAR(50) DEFAULT 'PH',
    title                TEXT NOT NULL,
    short_title          VARCHAR(500),
    citation_text        VARCHAR(500),
    gr_no                VARCHAR(100),
    docket_no            VARCHAR(100),
    promulgation_date    DATE,
    decision_date        DATE,
    publication_date     DATE,
    ponente              VARCHAR(255),
    court                VARCHAR(255),
    agency               VARCHAR(255),
    status               VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- status: draft, published, unpublished, archived
    language             VARCHAR(10) DEFAULT 'en',
    checksum             VARCHAR(128),
    version_no           INTEGER NOT NULL DEFAULT 1,
    is_official          BOOLEAN NOT NULL DEFAULT false,
    is_published         BOOLEAN NOT NULL DEFAULT false,
    truthfulness_status  VARCHAR(20) NOT NULL DEFAULT 'needs_review',
    -- truthfulness_status: verified, needs_review, quarantined
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_legal_docs_type ON legal_documents(document_type);
CREATE INDEX idx_legal_docs_gr_no ON legal_documents(gr_no);
CREATE INDEX idx_legal_docs_citation ON legal_documents(citation_text);
CREATE INDEX idx_legal_docs_court_date ON legal_documents(court, decision_date);
CREATE INDEX idx_legal_docs_status ON legal_documents(status, is_published);

-- Document Versions (immutable snapshots)
CREATE TABLE legal_document_versions (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_document_id          UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    raw_file_object_key        TEXT,
    normalized_text_object_key TEXT,
    html_object_key            TEXT,
    extracted_json             JSONB,
    snapshot_hash              VARCHAR(128) NOT NULL,
    parser_version             VARCHAR(50),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Document Sections (for section-level retrieval)
CREATE TABLE legal_document_sections (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_document_id   UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    parent_section_id   UUID REFERENCES legal_document_sections(id),
    section_type        VARCHAR(30) NOT NULL,
    -- section_type: headnote, facts, issue, ruling, ratio, dispositive,
    --              article, rule, section, body
    section_label       VARCHAR(255),
    ordering            INTEGER NOT NULL DEFAULT 0,
    plain_text          TEXT,
    html_text           TEXT,
    page_start          INTEGER,
    page_end            INTEGER,
    token_count         INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sections_doc_id ON legal_document_sections(legal_document_id);
CREATE INDEX idx_sections_type ON legal_document_sections(section_type);

-- Metadata Tags
CREATE TABLE legal_metadata_tags (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code     VARCHAR(100) UNIQUE NOT NULL,
    name     VARCHAR(255) NOT NULL,
    tag_type VARCHAR(30) NOT NULL
    -- tag_type: subject, topic, court, agency, bar_subject, statute_area
);

CREATE TABLE legal_document_tag_map (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    tag_id            UUID NOT NULL REFERENCES legal_metadata_tags(id) ON DELETE CASCADE,
    UNIQUE(legal_document_id, tag_id)
);

-- Citations (cross-references between documents)
CREATE TABLE citations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_document_id  UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
    from_section_id   UUID REFERENCES legal_document_sections(id),
    to_document_id    UUID REFERENCES legal_documents(id),
    citation_text     TEXT NOT NULL,
    citation_type     VARCHAR(20) NOT NULL,
    -- citation_type: case, statute, rule, issuance, unknown
    normalized_citation VARCHAR(500),
    confidence        REAL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_citations_from ON citations(from_document_id);
CREATE INDEX idx_citations_to ON citations(to_document_id);

-- Embeddings (references to vector store entries)
CREATE TABLE embeddings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type       VARCHAR(20) NOT NULL,
    -- entity_type: document, section, digest, note
    entity_id         UUID NOT NULL,
    embedding_model   VARCHAR(100) NOT NULL,
    vector_ref        TEXT NOT NULL,
    sparse_vector_ref TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_embeddings_entity ON embeddings(entity_type, entity_id);
```

### 5.3 Digests & Editorial Outputs

```sql
-- Digests
CREATE TABLE digests (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_document_id     UUID REFERENCES legal_documents(id),
    organization_id       UUID REFERENCES organizations(id),
    user_id               UUID REFERENCES users(id),
    source_origin         VARCHAR(30) NOT NULL,
    -- source_origin: official_pipeline, admin_generated, user_scan,
    --               user_upload, camera_capture
    title                 TEXT NOT NULL,
    digest_type           VARCHAR(30) NOT NULL,
    -- digest_type: case_digest, statute_summary, reviewer_note, study_digest
    facts                 TEXT,
    issues                TEXT,
    ruling                TEXT,
    doctrine              TEXT,
    dispositive           TEXT,
    cited_authorities_json JSONB DEFAULT '[]',
    confidence_score      REAL,
    review_status         VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- review_status: draft, ai_generated, needs_human_review, approved, rejected
    visibility            VARCHAR(20) NOT NULL DEFAULT 'private',
    -- visibility: private, org, public_editorial
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_digests_doc ON digests(legal_document_id);
CREATE INDEX idx_digests_user ON digests(user_id);
CREATE INDEX idx_digests_review ON digests(review_status);

-- Digest Reviews
CREATE TABLE digest_reviews (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    digest_id              UUID NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
    reviewer_user_id       UUID NOT NULL REFERENCES users(id),
    verdict                VARCHAR(10) NOT NULL,
    -- verdict: approve, reject, revise
    notes                  TEXT,
    truthfulness_score     REAL,
    completeness_score     REAL,
    citation_accuracy_score REAL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Doctrine Extracts
CREATE TABLE doctrine_extracts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_document_id UUID REFERENCES legal_documents(id),
    digest_id         UUID REFERENCES digests(id),
    text              TEXT NOT NULL,
    confidence        REAL,
    review_status     VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.4 User Workspace

```sql
-- Matters
CREATE TABLE matters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    owner_user_id   UUID NOT NULL REFERENCES users(id),
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    matter_type     VARCHAR(50),
    court           VARCHAR(255),
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Matter Documents
CREATE TABLE matter_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id         UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    legal_document_id UUID REFERENCES legal_documents(id),
    user_upload_id    UUID REFERENCES user_uploads(id),
    title             VARCHAR(500),
    role              VARCHAR(20) NOT NULL DEFAULT 'reference',
    -- role: evidence, reference, pleading, research, note
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notes
CREATE TABLE notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    matter_id       UUID REFERENCES matters(id),
    title           VARCHAR(500),
    body            JSONB NOT NULL DEFAULT '{}',
    -- Tiptap-compatible JSON for rich text
    visibility      VARCHAR(20) NOT NULL DEFAULT 'private',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bookmarks
CREATE TABLE bookmarks (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    legal_document_id         UUID NOT NULL REFERENCES legal_documents(id),
    legal_document_section_id UUID REFERENCES legal_document_sections(id),
    note                      TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Annotations
CREATE TABLE annotations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    legal_document_id UUID NOT NULL REFERENCES legal_documents(id),
    section_id        UUID REFERENCES legal_document_sections(id),
    text_anchor       JSONB NOT NULL,
    -- text_anchor: { start_offset, end_offset, anchor_text }
    annotation_text   TEXT,
    color             VARCHAR(20) DEFAULT 'yellow',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.5 Uploads & Camera Capture

```sql
-- User Uploads
CREATE TABLE user_uploads (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id),
    upload_type       VARCHAR(20) NOT NULL,
    -- upload_type: pdf, image, docx, camera_scan
    original_filename VARCHAR(500),
    mime_type         VARCHAR(100),
    object_key        TEXT NOT NULL,
    checksum          VARCHAR(128),
    page_count        INTEGER,
    ocr_status        VARCHAR(20) DEFAULT 'pending',
    -- ocr_status: pending, processing, completed, failed
    processing_status VARCHAR(20) DEFAULT 'pending',
    -- processing_status: pending, processing, completed, failed
    privacy_level     VARCHAR(30) NOT NULL DEFAULT 'private',
    -- privacy_level: private, org_private, editorial_candidate
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Camera Captures
CREATE TABLE camera_captures (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_upload_id        UUID NOT NULL REFERENCES user_uploads(id) ON DELETE CASCADE,
    device_platform       VARCHAR(20),
    -- device_platform: ios, android
    capture_mode          VARCHAR(20) NOT NULL DEFAULT 'single_page',
    -- capture_mode: single_page, multi_page, book_scan
    image_count           INTEGER NOT NULL DEFAULT 1,
    enhancement_profile   VARCHAR(50),
    capture_quality_score REAL,
    extracted_text_status VARCHAR(20) DEFAULT 'pending',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upload Processing Jobs
CREATE TABLE upload_processing_jobs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_upload_id UUID NOT NULL REFERENCES user_uploads(id) ON DELETE CASCADE,
    job_type       VARCHAR(30) NOT NULL,
    -- job_type: ocr, classify, digest_generate, embed, index
    status         VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- status: pending, running, completed, failed
    attempts       INTEGER NOT NULL DEFAULT 0,
    error_message  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.6 Admin Ingestion

```sql
-- Ingestion Jobs
CREATE TABLE ingestion_jobs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id          UUID NOT NULL REFERENCES sources(id),
    source_endpoint_id UUID REFERENCES source_endpoints(id),
    job_type           VARCHAR(30) NOT NULL,
    -- job_type: crawl, fetch, parse, ocr, classify, digest_generate, publish
    status             VARCHAR(20) NOT NULL DEFAULT 'pending',
    started_at         TIMESTAMPTZ,
    finished_at        TIMESTAMPTZ,
    records_found      INTEGER DEFAULT 0,
    records_created    INTEGER DEFAULT 0,
    records_updated    INTEGER DEFAULT 0,
    errors_json        JSONB DEFAULT '[]'
);

-- Ingestion Candidates (discovered but not yet processed)
CREATE TABLE ingestion_candidates (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id               UUID NOT NULL REFERENCES sources(id),
    detected_url            TEXT,
    detected_title          TEXT,
    detected_document_type  VARCHAR(30),
    checksum                VARCHAR(128),
    similarity_key          VARCHAR(500),
    status                  VARCHAR(20) NOT NULL DEFAULT 'new',
    -- status: new, duplicate, review, accepted, rejected
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Editorial Flags
CREATE TABLE editorial_flags (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_document_id UUID REFERENCES legal_documents(id),
    digest_id         UUID REFERENCES digests(id),
    flag_type         VARCHAR(30) NOT NULL,
    -- flag_type: hallucination_risk, weak_citation, duplicate,
    --           ocr_low_quality, source_conflict, copyright_risk
    severity          VARCHAR(10) NOT NULL DEFAULT 'medium',
    -- severity: low, medium, high, critical
    details           TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'open',
    -- status: open, reviewing, resolved, dismissed
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.7 Audit & Safety

```sql
-- Audit Logs (append-only)
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    actor_user_id   UUID REFERENCES users(id),
    actor_type      VARCHAR(10) NOT NULL DEFAULT 'user',
    -- actor_type: user, admin, system
    action          VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID,
    metadata_json   JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_org ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- Model Runs (every LLM invocation)
CREATE TABLE model_runs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_type                VARCHAR(30) NOT NULL,
    -- run_type: answer, digest, summary, citation_extract, ocr_postprocess
    model_name              VARCHAR(100) NOT NULL,
    model_version           VARCHAR(100),
    prompt_template_version VARCHAR(50),
    input_ref               TEXT,
    output_ref              TEXT,
    confidence              REAL,
    tokens_in               INTEGER,
    tokens_out              INTEGER,
    latency_ms              INTEGER,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Provenance Records (links derivatives to sources)
CREATE TABLE provenance_records (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type        VARCHAR(20) NOT NULL,
    -- entity_type: document, section, digest, answer
    entity_id          UUID NOT NULL,
    source_document_id UUID NOT NULL REFERENCES legal_documents(id),
    source_section_id  UUID REFERENCES legal_document_sections(id),
    provenance_type    VARCHAR(20) NOT NULL,
    -- provenance_type: quoted, derived, summarized, ocr_extracted
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_provenance_entity ON provenance_records(entity_type, entity_id);
CREATE INDEX idx_provenance_source ON provenance_records(source_document_id);
```

---

## 6. RAG Pipeline Design

### 6.1 Pipeline Architecture

```
┌─────────────┐
│ User Query  │
└──────┬──────┘
       ▼
┌──────────────────┐
│ Intent Classifier │ ── Lightweight classifier (rule-based + small model)
└──────┬───────────┘
       ├── exact_citation → Citation Lookup Route (direct DB/OpenSearch)
       ├── case_research  → Hybrid Research Route
       ├── codal_interp   → Codal/Statute Route (section-level retrieval)
       ├── procedural     → Hybrid Research Route (boosted for rules/procedures)
       ├── digest_gen     → Digest Generation Route (full-text retrieval)
       ├── memo_draft     → Drafting Route (multi-query retrieval)
       ├── user_upload    → Private Docs Route (user-scoped vector search)
       └── matter_query   → Matter Route (matter-scoped retrieval)
       ▼
┌────────────────────────┐
│ Query Rewriter/Expander │ ── Legal synonym injection, citation normalization,
└──────┬─────────────────┘    Taglish→English translation (if applicable)
       ▼
┌─────────────────────┐
│   Hybrid Retrieval   │
│ ┌─────────────────┐ │
│ │ BM25 (OpenSearch)│ │ ── Keyword + metadata filters + facets
│ └────────┬────────┘ │
│ ┌────────▼────────┐ │
│ │ kNN (pgvector/  │ │ ── Semantic vector similarity
│ │  OpenSearch kNN) │ │
│ └────────┬────────┘ │
└──────────┼──────────┘
           ▼
┌─────────────────────┐
│ Candidate Merge (RRF)│ ── Reciprocal Rank Fusion or weighted score combination
└──────────┬──────────┘
           ▼
┌──────────────────┐
│ Reranker (CE)     │ ── Cross-encoder reranker for precision
└──────────┬───────┘
           ▼
┌────────────────────────┐
│ Context Pack Builder    │
│ • Top-k source passages │
│ • Metadata per passage  │
│ • Citation anchors      │
│ • Token budget mgmt     │
│ • Confidence per passage│
└──────────┬─────────────┘
           ▼
┌──────────────────────────┐
│ Grounded Generation      │
│ (vLLM + citation prompt) │
│ • Answer / Digest / Memo │
│ • Citation map            │
│ • Abstention if weak      │
└──────────┬───────────────┘
           ▼
┌──────────────────────┐
│ Output Validator      │
│ • Citation check      │
│ • Unsupported claim   │
│   detector            │
│ • Legal format check  │
└──────────┬────────────┘
           ▼
┌──────────────────────────┐
│ Response + Provenance    │
│ Record                   │
└──────────────────────────┘
```

### 6.2 Prompt Template Structure (Generation)

```
SYSTEM:
You are a Philippine legal research assistant. Answer ONLY based on the
provided source passages. Follow these rules strictly:

1. CITE every substantive claim using [SOURCE_ID§SECTION] format.
2. If the source passages do not sufficiently support an answer, respond
   with: "The retrieved sources do not sufficiently address this question.
   Consider broadening your search or consulting primary sources directly."
3. DISTINGUISH between:
   - Direct source text (quote with citation)
   - Your summary of source text (paraphrase with citation)
   - Your analytical inference (explicitly label as "Analysis:")
4. NEVER assert a legal proposition without a supporting source passage.
5. NEVER fabricate case names, G.R. numbers, dates, or holdings.
6. Use Philippine legal terminology and citation format.
7. If multiple sources conflict, present both positions with citations.

SOURCE PASSAGES:
{context_passages_with_ids_and_metadata}

USER QUERY:
{user_query}

ANSWER:
```

### 6.3 Digest Generation Prompt Template (DFIR+ Gold Standard)

Template version: `digest_dfir_plus_v1`

```
SYSTEM:
You are a Philippine legal research assistant specializing in generating
structured case digests. Produce a DFIR+ digest in JSON with these 8 sections:

1. SUMMARY: One-paragraph overview (2-4 sentences)
2. DOCTRINE: Key legal principle established or applied (3-5 sentences)
3. FACTS: Concise narrative of material facts
4. PETITIONER_ARGUMENTS: Petitioner/appellant's key arguments (null if N/A)
5. RESPONDENT_ARGUMENTS: Respondent/appellee's key arguments (null if N/A)
6. ISSUES: Legal issues framed as "Whether..." questions
7. RULING: Court's holding + ratio decidendi for each issue
8. DISPOSITIVE: Dispositive portion (verbatim where possible)
9. CITED_AUTHORITIES: All cited cases, statutes, rules

For each section, include [§SECTION_REF] provenance markers referencing
source section IDs. If a section cannot be reliably extracted, set to null.
NEVER fabricate case names, G.R. numbers, dates, or holdings.

Output as JSON with provenance array linking fields to source sections.

DOCUMENT SECTIONS:
{sections_with_ids}
```

**Auto-generation pipeline:** This prompt is invoked automatically by
`generate_ingestion_digest` Celery task during `chain_post_ingestion()`.
The resulting digest is stored with `source_origin = 'official_pipeline'`
and enters the admin review queue.

---

## 7. Mobile Camera Scan Architecture

### 7.1 On-Device Pipeline

```
Camera Preview
    │
    ▼
┌──────────────────┐
│ Edge Detection    │ ── react-native-document-scanner
│ (Page boundary)   │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ User confirms    │
│ crop / retake    │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Image Processing │ ── expo-image-manipulator
│ • Deskew         │
│ • Deblur         │
│ • Contrast/Light │
│ • Compression    │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Multi-page Queue │ ── User captures additional pages
│ (Page ordering)  │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Optional On-Device│ ── Quick preview only (not authoritative)
│ OCR Preview      │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Upload to Server │ ── Encrypted in transit (TLS 1.3)
│ (multipart POST) │    Optional pre-encryption on device
└──────────────────┘
```

### 7.2 Server-Side Pipeline

```
Upload Received (NestJS Upload Module)
    │
    ▼
┌─────────────────────┐
│ Store in Object      │ ── uploads/{org_id}/{user_id}/{capture_id}/
│ Storage              │
└──────┬──────────────┘
       ▼
┌─────────────────────┐
│ Create Processing    │ ── BullMQ job chain
│ Jobs                 │
└──────┬──────────────┘
       ▼
┌─────────────────────┐
│ Quality Scoring      │ ── Resolution, blur, contrast analysis
│ (Python Worker)      │
└──────┬──────────────┘
       ▼
┌─────────────────────┐
│ OCR                  │ ── Tesseract 5 + language detection
│ (Python Worker)      │    PaddleOCR for complex layouts
└──────┬──────────────┘
       ▼
┌─────────────────────┐
│ Layout Analysis      │ ── Detect sections, headers, body text
│ (Python Worker)      │
└──────┬──────────────┘
       ▼
┌─────────────────────┐
│ Legal Doc            │ ── Classify as case/statute/rule/etc.
│ Classification       │
└──────┬──────────────┘
       ▼
┌─────────────────────┐
│ Citation Extraction  │ ── Regex + NER for PH legal citations
└──────┬──────────────┘
       ▼
┌───────────────────────────┐
│ Entitlement Check         │ ── Is user on paid plan?
│                           │
│ ├── YES → Digest Gen      │ ── AI digest via vLLM
│ │         Save to Dashboard│
│ └── NO  → OCR Text Only   │ ── Preview, prompt upgrade
└───────────────────────────┘
       ▼
┌─────────────────────┐
│ Save Results         │ ── digest + OCR text + metadata
│ to PostgreSQL        │    Link to user_uploads + camera_captures
└──────────────────────┘
```

---

## 8. Admin Ingestion Pipeline Architecture

```
┌──────────────────────┐
│ Source Registry       │ ── Admin enables/configures source
│ (PostgreSQL)          │
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Scheduler (Celery     │ ── Cron-based per source_endpoints.schedule_cron
│ Beat / APScheduler)   │
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Source Fetch Job      │ ── Scrapy spider or httpx fetcher
│ (Celery Worker)       │    per source parser_type
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Document Discovery    │
│ ├── New              │ ── Not in corpus (by similarity_key + checksum)
│ ├── Updated          │ ── Exists but content changed (new checksum)
│ └── Duplicate        │ ── Already exists with matching key + checksum
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Fetch Raw Content     │ ── Download PDF/HTML, store as snapshot
│ Store with Hash +     │    in object storage
│ Timestamp             │
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Normalize / OCR       │ ── Clean HTML, extract text from PDF
│ (if needed)           │    OCR if scanned/image-based
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Extract Metadata      │ ── Title, citation, date, court, ponente,
│                       │    document type, jurisdiction
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Classify Document     │ ── case, statute, rule, issuance, etc.
│ Type                  │
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Section Segmentation  │ ── Split into legal_document_sections
│                       │    (headnote, facts, issue, ruling, etc.)
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Generate Embeddings   │ ── Section-level and document-level vectors
│ (Embedding Service)   │
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Index in OpenSearch   │ ── Keyword index + kNN vector index
└──────┬───────────────┘
       ▼
┌──────────────────────────────────┐
│ Post-Ingestion Chain (parallel)  │
│ ├── Extract Doctrines            │ ── doctrine_tasks.py
│ ├── Resolve Citations            │ ── citation_tasks.py
│ └── Generate DFIR+ Digest        │ ── digest_tasks.py (auto)
│     (summary, facts, petitioner/ │    via POST /digests/generate
│      respondent args, issues,    │    non-blocking, fire-and-forget
│      ruling, doctrine, disposit.)│
└──────┬───────────────────────────┘
       ▼
┌──────────────────────────────────┐
│ Truthfulness Validator            │
│                                   │
│ Auto-publish if ALL:              │
│ • Official source (trust: high)  │
│ • Complete document              │
│ • High OCR/text integrity        │
│ • Metadata confidence > threshold│
│ • Citation mapping complete      │
│ • No conflict flags              │
│                                   │
│ Human review if:                 │
│ • Uncertain confidence           │
│ • Partial document               │
│ • Edge-case classification       │
│                                   │
│ Quarantine if:                   │
│ • Conflicting sources            │
│ • Incomplete holding             │
│ • Low-quality OCR                │
│ • Unclear publication status     │
└──────┬───────────────────────────┘
       ▼
┌──────────────────────┐
│ Publish or Queue      │ ── Set legal_documents.status = 'published'
│ for Review            │    or digests.review_status = 'needs_human_review'
└──────────────────────┘
```

---

## 9. Monorepo Folder Structure

```
/libertasian
├── apps/
│   ├── web/                          # Next.js web application
│   │   ├── src/
│   │   │   ├── app/                  # App Router pages
│   │   │   │   ├── (auth)/           # Auth routes (login, register, reset)
│   │   │   │   ├── (dashboard)/      # Authenticated dashboard layout
│   │   │   │   │   ├── search/       # Legal search page
│   │   │   │   │   ├── reader/       # Document reader
│   │   │   │   │   ├── digests/      # Digest library & viewer
│   │   │   │   │   ├── workspace/    # Matters, notes, uploads
│   │   │   │   │   ├── study/        # Codal reader, reviewers, flashcards
│   │   │   │   │   ├── scan/         # Camera scan results (web view)
│   │   │   │   │   ├── settings/     # Account, org, billing
│   │   │   │   │   └── admin/        # Editorial console (admin only)
│   │   │   │   └── (public)/         # Public pages (landing, pricing, docs)
│   │   │   ├── components/           # Shared UI components
│   │   │   │   ├── ui/               # shadcn/ui primitives
│   │   │   │   ├── search/           # Search bar, results, filters
│   │   │   │   ├── reader/           # Document viewer, section nav
│   │   │   │   ├── digest/           # Digest card, viewer, editor
│   │   │   │   └── layout/           # Shell, sidebar, header, footer
│   │   │   ├── features/             # Feature-specific logic
│   │   │   │   ├── auth/
│   │   │   │   ├── search/
│   │   │   │   ├── reader/
│   │   │   │   ├── workspace/
│   │   │   │   ├── digests/
│   │   │   │   ├── study/
│   │   │   │   ├── admin/
│   │   │   │   └── billing/
│   │   │   ├── lib/                  # Utilities, API client, constants
│   │   │   ├── hooks/                # Custom React hooks
│   │   │   ├── stores/               # Zustand stores
│   │   │   └── styles/               # Global styles, Tailwind config
│   │   ├── public/
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── mobile/                       # React Native + Expo application
│   │   ├── src/
│   │   │   ├── app/                  # Expo Router file-based routing
│   │   │   │   ├── (auth)/
│   │   │   │   ├── (tabs)/
│   │   │   │   │   ├── search/
│   │   │   │   │   ├── reader/
│   │   │   │   │   ├── digests/
│   │   │   │   │   ├── study/
│   │   │   │   │   ├── workspace/
│   │   │   │   │   └── scan/         # Camera scan feature
│   │   │   │   └── settings/
│   │   │   ├── components/
│   │   │   │   ├── camera/           # Scan UI, edge detection overlay
│   │   │   │   ├── reader/           # Offline-capable document viewer
│   │   │   │   ├── digest/
│   │   │   │   └── common/
│   │   │   ├── features/
│   │   │   │   ├── auth/
│   │   │   │   ├── search/
│   │   │   │   ├── reader/
│   │   │   │   ├── digests/
│   │   │   │   ├── workspace/
│   │   │   │   ├── camera-scan/      # Scan capture + processing logic
│   │   │   │   └── offline/          # Sync manager, offline cache
│   │   │   ├── lib/
│   │   │   ├── hooks/
│   │   │   ├── storage/              # MMKV + SQLite managers
│   │   │   └── theme/
│   │   ├── app.json
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── api/                          # NestJS backend application
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── modules/
│       │   │   ├── auth/             # JWT, OAuth, guards, strategies
│       │   │   ├── users/
│       │   │   ├── organizations/
│       │   │   ├── subscriptions/    # Billing, entitlements, quotas
│       │   │   ├── documents/        # Legal document CRUD, reader API
│       │   │   ├── search/           # Search orchestration, OpenSearch client
│       │   │   ├── digests/          # Digest CRUD, generation triggers
│       │   │   ├── workspace/        # Matters, notes, bookmarks, annotations
│       │   │   ├── uploads/          # File upload handling
│       │   │   ├── camera-capture/   # Camera scan intake, job triggers
│       │   │   ├── admin/            # Editorial console, source management
│       │   │   ├── audit/            # Audit log service
│       │   │   └── notifications/    # Email, push notification triggers
│       │   ├── common/
│       │   │   ├── guards/           # JwtAuthGuard, RolesGuard, SubscriptionGuard
│       │   │   ├── interceptors/     # Logging, transform, timeout
│       │   │   ├── decorators/       # @Roles, @CurrentUser, @Subscription
│       │   │   ├── dto/              # Shared DTOs
│       │   │   ├── errors/           # Custom exception filters
│       │   │   ├── events/           # Domain event definitions
│       │   │   └── pipes/            # Validation pipes
│       │   └── config/               # Environment config, module registration
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       ├── test/
│       ├── tsconfig.json
│       └── package.json
│
├── services/                         # Python AI/ML microservices
│   ├── ingestion-service/
│   │   ├── src/
│   │   │   ├── fetchers/
│   │   │   │   ├── supreme_court.py
│   │   │   │   ├── lawphil.py
│   │   │   │   ├── official_gazette.py
│   │   │   │   └── agencies/
│   │   │   ├── parsers/
│   │   │   ├── normalizers/
│   │   │   ├── dedupe/
│   │   │   └── publish/
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   │
│   ├── ocr-service/
│   │   ├── src/
│   │   │   ├── pipelines/
│   │   │   ├── image_preprocess/
│   │   │   ├── layout/
│   │   │   ├── ocr/
│   │   │   └── postprocess/
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   │
│   ├── rag-service/
│   │   ├── src/
│   │   │   ├── intent/               # Query intent classifier
│   │   │   ├── retrieval/            # Hybrid retrieval orchestrator
│   │   │   ├── rerank/               # Reranker model client
│   │   │   ├── context_builder/      # Context packing + citation anchoring
│   │   │   ├── generation/           # LLM generation + prompt management
│   │   │   ├── validators/           # Output validation + citation check
│   │   │   └── abstention/           # Abstention logic
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   │
│   ├── embedding-service/
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   │
│   └── worker-service/               # Celery workers
│       ├── src/
│       │   ├── tasks/
│       │   │   ├── ocr_tasks.py
│       │   │   ├── digest_tasks.py
│       │   │   ├── embedding_tasks.py
│       │   │   ├── ingestion_tasks.py
│       │   │   └── indexing_tasks.py
│       │   └── celery_app.py
│       ├── Dockerfile
│       └── requirements.txt
│
├── packages/                         # Shared monorepo packages
│   ├── ui/                           # Shared component library (if needed)
│   ├── types/                        # Shared TypeScript types/interfaces
│   ├── config/                       # Shared configuration
│   ├── eslint-config/
│   ├── tsconfig/
│   ├── shared-utils/                 # Common utility functions
│   ├── prompt-templates/             # LLM prompt templates (versioned)
│   └── legal-schema/                 # Legal citation patterns, constants
│
├── infrastructure/
│   ├── docker/
│   │   ├── docker-compose.yml        # Local development
│   │   ├── docker-compose.prod.yml   # Production (VPS Phase 1)
│   │   ├── docker-compose.staging.yml
│   │   ├── Dockerfile.api
│   │   ├── Dockerfile.web
│   │   ├── Dockerfile.rag
│   │   ├── Dockerfile.ocr
│   │   ├── Dockerfile.worker
│   │   └── Dockerfile.vllm
│   ├── k8s/                          # Kubernetes manifests (Phase 5+)
│   ├── terraform/                    # Infrastructure as code
│   ├── github-actions/               # CI/CD workflows
│   │   ├── ci.yml
│   │   ├── deploy-staging.yml
│   │   ├── deploy-production.yml
│   │   └── security-scan.yml
│   ├── monitoring/                   # Prometheus, Grafana configs
│   └── nginx/                        # Reverse proxy configs
│
├── docs/
│   ├── architecture/
│   ├── db/
│   ├── api/                          # OpenAPI specs
│   ├── runbooks/
│   ├── prompt-policy/                # LLM prompting guidelines
│   └── editorial-policy/             # Content review policies
│
├── turbo.json                        # Turborepo config
├── package.json                      # Root package.json
├── pnpm-workspace.yaml
├── .env.example
├── CLAUDE.md                         # Coding agent guide
└── README.md
```

---

## 10. Infrastructure & Deployment

### 10.1 VPS-Friendly Phase 1

For initial deployment on commodity VPS infrastructure:

```
Server 1: App Server (4–8 vCPUs, 16–32 GB RAM)
├── Next.js web app (Docker)
├── NestJS API (Docker)
├── Nginx reverse proxy
└── Redis

Server 2: Database Server (4–8 vCPUs, 32 GB RAM, SSD)
├── PostgreSQL 16 + pgvector
└── Scheduled backups

Server 3: Search Server (4–8 vCPUs, 32 GB RAM, SSD)
└── OpenSearch 2.x (single-node)

Server 4: Worker/AI Node (8 vCPUs, 32–64 GB RAM)
├── Python workers (OCR, embedding, ingestion)
├── RAG service (FastAPI)
├── Celery workers
└── MinIO (object storage)

Server 5: GPU Node (when available, dedicated or cloud spot)
└── vLLM server (GPU inference)
    ├── Instruct model
    ├── Embedding model
    └── Reranker model
```

**Note:** GPU inference can start with API-based models (OpenAI, Anthropic, Together.ai) during Phase 1, transitioning to self-hosted vLLM when GPU infrastructure is available.

### 10.2 Production Deployment (Scale-Out)

```
                         Internet
                            │
                      ┌─────▼──────┐
                      │ Cloudflare  │  CDN + WAF + DDoS protection
                      │ / WAF       │
                      └─────┬──────┘
                            │
                      ┌─────▼──────┐
                      │   Nginx    │  Load balancer + SSL termination
                      │   (LB)    │
                      └─────┬──────┘
                            │
              ┌─────────────┼──────────────┐
              │             │              │
        ┌─────▼─────┐ ┌────▼─────┐ ┌──────▼──────┐
        │ Next.js   │ │ NestJS   │ │ NestJS      │
        │ Web (x2)  │ │ API (x2) │ │ API (x2)    │
        └───────────┘ └──────────┘ └─────────────┘
                            │
              ┌─────────────┼──────────────┐
              │             │              │
        ┌─────▼─────┐ ┌────▼─────┐ ┌──────▼──────┐
        │ PostgreSQL│ │  Redis   │ │ MinIO / S3  │
        │ Primary + │ │ Cluster  │ │ (Object     │
        │ Replica   │ │          │ │  Storage)   │
        └───────────┘ └──────────┘ └─────────────┘
                            │
                    Internal Service Mesh
                            │
        ┌──────────┬────────┼────────┬──────────┐
        │          │        │        │          │
   ┌────▼───┐ ┌───▼───┐ ┌──▼───┐ ┌──▼────┐ ┌──▼────┐
   │Ingestion│ │ OCR  │ │ RAG  │ │Embed. │ │ vLLM  │
   │Service │ │Service│ │Svc.  │ │Service│ │Server │
   └────────┘ └───────┘ └──────┘ └───────┘ └───────┘
                            │
                ┌───────────▼───────────┐
                │ OpenSearch Cluster    │
                │ (3-node minimum)      │
                └───────────────────────┘
```

### 10.3 Docker Compose (Development)

```yaml
# docker-compose.yml (simplified)
version: '3.9'
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']
    environment:
      POSTGRES_DB: libertasian
      POSTGRES_USER: libertasian
      POSTGRES_PASSWORD: ${DB_PASSWORD}

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']

  opensearch:
    image: opensearchproject/opensearch:2.17.0
    ports: ['9200:9200']
    environment:
      - discovery.type=single-node
      - plugins.security.disabled=true
    volumes: ['osdata:/usr/share/opensearch/data']

  minio:
    image: minio/minio:latest
    ports: ['9000:9000', '9001:9001']
    command: server /data --console-address ":9001"
    volumes: ['miniodata:/data']

  api:
    build: { context: ., dockerfile: infrastructure/docker/Dockerfile.api }
    ports: ['3001:3001']
    depends_on: [postgres, redis, opensearch]
    env_file: .env

  web:
    build: { context: ., dockerfile: infrastructure/docker/Dockerfile.web }
    ports: ['3000:3000']
    depends_on: [api]
    env_file: .env

  rag-service:
    build: { context: ., dockerfile: infrastructure/docker/Dockerfile.rag }
    ports: ['8000:8000']
    depends_on: [opensearch, redis]
    env_file: .env

  worker:
    build: { context: ., dockerfile: infrastructure/docker/Dockerfile.worker }
    depends_on: [redis, postgres, minio]
    env_file: .env

volumes:
  pgdata:
  osdata:
  miniodata:
```

---

## 11. Security Architecture

### 11.1 Authentication & Authorization

- JWT access tokens (RS256, 15-min TTL) + refresh tokens (7-day, rotated, stored in DB for revocation)
- CSRF protection via SameSite cookies + double-submit pattern
- Rate limiting: sliding window per user (Redis), per IP for unauthenticated routes
- RBAC enforced at NestJS guard level with @Roles() decorator
- Subscription entitlements checked at API gateway via @Subscription('pro') guard
- Multi-tenancy: every database query scoped to organization_id via Prisma middleware

### 11.2 Data Security

- TLS 1.3 enforced for all external connections
- Database connections over TLS with certificate verification
- Object storage encryption at rest (MinIO server-side encryption)
- User uploads encrypted at rest in object storage
- PII fields (email, phone, full_name) encrypted at application level with AES-256-GCM
- Database backups encrypted and stored in separate location

### 11.3 Upload Security

- File type validation via magic byte detection (not just extension)
- Image processing via Sharp with `limitInputPixels` to prevent decompression bombs
- ClamAV scanning for all uploaded files
- Maximum file size enforced at Nginx (50MB) and application level
- Upload filenames sanitized (strip path traversal, special characters)

### 11.4 API Security

- Input validation on all endpoints (class-validator + Zod)
- SQL injection prevention via Prisma parameterized queries
- XSS prevention via output encoding and CSP headers
- CORS configured for allowed origins only
- API key authentication for service-to-service communication
- Request/response logging for audit (PII redacted)

### 11.5 LLM Security

- Prompt injection mitigation: user input sandboxed in clearly delimited sections of prompt templates
- Output validation: all LLM outputs pass through citation verification and unsupported claim detection before reaching the user
- Model version pinning: every generation records model name, version, and prompt template version
- No user data used for model training (private-by-default policy)

---

## 12. API Design Conventions

### 12.1 REST API Structure

```
Base URL: /api/v1

Authentication:
  POST   /api/v1/auth/register
  POST   /api/v1/auth/login
  POST   /api/v1/auth/refresh
  POST   /api/v1/auth/logout
  POST   /api/v1/auth/forgot-password
  POST   /api/v1/auth/reset-password

Users:
  GET    /api/v1/users/me
  PATCH  /api/v1/users/me
  GET    /api/v1/users/me/sessions

Organizations:
  POST   /api/v1/organizations
  GET    /api/v1/organizations/:orgId
  PATCH  /api/v1/organizations/:orgId
  GET    /api/v1/organizations/:orgId/members
  POST   /api/v1/organizations/:orgId/members/invite

Search:
  POST   /api/v1/search                    # Natural language search
  GET    /api/v1/search/citation/:citation  # Exact citation lookup
  GET    /api/v1/search/suggestions         # Autocomplete

Documents:
  GET    /api/v1/documents/:id
  GET    /api/v1/documents/:id/sections
  GET    /api/v1/documents/:id/sections/:sectionId
  GET    /api/v1/documents/:id/citations
  GET    /api/v1/documents/:id/related

Digests:
  GET    /api/v1/digests
  POST   /api/v1/digests/generate           # Trigger digest generation
  GET    /api/v1/digests/:id
  PATCH  /api/v1/digests/:id
  DELETE /api/v1/digests/:id

AI Answers:
  POST   /api/v1/ai/answer                  # Grounded AI answer
  POST   /api/v1/ai/memo                    # Memo drafting
  POST   /api/v1/ai/compare                 # Case comparison

Workspace:
  POST   /api/v1/matters
  GET    /api/v1/matters
  GET    /api/v1/matters/:id
  PATCH  /api/v1/matters/:id
  POST   /api/v1/matters/:id/documents
  POST   /api/v1/notes
  GET    /api/v1/notes
  POST   /api/v1/bookmarks
  GET    /api/v1/bookmarks
  POST   /api/v1/annotations
  GET    /api/v1/annotations

Uploads:
  POST   /api/v1/uploads                    # File upload
  POST   /api/v1/uploads/camera-scan        # Camera scan upload
  GET    /api/v1/uploads/:id
  GET    /api/v1/uploads/:id/status

Study:
  GET    /api/v1/study/codals               # Codal index by subject
  GET    /api/v1/study/codals/:subject
  GET    /api/v1/study/reviewers
  GET    /api/v1/study/flashcards
  POST   /api/v1/study/flashcards/generate

Admin (Editorial):
  GET    /api/v1/admin/sources
  POST   /api/v1/admin/sources
  PATCH  /api/v1/admin/sources/:id
  POST   /api/v1/admin/sources/:id/fetch    # Trigger manual fetch
  GET    /api/v1/admin/ingestion-jobs
  GET    /api/v1/admin/review-queue
  POST   /api/v1/admin/review-queue/:id/approve
  POST   /api/v1/admin/review-queue/:id/reject
  GET    /api/v1/admin/editorial-flags
  GET    /api/v1/admin/corpus-health

Billing:
  GET    /api/v1/billing/subscription
  POST   /api/v1/billing/subscribe
  POST   /api/v1/billing/cancel
  GET    /api/v1/billing/usage
```

### 12.2 Response Format

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_SUBSCRIPTION",
    "message": "This feature requires a Pro subscription.",
    "details": {}
  }
}
```

---

## 13. Data Flow Diagrams

### 13.1 Search & AI Answer Flow

```
User types query in search bar
    │
    ▼
Web/Mobile sends POST /api/v1/ai/answer { query, filters, mode }
    │
    ▼
NestJS API → validates auth + subscription → forwards to RAG Service
    │
    ▼
RAG Service (FastAPI):
    1. Classify intent
    2. Rewrite/expand query
    3. Call OpenSearch (BM25 + kNN hybrid)
    4. Merge candidates (RRF)
    5. Rerank (cross-encoder)
    6. Pack context (top-k passages + metadata + citation anchors)
    7. Generate answer (vLLM with citation-enforcing prompt)
    8. Validate output (citation check + unsupported claim check)
    9. Record model_run + provenance_records
    │
    ▼
NestJS API receives response → records audit_log → returns to client
    │
    ▼
Client renders:
    • AI answer with inline citation links
    • Source passages panel (expandable)
    • Confidence indicator
    • Related authorities
```

### 13.2 Camera Scan Flow

```
User taps "Scan" in mobile app
    │
    ▼
On-device: camera → edge detect → crop → deskew → enhance → compress
    │
    ▼
Upload POST /api/v1/uploads/camera-scan (multipart, images + metadata)
    │
    ▼
NestJS API:
    1. Validate auth + subscription entitlement
    2. Store images in MinIO
    3. Create user_uploads + camera_captures records
    4. Enqueue BullMQ job chain: quality_score → ocr → classify → digest
    │
    ▼
Python Workers (Celery):
    1. Quality score (blur, resolution, contrast)
    2. OCR (Tesseract / PaddleOCR)
    3. Layout analysis → section extraction
    4. Legal document classification
    5. Citation extraction
    6. IF entitled: AI digest generation (vLLM)
    7. Store results in PostgreSQL
    │
    ▼
NestJS notifies client (WebSocket or polling):
    • OCR text preview
    • Document classification result
    • Generated digest (if entitled)
    │
    ▼
Client displays digest on dashboard with link to original scan
```

---

## 14. Performance & Scalability

### 14.1 Performance Targets

| Metric | Target |
|---|---|
| Search query response time (P95) | < 500ms |
| AI answer generation (P95) | < 8 seconds |
| Digest generation (P95) | < 15 seconds |
| Camera scan → OCR → digest (P95) | < 30 seconds |
| Document reader page load (P95) | < 1 second |
| API response time (non-AI, P95) | < 200ms |

### 14.2 Scalability Strategy

- **Horizontal scaling:** NestJS API and Next.js web behind Nginx load balancer
- **Read replicas:** PostgreSQL read replica for search-heavy read queries
- **Caching:** Redis for frequently accessed documents, user sessions, rate limits, search result caching (short TTL)
- **Queue-based processing:** All AI/ML workloads are asynchronous via BullMQ/Celery, decoupling user requests from heavy processing
- **OpenSearch scaling:** Start single-node, scale to 3-node cluster when corpus exceeds 200K documents
- **Vector index:** pgvector initially (co-located with PostgreSQL), migrate to Qdrant when vector query volume or corpus size demands dedicated infra

### 14.3 Offline Mobile Strategy

- Codal texts cached in SQLite (structured) for offline browsing
- Recently viewed digests cached in MMKV (fast reads)
- Offline queue for bookmarks, annotations (sync on reconnect)
- Background sync manager reconciles local changes with server
- Cache invalidation via ETag/Last-Modified headers

---

## 15. Monitoring & Observability

### 15.1 Stack

```
Metrics:          Prometheus + Node.js/Python exporters
Visualization:    Grafana dashboards
Logging:          Structured JSON logs → Loki or ELK
Tracing:          OpenTelemetry → Jaeger (optional Phase 3+)
Alerting:         Grafana Alerting → Slack/Email
Uptime:           UptimeRobot or BetterStack (external)
Error Tracking:   Sentry (web + mobile + API)
```

### 15.2 Key Dashboards

- **System Health:** CPU, memory, disk, network per service
- **API Performance:** Request rate, latency percentiles, error rate
- **Search Quality:** Query volume, result click-through rate, zero-result rate
- **AI Pipeline:** Generation latency, token usage, abstention rate, confidence distribution
- **Ingestion Pipeline:** Fetch success rate, documents processed/day, OCR quality scores, review queue depth
- **Business Metrics:** DAU/MAU, subscription conversions, churn, feature usage heatmap

### 15.3 Alerts

- API error rate > 5% for 5 minutes
- AI service response time > 15 seconds P95
- Database connection pool exhaustion
- OpenSearch cluster health RED
- Ingestion pipeline failure rate > 10%
- Redis memory usage > 80%
- Disk usage > 85% on any server
- Certificate expiry within 14 days

---

## 16. Implementation Sequence

The recommended build order, aligned with the PRD roadmap:

### Sprint 0 (Weeks 1–2): Foundation

1. Monorepo setup (Turborepo + pnpm workspaces)
2. Docker Compose for local development (PostgreSQL + Redis + OpenSearch + MinIO)
3. NestJS project scaffold with module structure
4. Prisma schema (core identity + legal corpus tables)
5. Database migrations
6. CI/CD pipeline (GitHub Actions: lint, test, build, deploy-staging)
7. Next.js project scaffold with shadcn/ui
8. React Native + Expo project scaffold

### Phase 1 (Months 1–4): Research MVP

1. Auth module (email/password, JWT, RBAC)
2. Organization + subscription models
3. Legal document ingestion from SC E-Library + Lawphil
4. OpenSearch index creation + indexing pipeline
5. Search module (exact + hybrid search)
6. Document reader API + UI
7. RAG service (Python/FastAPI) — intent classification, retrieval, generation
8. vLLM deployment (or API-based models as interim)
9. Embedding service + pgvector indexing
10. Grounded AI answer endpoint
11. Case digest generation pipeline
12. Bookmark + saved digest features
13. Admin editorial queue (basic approve/reject)
14. Billing integration (Xendit)
15. Web app: search, reader, digest viewer, bookmarks
16. Mobile app: read-only companion (search + reader)
17. Production deployment on VPS

### Phase 2 (Months 5–7): Study Mode

18. Codal reader data model + ingestion
19. Bar subject categorization tagging
20. Study dashboard UI (web + mobile)
21. Reviewer packs + digest library
22. Flashcard generation + review UI
23. Offline mobile reading (SQLite cache + sync)
24. Edu plan launch

### Phase 3 (Months 8–10): Mobile Scan

25. Camera scan UI (React Native)
26. On-device image processing pipeline
27. Server-side OCR service (Python)
28. Legal document classifier
29. Scan-to-digest pipeline with entitlement gates
30. Dashboard save + matter attachment
31. Privacy controls + editorial candidate flagging

### Phase 4–6: As defined in PRD roadmap

---

## 17. Coding Standards & Agent Guide

### 17.1 TypeScript (NestJS + Next.js)

- Strict mode enabled (`strict: true` in tsconfig)
- No `any` types — use `unknown` with type guards
- All API inputs validated with class-validator (NestJS) or Zod (Next.js)
- All database queries via Prisma — no raw SQL except for pgvector-specific operations
- Error handling: custom exception filters in NestJS, proper HTTP status codes
- Environment variables validated at startup (via @nestjs/config + Joi schema)

### 17.2 Python (FastAPI + Workers)

- Type hints required on all functions
- Pydantic models for all request/response schemas
- Async/await for all I/O-bound operations
- Structured logging (JSON format)
- pytest with >80% coverage for critical paths
- Dependencies managed via pyproject.toml + uv

### 17.3 Git Conventions

- Branch naming: `feature/PHASE-N-short-description`, `fix/bug-description`, `chore/task-description`
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- PRs require: passing CI, code review, no merge conflicts
- Main branch is protected — deploy via tagged releases

### 17.4 Security Checklist (Every PR)

- [ ] No secrets or API keys in code
- [ ] Input validation on all new endpoints
- [ ] Authorization checks (RBAC + tenant scoping)
- [ ] Subscription entitlement checks for gated features
- [ ] File upload validation (magic bytes, size limit, ClamAV)
- [ ] Image processing with Sharp `limitInputPixels`
- [ ] Audit log entries for state-changing operations
- [ ] PII not logged in application logs
- [ ] SQL injection prevention (parameterized queries only)
- [ ] XSS prevention (output encoding, CSP headers)

---

*End of PDD — LIBERTASIAN v1.0*

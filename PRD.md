# LIBERTASIAN — Product Requirements Document (PRD)

**Version:** 1.0
**Date:** March 18, 2026
**Author:** Brick (Product & Technical Lead)
**Status:** Draft
**Classification:** Internal — Confidential

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Vision & Mission](#2-vision--mission)
3. [Competitive Landscape & Differentiation](#3-competitive-landscape--differentiation)
4. [Target Users & Personas](#4-target-users--personas)
5. [Product Modules](#5-product-modules)
6. [Feature Requirements](#6-feature-requirements)
7. [Mobile Camera Scan Feature](#7-mobile-camera-scan-feature)
8. [Admin Source Ingestion Feature](#8-admin-source-ingestion-feature)
9. [RAG Pipeline Requirements](#9-rag-pipeline-requirements)
10. [Safety, Truthfulness & Provenance Policy](#10-safety-truthfulness--provenance-policy)
11. [Subscription Plans & Monetization](#11-subscription-plans--monetization)
12. [Phased Roadmap](#12-phased-roadmap)
13. [Success Metrics & KPIs](#13-success-metrics--kpis)
14. [Compliance & Legal Considerations](#14-compliance--legal-considerations)
15. [Risks & Mitigations](#15-risks--mitigations)
16. [Open Questions & Future Exploration](#16-open-questions--future-exploration)

---

## 1. Executive Summary

LIBERTASIAN is a Philippine legal AI platform that unifies the strongest capabilities of four existing market players — Anycase.ai, Digest PH, JurisChat, and eCodal+ — into a single, cohesive web and mobile product. The platform combines AI-powered legal research, case digest generation, codal reading, mobile camera scanning with OCR, and an editorial ingestion pipeline sourcing from official Philippine government legal repositories.

The name "LIBERTASIAN" (from Latin *libertas*, meaning freedom, combined with "Asian") reflects the platform's purpose: democratizing access to Philippine legal knowledge for students, solo practitioners, small firms, and editorial teams.

LIBERTASIAN distinguishes itself by offering features that no single competitor currently provides together: a mobile camera-scan-to-digest pipeline for paying users, a curated editorial ingestion system sourcing from the Supreme Court E-Library and Lawphil, a practice workspace for small firms with matter management, and a study/review mode purpose-built for bar examinees — all underpinned by strict truthfulness controls, citation provenance, and a private-by-default data philosophy.

---

## 2. Vision & Mission

**Vision:** Every Filipino legal professional — from first-year law student to senior partner — has instant, AI-assisted access to accurate, verifiable, and affordable Philippine legal knowledge on any device.

**Mission:** Build the most comprehensive, trustworthy, and accessible AI-powered legal research and practice platform for the Philippine legal ecosystem, combining authoritative source ingestion, grounded AI answers, mobile-first utility, and collaborative practice tools.

**Guiding Principles:**

- Authoritative sources first — official government publications take precedence over all other sources.
- Truthfulness over speed — no auto-published content without confidence thresholds and provenance.
- Private by default — user-captured content never enters the public corpus without explicit permission and rights review.
- Citation-grounded AI — every AI-generated claim must link to a verifiable source passage.
- Abstention over fabrication — the system must refuse to answer definitively when support is insufficient, rather than hallucinate.

---

## 3. Competitive Landscape & Differentiation

### 3.1 Competitor Analysis

**Anycase.ai** is the current market leader in Philippine legal AI, trusted by 4,000+ legal professionals. It maintains a proprietary legal database of 90,000+ legal resources (laws, jurisprudence, government issuances) updated daily from the Supreme Court E-Library and government websites. Anycase uses a custom RAG system purpose-built for Philippine law, achieving 0% fabricated citations and 87.5% immediately usable answers (per their 2024 Bar Exam benchmark with Anycase 2.0). The platform offers semantic search, AI-generated summaries, and an Edu Mode using the ALAC method (Answer, Law, Application, Conclusion). The Supreme Court itself has conducted a proof-of-concept feasibility study with Anycase. Pricing ranges from ₱599/month (Edu) to ₱999/month (Pro).

**Digest PH** focuses on AI-generated case summaries and an AI chatbot (Digest AI, officially released February 2025) that covers Philippine Supreme Court cases from 1901 to present plus thousands of laws. The platform offers multiple answer modes (concise, free-form, bar exam), legal memo drafting assistance, and categorization/tagging of legal cases. It provides automated citation generation and real-time tracking of case developments. Digest PH targets both lawyers and law students, with pricing starting at ₱199/month, making it the most affordable entry point.

**JurisChat** positions itself as an "AI Legal Copilot" with 120,000+ Philippine legal documents. Its key differentiator is a conversational workspace approach — users can chat directly with legal documents, ask questions about citations, and get inline clarifications without losing context. JurisChat V2 introduced team collaboration, an AI knowledge base, and agentic workflows. It offers document upload and multi-format analysis (PDFs, images, jurisprudence) and AI-powered drafting tools. Plans range from free (limited) to Lite, Plus, and Pro tiers with a 7-day trial.

**eCodal+** is a codal compilation platform created by a law student (now lawyer) in 2018. It organizes Philippine codals by bar subject area (Civil, Commercial, Criminal, Labor, Political, Public International, Remedial, Taxation, and Legal/Judicial Ethics). The Pro subscription (₱3,600–₱6,000 for bar cycle) includes downloadable PDFs, bar-syllabus-based compact reviewers, Supreme Court cases, legal forms, a lexicon, and a legal library. eCodal+ is mobile-friendly with offline access, filling a niche for structured, browsable legal texts that AI-first platforms lack.

### 3.2 LIBERTASIAN Differentiation Matrix

| Capability | Anycase | Digest PH | JurisChat | eCodal+ | LIBERTASIAN |
|---|---|---|---|---|---|
| AI legal research & answers | ✅ | ✅ | ✅ | ✗ | ✅ |
| Case digest generation | ✅ | ✅ | ✅ | ✗ | ✅ |
| Codal reader (structured, by subject) | ✗ | ✗ | ✗ | ✅ | ✅ |
| Mobile camera scan → OCR → digest | ✗ | ✗ | ✗ | ✗ | ✅ |
| Offline mobile reading | ✗ | Partial | ✗ | ✅ | ✅ |
| Practice workspace (matters, tasks) | ✗ | ✗ | ✗ | ✗ | ✅ |
| Team/firm collaboration | ✗ | ✗ | ✅ (V2) | ✗ | ✅ |
| Editorial ingestion from official sources | ✅ | ✅ | ✅ | Manual | ✅ |
| Bar review / study mode | Edu mode | Bar exam mode | ✗ | ✅ (reviewers) | ✅ |
| Flashcards | ✗ | ✗ | ✗ | ✗ | ✅ |
| Multi-format doc analysis (upload) | ✗ | ✗ | ✅ | ✗ | ✅ |
| Truthfulness review queue | Internal | Internal | Internal | N/A | ✅ (explicit) |
| Doctrine extraction & graph | ✗ | ✗ | ✗ | ✗ | ✅ (Phase 5+) |

### 3.3 Core Differentiators

1. **All-in-one platform** — No existing competitor combines AI research, codal reading, study tools, camera scanning, and practice management in a single product.
2. **Camera-to-digest pipeline** — No competitor offers mobile camera scanning of physical legal materials with OCR, automatic classification, and AI digest generation.
3. **Private-by-default philosophy** — Explicit separation between user-private captures and editorial corpus with rights screening, which competitors do not document publicly.
4. **Practice workspace** — Matter management, document repository, annotations, tasks, calendar, and team collaboration — features absent from all four competitors.
5. **Structured codal experience with AI** — Merges eCodal+'s bar-syllabus-organized codal reading with AI-powered search and study tools.
6. **Transparent truthfulness controls** — Publicly documented confidence thresholds, auto-publish rules, and human review workflows.

---

## 4. Target Users & Personas

### 4.1 Primary Personas

**Maria — Bar Examinee / Law Student**
- Age: 22–28, enrolled in or recently graduated from law school
- Needs: affordable access to codals, case digests, reviewer packs, flashcards, offline mobile reading
- Pain points: fragmented resources across multiple platforms/apps, expensive review materials, no mobile-friendly study workflow
- LIBERTASIAN value: unified study mode with codals + digests + flashcards + offline reading, Edu pricing tier

**Atty. Carlos — Solo Practitioner**
- Age: 30–45, handling 15–30 active cases across practice areas
- Needs: fast legal research, citation-backed answers, case comparison, memo drafting, matter organization
- Pain points: spending hours on manual research via Google/Lawphil/ChanRobles, no centralized case management tool
- LIBERTASIAN value: AI search + workspace + camera scan of printed decisions for personal reference

**Atty. Reyes — Small Firm Managing Partner**
- Age: 40–55, managing a 5–15 person firm
- Needs: team research platform, shared knowledge base, document management, audit trails, task delegation
- Pain points: no integrated legal tech stack, associates using different tools, no institutional knowledge capture
- LIBERTASIAN value: team workspace + shared digests + collaboration + audit logs + role-based access

**Elena — Editorial/Ingestion Admin**
- Age: 28–40, legal editor or data engineer maintaining the platform's legal corpus
- Needs: source management dashboard, duplicate detection, digest review queue, metadata correction, publishing controls
- Pain points: manual ingestion workflows, inconsistent data quality, no automated truthfulness checks
- LIBERTASIAN value: admin editorial console with automated ingestion, review queues, provenance tracking

### 4.2 Secondary Personas

- **Paralegal** — needs document organization, basic research assistance, task management under attorney supervision
- **Corporate in-house counsel** — needs quick regulatory/compliance lookups, contract clause research
- **Legal academic / professor** — needs curated case collections for course materials, student access management

---

## 5. Product Modules

### Module A: Legal Research

The core search and AI answer engine. Users enter natural language queries or exact citations and receive grounded, citation-linked results from the authoritative legal corpus.

**Capabilities:**
- Natural language legal search across all document types (cases, statutes, rules, issuances, memoranda, orders)
- Exact citation search (G.R. No., case title, statute reference)
- Hybrid retrieval combining keyword matching (BM25) and semantic similarity
- Grounded AI answers with inline source citations and confidence indicators
- Case digest generation from full-text decisions
- Doctrine extraction with linked authorities
- Case comparison (side-by-side analysis of two or more decisions)
- Memo drafting assistance with citation injection
- Source-linked reader (click any citation to view full text in context)
- Related authorities panel (showing doctrinally or topically related cases)
- Query history and saved searches

### Module B: Practice Workspace

A matter-centric workspace for solo practitioners and small firms to organize their legal work.

**Capabilities:**
- Organization/firm accounts with role-based access control (owner, admin, editor, member, reviewer)
- Matter/case folder creation with metadata (court, case type, status, parties)
- Document repository per matter (evidence, references, pleadings, research, notes)
- Notes with rich text editing, linked to matters or standalone
- Annotations and highlights on legal documents with color coding
- Bookmarks for quick reference to specific document sections
- Collaboration features (comments, shared access, activity feed)
- Tasks and deadlines with calendar integration
- Client-safe workspaces (controlled sharing without exposing full firm data)
- Immutable audit logs for all workspace actions

### Module C: Study / Review Mode

Purpose-built for law students and bar examinees, combining codal reading with AI-enhanced study tools.

**Capabilities:**
- Codal reader organized by bar subject area (Civil, Commercial, Criminal, Labor, Political, Public International, Remedial, Taxation, Legal/Judicial Ethics) — inspired by eCodal+'s organization
- Reviewer packs (curated collections of digests, provisions, and doctrine by topic)
- Subject collections aligned to bar syllabus
- Digest library (searchable, filterable collection of case digests)
- Syllabus mode (study path following bar exam topic structure)
- Flashcard mode (auto-generated from digests, provisions, or user-created)
- Offline mobile reading with local caching
- Answer modes (ALAC method, IRAC format, concise, free-form, bar-exam-style)
- Progress tracking and study analytics

### Module D: Ingestion / Editorial Console

The admin-facing system for managing the platform's authoritative legal corpus.

**Capabilities:**
- Official source crawler management (Supreme Court E-Library, Lawphil, Official Gazette, agency sites)
- Source registry with trust levels, fetch strategies, and scheduling
- Document review queue with status workflow (new → review → approved/rejected)
- OCR quality control scoring
- Auto-digest generation with confidence thresholds
- Digest approval workflow (draft → AI-generated → needs human review → approved/rejected)
- Metadata corrections editor
- Duplicate detection and merge tools
- Truthfulness flags and red-team review queue
- Source conflict comparison (when mirrored sources diverge)
- Published/unpublished toggles
- Corpus health monitoring and stale-source detection

### Module E: Mobile Capture & Scan

The camera-based document capture pipeline for paying users to digitize physical legal materials.

**Capabilities:**
- Camera scan of case printouts, codal pages, book pages, PDFs
- On-device crop, deskew, deblur, light enhancement
- Page ordering for multi-page captures
- OCR with quality scoring
- Legal document classification (case, statute, rule, issuance, etc.)
- AI digest generation from scanned text
- Save to personal dashboard with matter linkage
- Tag as private, shared within org, or editorial candidate
- Scan-to-flashcards conversion
- Scan-to-searchable-transcript mode

---

## 6. Feature Requirements

### 6.1 Authentication & Identity

| ID | Requirement | Priority |
|---|---|---|
| AUTH-01 | Email/password registration and login | P0 |
| AUTH-02 | Google OAuth login | P0 |
| AUTH-03 | Email verification | P0 |
| AUTH-04 | Password reset flow | P0 |
| AUTH-05 | Multi-factor authentication (MFA) | P1 |
| AUTH-06 | Device/session management (view active sessions, revoke) | P1 |
| AUTH-07 | Organization creation and membership management | P0 |
| AUTH-08 | Role-based access control (owner, admin, editor, member, reviewer, student) | P0 |
| AUTH-09 | Subscription entitlement enforcement at API gateway level | P0 |
| AUTH-10 | Invite-based onboarding for firm/team members | P1 |

### 6.2 Legal Search & AI Answers

| ID | Requirement | Priority |
|---|---|---|
| SRCH-01 | Natural language search across all legal document types | P0 |
| SRCH-02 | Exact citation search (G.R. No., RA No., statute reference) | P0 |
| SRCH-03 | Metadata-based filtering (court, date range, ponente, subject, document type) | P0 |
| SRCH-04 | Hybrid retrieval (BM25 keyword + semantic vector) | P0 |
| SRCH-05 | AI-generated grounded answer with inline citation links | P0 |
| SRCH-06 | Source passage display alongside AI answer | P0 |
| SRCH-07 | Confidence indicator on AI answers (high/medium/low) | P0 |
| SRCH-08 | Abstention response when support is insufficient | P0 |
| SRCH-09 | Related authorities panel | P1 |
| SRCH-10 | Search history and saved queries | P1 |
| SRCH-11 | AI answer modes (ALAC, IRAC, concise, free-form) | P1 |
| SRCH-12 | Multi-language query support (English and Filipino/Taglish) | P2 |

### 6.3 Case Digest Generation

| ID | Requirement | Priority |
|---|---|---|
| DIG-01 | Auto-generate structured case digest from full-text decision — DFIR+ gold standard format: summary, facts, petitioner's arguments, respondent's arguments, issues, ruling, doctrine, dispositive. Auto-generated during ingestion pipeline. | P0 |
| DIG-02 | Confidence score per digest | P0 |
| DIG-03 | Source section mapping (every digest sentence traced to source passage) | P0 |
| DIG-04 | Human review hook (flag for review if below confidence threshold) | P0 |
| DIG-05 | Digest versioning (preserve earlier drafts) | P1 |
| DIG-06 | Doctrine extraction as separate tagged entities | P1 |
| DIG-07 | Cited authorities extraction as structured links | P1 |
| DIG-08 | User-editable digest with change tracking | P2 |
| DIG-09 | Export digest as PDF or DOCX | P2 |

### 6.4 Practice Workspace

| ID | Requirement | Priority |
|---|---|---|
| WS-01 | Create, edit, archive matters with metadata | P0 (Phase 4) |
| WS-02 | Attach legal documents and uploads to matters | P0 (Phase 4) |
| WS-03 | Rich text notes linked to matters | P0 (Phase 4) |
| WS-04 | Bookmark legal documents and sections | P0 (Phase 1) |
| WS-05 | Annotations and highlights on legal documents | P1 (Phase 4) |
| WS-06 | Task creation with due dates and assignees | P1 (Phase 4) |
| WS-07 | Calendar view for deadlines | P2 (Phase 4) |
| WS-08 | Comments and collaboration on matters | P2 (Phase 4) |
| WS-09 | Audit log for all workspace actions | P1 (Phase 4) |
| WS-10 | Client-safe workspace sharing | P2 (Phase 4) |

### 6.5 Study / Review Mode

| ID | Requirement | Priority |
|---|---|---|
| STU-01 | Codal reader organized by bar subject area | P0 (Phase 2) |
| STU-02 | Reviewer packs (curated digest + provision collections) | P0 (Phase 2) |
| STU-03 | Digest library with search and filters | P0 (Phase 2) |
| STU-04 | Flashcard generation from digests and provisions | P1 (Phase 2) |
| STU-05 | Offline mobile reading with local cache | P0 (Phase 2) |
| STU-06 | Syllabus mode (bar topic study path) | P1 (Phase 2) |
| STU-07 | Progress tracking and study streak analytics | P2 (Phase 2) |
| STU-08 | Export study sets | P2 (Phase 2) |

### 6.6 Mobile Capture & Scan

| ID | Requirement | Priority |
|---|---|---|
| CAM-01 | Camera capture with page edge detection | P0 (Phase 3) |
| CAM-02 | Crop, deskew, deblur, light enhancement | P0 (Phase 3) |
| CAM-03 | Multi-page capture with page ordering | P0 (Phase 3) |
| CAM-04 | Server-side OCR with quality scoring | P0 (Phase 3) |
| CAM-05 | Legal document classification | P0 (Phase 3) |
| CAM-06 | AI digest generation from scan (paying users only) | P0 (Phase 3) |
| CAM-07 | Save scan + digest to dashboard | P0 (Phase 3) |
| CAM-08 | Link scan to matter | P1 (Phase 3) |
| CAM-09 | Tag as private/org-private/editorial-candidate | P0 (Phase 3) |
| CAM-10 | Scan-to-flashcards | P2 (Phase 3) |
| CAM-11 | Free users: OCR preview only, no saved AI digest (or limited monthly quota) | P0 (Phase 3) |
| CAM-12 | Local encryption before upload | P1 (Phase 3) |

### 6.7 Admin Ingestion & Editorial

| ID | Requirement | Priority |
|---|---|---|
| ING-01 | Source registry (Supreme Court E-Library, Lawphil, Official Gazette, agencies) | P0 |
| ING-02 | Scheduled crawl/fetch jobs per source endpoint | P0 |
| ING-03 | Document discovery with new/update/duplicate detection | P0 |
| ING-04 | Raw content fetch and normalization | P0 |
| ING-05 | OCR for scanned/image-based source documents | P0 |
| ING-06 | Metadata extraction (title, citation, date, court, ponente) | P0 |
| ING-07 | Document type classification | P0 |
| ING-08 | Draft digest auto-generation | P0 |
| ING-09 | Truthfulness validator (auto-publish / human review / quarantine) | P0 |
| ING-10 | Digest review queue with approve/reject/revise workflow | P0 |
| ING-11 | Metadata corrections editor | P1 |
| ING-12 | Source conflict comparison view | P1 |
| ING-13 | Document lineage and version viewer | P1 |
| ING-14 | Corpus health dashboard (coverage, staleness, quality metrics) | P2 |
| ING-15 | Duplicate merge tool | P2 |

---

## 7. Mobile Camera Scan Feature

### 7.1 User Flow — Paying User

1. User opens LIBERTASIAN mobile app
2. Taps "Scan Document" button
3. Captures one or more pages using phone camera
4. App performs on-device pre-processing: crop, deskew, deblur, light enhancement, page ordering
5. User selects output intent: "Private Digest," "Add to Matter," or "Save to Study Dashboard"
6. App uploads processed images to server (encrypted in transit, optionally pre-encrypted on device)
7. Server pipeline executes: quality scoring → OCR → layout analysis → legal document classification → citation extraction → digest generation
8. If recognized as legal material: structured digest is generated and saved to user's dashboard
9. Original scan images and OCR text remain linked to the digest for reference
10. User can view, edit, tag, or share digest within their organization

### 7.2 Entitlement Rules

- **Free users:** May scan and preview OCR text output, but cannot save AI-generated digests. A limited monthly quota (e.g., 3 scans/month) may be offered as a trial incentive.
- **Pro users:** Full access to scan → OCR → digest → save pipeline with unlimited scans.
- **Team/Firm users:** Can share scan-based digests across the team workspace with audit trails.
- **Enterprise/Editorial users:** Same as Team plus ability to flag editorial candidates for corpus review.

### 7.3 Privacy & Safety Rules

- All user camera scans are **private by default**.
- Scans are **not** added to the public/shared corpus.
- Scans are **not** used to train models.
- Scans can only be promoted to editorial review with **explicit user permission** and a **rights review** by an editor.
- Commercial book content detected by the classifier should be flagged and blocked from editorial promotion.

### 7.4 Output Types

From a single scan, a user may generate: case digest, codal summary, reviewer note, searchable OCR transcript, flashcards, or highlightable reading-mode text.

---

## 8. Admin Source Ingestion Feature

### 8.1 Source Registry

The platform maintains a managed registry of authoritative legal sources:

- **Supreme Court E-Library** — decisions, signed resolutions, laws, executive issuances
- **Lawphil** — Philippine laws, jurisprudence, executive orders, administrative orders
- **Official Gazette** — presidential proclamations, executive orders, legislation
- **DOLE** — department orders, labor advisories
- **Other agencies** — SEC, BSP, CTA, NLRC, DENR, and regulatory bodies as added

### 8.2 Ingestion Pipeline

1. Admin enables or configures source in registry
2. Scheduled or manual fetch job discovers new/updated documents
3. Raw content is fetched and stored with hash + timestamp
4. Content is normalized (cleaned, structured) with OCR applied if needed
5. Metadata is extracted and validated (title, citation, date, court, ponente, document type)
6. Draft digest / summary / doctrine extract is generated by AI
7. Truthfulness validator evaluates the output:
   - **Auto-publish** if: official source, complete document, high OCR/text integrity, metadata confidence above threshold, citation mapping complete, no conflict flags
   - **Human review** if: uncertain confidence, partial document, edge-case classification
   - **Quarantine** if: conflicting mirrored sources, incomplete holding, low-quality OCR, unclear publication status
8. Approved documents are indexed and published to the searchable corpus
9. Updated documents create new versions (never overwrite)

### 8.3 Editorial Modes

**Mode 1: Automated Pipeline** — For high-confidence official sources with clean digital text (e.g., recent Supreme Court decisions published as HTML/PDF on the E-Library). These can auto-publish after passing all validation gates.

**Mode 2: Human-Assisted Pipeline** — For scanned documents, older decisions, agency issuances with inconsistent formats, or any content flagged by the truthfulness validator. These enter the digest review queue for editor approval.

### 8.4 Admin Dashboard Features

- Source health dashboard (fetch success rate, last update, document count per source)
- Ingestion job history with error logs
- Duplicate detection report
- Source priority configuration
- Legal metadata editor (correct titles, dates, citations, classifications)
- Digest review queue with approve/reject/revise workflow and reviewer notes
- Source conflict comparison view (side-by-side when two sources disagree)
- Document lineage viewer (version history, source provenance chain)
- Published/unpublished toggles
- Doctrine extraction queue
- Corpus coverage report (gaps by subject area, date range, court)
- Stale-source detector (sources not updated beyond expected schedule)

---

## 9. RAG Pipeline Requirements

### 9.1 Query Classification

Every user query must first be classified into one of the following intent classes:

1. Exact citation lookup (e.g., "G.R. No. 123456")
2. Case-law research (e.g., "What is the doctrine of last clear chance?")
3. Codal/statutory interpretation (e.g., "What does Article 1191 of the Civil Code mean?")
4. Procedural question (e.g., "What is the period to file an appeal from MTC to RTC?")
5. Digest generation (e.g., "Digest this case...")
6. Memo drafting (e.g., "Draft a legal memo on constructive dismissal")
7. User-upload question (e.g., "What does this uploaded document say about...?")
8. Matter-specific question (e.g., "Based on our case files for Reyes v. Santos...")
9. Admin/ingestion task (e.g., internal pipeline trigger)

### 9.2 Retrieval Pipeline Flow

```
User Query
  → Intent Classifier
  → Query Rewriter / Expander (legal synonym injection, citation normalization)
  → Hybrid Retrieval
      ├── BM25 keyword + metadata filters + facets (OpenSearch)
      └── Semantic vector similarity (pgvector / Qdrant)
  → Candidate Merge (RRF or weighted fusion)
  → Reranker (cross-encoder model)
  → Context Pack Builder
      ├── Source passages with section anchors
      ├── Metadata (court, date, ponente, document type)
      ├── Citation anchors for inline linking
      └── Confidence scores per passage
  → Grounded Generation (LLM with strict citation prompting)
      ├── Answer / Digest / Memo
      ├── Citation map (claim → source passage)
      └── Abstention if weak support
  → Output Validator
      ├── Citation verification (every cited source exists and supports the claim)
      ├── Unsupported claim detector
      └── Legal format validator
  → Response + Provenance Record
```

### 9.3 Retrieval Ranking Rules

1. Official primary sources ranked above all other source types
2. Newest authoritative version ranked first within the same document
3. Exact citation matches receive heavy boost
4. Same jurisdiction and same court receive boost
5. Doctrinally related cases ranked above topically tangential matches
6. User private documents included only when user explicitly asks or query context requires

### 9.4 Generation Rules (Non-Negotiable)

- The model **must never** assert a legal proposition without a supporting source passage.
- The model **must** show linked citations for every substantive claim.
- The model **must** label low-confidence answers with a visible indicator.
- The model **must** refuse to answer definitively when retrieval support is insufficient (abstention).
- The model **must** distinguish between: source text, AI summary, AI inference, and user private content — using clear visual/textual labeling in the UI.
- The model **must never** present editorial inference as official text.
- The model **must** preserve uncertainty labels (e.g., "This interpretation is supported by [source], though the court has not directly ruled on this specific scenario").

---

## 10. Safety, Truthfulness & Provenance Policy

### 10.1 Source Hierarchy (Strict)

1. **Official primary source** — Supreme Court E-Library, Official Gazette, official agency publications
2. **Official mirror / institutional source** — Lawphil, ChanRobles (treated as secondary when primary is available)
3. **Internal editorial derivative** — Platform-generated digests, summaries, doctrine extracts
4. **Private user upload** — User-scanned or uploaded documents
5. **Never relied upon** — Unknown third-party summaries, unverified blog posts, or scraped content from non-authoritative sites

### 10.2 Output Classification Labels

Every AI output displayed to users must carry one of these labels:

- **Source Excerpt** — direct text from an official legal document
- **Grounded Summary** — AI-generated summary with citation links to supporting source passages
- **Inferred Analysis** — AI-generated interpretation or comparison that goes beyond direct source text (explicitly labeled)
- **User-Private Digest** — Generated from user-uploaded or user-scanned content
- **Editorial Draft** — Generated by the ingestion pipeline, pending or having passed editorial review

### 10.3 Auto-Publish Rules

Content may be auto-published to the searchable corpus **only when all** of the following conditions are met:

- Source is official (trust level: high)
- Document is complete (no missing pages, sections, or truncation)
- Text integrity is high (OCR confidence above threshold or native digital text)
- Metadata confidence above threshold (title, citation, date, court all extracted)
- Citation mapping is complete (all cross-references identified)
- No conflict flags (no divergence between mirrored source versions)

If any condition fails, the content enters the human review queue.

### 10.4 Hard Block Rules

The system **must block or quarantine** content when:

- OCR confidence falls below the defined threshold
- Source document is visibly incomplete (missing pages, cut-off text)
- Legal holding is not clearly supported by the extracted text
- Conflict exists between mirrored source versions that cannot be automatically resolved
- Content appears to be from a copyrighted non-official publication (e.g., commercial textbook) flagged for editorial promotion
- User scan lacks clear publication source or rights status

### 10.5 Review Roles

- **Ingestion Admin** — manages source registry, fetch schedules, and pipeline configuration
- **Legal Editor** — reviews digests, corrects metadata, approves/rejects editorial content
- **Senior Reviewer** — handles escalated conflicts, edge-case classifications, doctrine disputes
- **Compliance Reviewer** — monitors rights issues, copyright flags, publication status ambiguity

### 10.6 Model Prompting Rules

All LLM prompts in the system must enforce:

- Cite source document IDs and section references in internal chain-of-thought
- Abstain on unsupported holdings — respond with "The retrieved sources do not sufficiently address this question" rather than speculate
- Avoid definitive language without source support — no "The law clearly states..." unless directly quoting
- Never present editorial inference as official text
- Preserve uncertainty labels in output
- Include provenance metadata in structured output for downstream validation

---

## 11. Subscription Plans & Monetization

### 11.1 Plan Tiers

**Free**
- Browse public legal corpus (read-only)
- Limited AI answers (e.g., 15 credits)
- Limited search queries
- OCR preview from camera scan (no saved AI digest)
- No saved digests or very limited monthly quota (e.g., 3)
- No offline reading
- Single user only

**Edu (Students & Bar Takers) — ₱499/month**
- Unlimited search
- AI answers with ALAC/IRAC/bar-exam modes
- Codal reader with offline access
- Reviewer packs and digest library
- Flashcard generation
- Camera scan → OCR → private digest (limited monthly quota)
- Save digests to study dashboard
- Offline mobile reading
- Study progress tracking

**Pro (Solo Practitioners) — ₱999/month**
- Everything in Edu
- Unlimited AI answers and digests
- Camera scan → OCR → unlimited private digest generation
- Memo drafting assistance
- Case comparison
- Bookmarks, annotations, highlights
- Search history and saved queries
- Matter folders (up to 20 active matters)
- Document uploads

**Team / Firm — ₱799/seat/month (min 3 seats)**
- Everything in Pro per seat
- Unlimited matters
- Team-shared digests and workspace
- Collaboration (comments, shared access, activity feed)
- Role-based access control
- Task management and calendar
- Audit logs
- Client-safe workspaces
- Admin seat management

**Enterprise / Editorial — Custom Pricing**
- Everything in Team
- Official source ingestion tools
- Editorial review queue
- Publish to shared corpus
- Source provenance dashboard
- Corpus health monitoring
- Dedicated support
- Custom integrations
- SLA guarantees

### 11.2 Usage-Based Limits

- AI answer credits (Free tier)
- Digest generation quota (Free and Edu tiers)
- Camera scan digest quota (Edu tier)
- Upload storage quota (per plan)
- API access (Enterprise tier, usage-metered)

---

## 12. Phased Roadmap

### Phase 1 — Research MVP (Months 1–4)

**Goal:** Launch a usable legal research product that can compete on core search and AI answer quality.

- PostgreSQL schema, auth, and identity
- Official corpus ingestion from Supreme Court E-Library and Lawphil
- OpenSearch indexing with exact and hybrid search
- RAG service with grounded citation-linked answers
- Legal document reader with source linking
- Bookmarks and saved digests
- Case digest generation pipeline
- Admin editorial queue (basic: approve/reject/publish)
- Subscription billing integration
- Web app (Next.js) — core research and reader experience
- Mobile app — read-only companion (React Native + Expo)

### Phase 2 — Study Mode (Months 5–7)

**Goal:** Win the student and bar taker market.

- Codal reader organized by bar subject area
- Reviewer packs and subject collections
- Study dashboard with progress tracking
- Flashcard generation and review
- Offline mobile reading with local caching
- Digest library with search and filters
- Bar subject categorization for all corpus documents
- Edu plan launch

### Phase 3 — Mobile Scan & Private Knowledge (Months 8–10)

**Goal:** Unlock high daily engagement through mobile utility.

- Camera scan capture with edge detection, crop, deskew, enhance
- Server-side OCR pipeline with quality scoring
- Legal document classification from scanned text
- Private digest generation from scans
- Dashboard save and matter attachment
- Searchable private uploads (within user/org account)
- Scan-to-flashcards
- Scan-to-outline
- Entitlement enforcement (free preview vs. paid digest)
- Privacy controls and editorial candidate flagging

### Phase 4 — Practice Workspace (Months 11–14)

**Goal:** Small firm adoption with matter-centric workflow tools.

- Matter creation and management
- Document repository per matter
- Rich text notes linked to matters
- Annotations and highlights on legal documents
- Task management with due dates and assignees
- Calendar view
- Team collaboration features (comments, shared access, activity feed)
- Audit logs for all workspace actions
- Team role permissions
- Client-safe workspace sharing

### Phase 5 — Editorial Intelligence (Months 15–18)

**Goal:** Build proprietary data moat and competitive differentiation.

- Doctrine extraction as first-class entities
- Cited-authority knowledge graph
- Case-to-codal linking (which cases interpret which provisions)
- Precedent trail visualization
- Advanced duplicate detection and merge
- Source health scoring and quality analytics
- Enhanced review queues with batch operations
- Corpus coverage gap analysis

### Phase 6 — Advanced AI Workflows (Months 19–24)

**Goal:** Premium differentiation for power users and firms.

- Full memo drafting with structured output and citation injection
- Pleading assistance (template-based with AI fill)
- Multi-case comparison tool
- Timeline generation for case histories
- Hearing preparation packs (relevant cases + provisions + key arguments)
- Contradiction detection across authorities
- User-specific research workspaces with persistent AI context
- API access for enterprise integrations

---

## 13. Success Metrics & KPIs

### 13.1 Product Metrics

| Metric | Phase 1 Target | Phase 3 Target | Phase 6 Target |
|---|---|---|---|
| Registered users | 1,000 | 10,000 | 50,000 |
| Monthly active users (MAU) | 400 | 5,000 | 25,000 |
| Paid subscribers | 100 | 2,000 | 10,000 |
| Daily AI queries | 500 | 10,000 | 100,000 |
| Corpus size (documents) | 50,000 | 80,000 | 150,000+ |
| Mobile scan-to-digest conversions/day | N/A | 500 | 5,000 |

### 13.2 Quality Metrics

| Metric | Target |
|---|---|
| Citation fabrication rate | 0% (zero tolerance) |
| AI answer usability rate (immediately usable) | ≥80% |
| Digest accuracy (human-reviewed sample) | ≥90% |
| OCR text accuracy | ≥95% |
| Auto-publish correctness (post-hoc audit) | ≥98% |
| Search relevance (MRR@10) | ≥0.65 |
| User-reported hallucination rate | <1% |

### 13.3 Business Metrics

| Metric | Target |
|---|---|
| Monthly recurring revenue (MRR) at Phase 3 | ₱500,000 |
| Customer acquisition cost (CAC) | <₱1,500 |
| Lifetime value (LTV) / CAC ratio | ≥3:1 |
| Churn rate (monthly) | <5% |
| Net Promoter Score (NPS) | ≥50 |

---

## 14. Compliance & Legal Considerations

### 14.1 Data Privacy Act of 2012 (RA 10175)

LIBERTASIAN must comply with the Philippine Data Privacy Act, including registration with the National Privacy Commission (NPC) for automated data processing systems, particularly given the AI-driven analysis of user queries and documents.

- All personal data collected must have a lawful basis for processing.
- Users must be informed of data collection, usage, and retention policies.
- Data processing systems involving automated decision-making must be registered with the NPC.
- Users must have the right to access, correct, and delete their personal data.
- Data breach notification procedures must be in place.

### 14.2 Intellectual Property & Copyright

- Official government publications (laws, court decisions, executive issuances) are generally in the public domain under Philippine law.
- The platform must respect copyright for commercial legal publications (textbooks, commentaries, treatises) — these must be blocked from editorial corpus ingestion.
- User-scanned commercial book pages must remain private and cannot be promoted to the editorial corpus.
- AI-generated digests and summaries are derivative works — the platform should document their provenance and source linkage.

### 14.3 Practice of Law

- Under Philippine law, the practice of law is reserved for members of the Philippine Bar.
- LIBERTASIAN must include clear disclaimers that AI outputs are informational tools, not legal advice.
- The platform must not cross into regulated legal practice territory (no attorney-client relationship, no representation).

### 14.4 AI Governance

- The Supreme Court's planned "AI Governance Framework for the Judiciary" should be monitored and incorporated as standards emerge.
- The National AI Roadmap 2022–2025 emphasizes human-centric AI, transparency, and bias mitigation — LIBERTASIAN's truthfulness controls align with these principles.

---

## 15. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI hallucination / citation fabrication | Medium | Critical | Zero-tolerance RAG pipeline with citation verification, abstention rules, output validation, and human review |
| Competitor retaliation (Anycase SC partnership) | Medium | High | Differentiate on all-in-one value (scan + workspace + study), not just search quality |
| Data source access changes (SC E-Library, Lawphil) | Medium | High | Multiple source fallbacks, local snapshots, relationship building with publishers |
| Low initial corpus quality | Medium | High | Conservative auto-publish thresholds, prioritize quality over speed, human editorial team |
| User trust deficit (new entrant vs. established players) | High | Medium | Transparent truthfulness policy, public benchmarks, free tier for trial, testimonials |
| Copyright claims from publishers | Low | High | Strict editorial screening, private-by-default user scans, rights review workflow |
| Regulatory changes (AI governance framework) | Medium | Medium | Monitor SC and government AI policy developments, build adaptable compliance layer |
| GPU/infra costs for self-hosted models | Medium | Medium | Start with smaller models, VPS-friendly Phase 1 deployment, scale GPU separately |
| Mobile camera scan quality issues | Medium | Medium | Quality scoring with feedback loop, reject low-quality scans, on-device enhancement |
| Team/firm adoption friction | Medium | Medium | Phased feature rollout, onboarding flow, admin tools, dedicated support |

---

## 16. Open Questions & Future Exploration

1. **Bilateral/Taglish query handling** — Should the RAG pipeline support mixed English-Filipino queries natively, or translate to English before retrieval?
2. **On-device OCR** — Should basic OCR run on-device (for speed and offline preview) with server-side verification, or should all OCR be server-side?
3. **Model selection** — Which open instruct models provide the best performance for Philippine legal questions? Benchmark testing needed.
4. **International expansion** — Could the platform architecture support other ASEAN jurisdictions (Indonesia, Thailand, Vietnam) in the future?
5. **API marketplace** — Should LIBERTASIAN expose a public API for third-party legal tech integrations?
6. **AI-generated pleading templates** — How far can the platform go with pleading assistance without crossing into unauthorized practice of law?
7. **Community features** — Should users be able to share public digests, reviewer notes, or study sets with the community?
8. **Supreme Court partnership** — Should the platform pursue an institutional relationship similar to Anycase's proof-of-concept with the SC?

---

*End of PRD — LIBERTASIAN v1.0*

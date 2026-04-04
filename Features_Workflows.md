# LIBERTASIAN — Features & Workflows

> Complete reference of all features, their workflows, and the processes involved in running the platform.
>
> Last updated: 2026-03-30

---

## Table of Contents

1. [Authentication & Identity](#1-authentication--identity)
2. [Organization & Multi-Tenancy](#2-organization--multi-tenancy)
3. [RBAC (Role-Based Access Control)](#3-rbac-role-based-access-control)
4. [Legal Document Search](#4-legal-document-search)
5. [Document Reader](#5-document-reader)
6. [AI-Powered Legal Answers](#6-ai-powered-legal-answers)
7. [Case Digest Generation](#7-case-digest-generation)
8. [Camera Scan & OCR Pipeline](#8-camera-scan--ocr-pipeline)
9. [File Uploads](#9-file-uploads)
10. [Workspace (Matters, Notes, Tasks)](#10-workspace-matters-notes-tasks)
11. [Legal Memos, Pleadings & Comparisons](#11-legal-memos-pleadings--comparisons)
12. [Study Mode (Codals, Flashcards, Reviewer Packs)](#12-study-mode-codals-flashcards-reviewer-packs)
13. [Community Feed](#13-community-feed)
14. [Community Marketplace](#14-community-marketplace)
15. [Billing & Subscriptions](#15-billing--subscriptions)
16. [Admin Editorial Console](#16-admin-editorial-console)
17. [Source Ingestion Pipeline](#17-source-ingestion-pipeline)
18. [Notifications](#18-notifications)
19. [Audit & Compliance](#19-audit--compliance)
20. [Infrastructure & Deployment](#20-infrastructure--deployment)

---

## 1. Authentication & Identity

### Features
- Email/password registration with HaveIBeenPwned breach check
- Google OAuth login/registration
- JWT access tokens (RS256, 15-min TTL) + refresh tokens (7-day, single-use rotation)
- MFA via TOTP (required for admin/editor/reviewer roles)
- Email verification
- Password reset
- Device-bound sessions with fingerprinting
- Session management (list, revoke individual, revoke all)

### Registration Workflow
```
User submits { email, password, fullName }
  |
  v
Validate email uniqueness
  |
  v
Check password against HaveIBeenPwned (k-anonymity API)
  |
  v
Hash password (bcrypt, cost=12)
  |
  v
Create User record
  |
  v
Create personal Organization (type='individual')
  |
  v
Add user as owner of personal org
  |
  v
Create free Subscription (15 AI answers/day, 50 searches/day)
  |
  v
Auto-accept any pending org invites for this email
  |
  v
Generate email verification token (SHA-256 hashed)
  |
  v
Send verification email --> Audit log: 'auth.register'
```

### Login Workflow
```
User submits { email, password, mfaCode? }
  |
  v
Find user by email (case-insensitive)
  |
  v
Verify password (bcrypt compare)
  |
  v
Check user.status == 'active'
  |
  v
If MFA enabled and no code provided --> return { mfaRequired: true }
  |
  v
If MFA enabled and code provided --> decrypt TOTP secret (AES-256-GCM),
                                      verify code via otplib
  |
  v
Get user's primary organization membership
  |
  v
Issue token pair:
  - Sign JWT payload { sub, email, role, organizationId, mfaVerified }
  - Generate 48-byte random refresh token
  - Hash refresh token (SHA-256), store with familyId + device fingerprint
  |
  v
Return { accessToken, refreshToken, user } --> Audit log: 'auth.login'
```

### Token Refresh Workflow
```
Client sends refresh token
  |
  v
Hash token, look up in DB
  |
  v
Check if already revoked --> If yes: revoke entire family (theft detection)
  |
  v
Check expiry
  |
  v
Verify device fingerprint (IP prefix + user-agent) --> If mismatch: revoke family
  |
  v
Mark old token as revoked
  |
  v
Issue new token pair in same family (same familyId)
  |
  v
Return new { accessToken, refreshToken }
```

### Password Reset Workflow
```
User submits { email } to /forgot-password
  |
  v
Generate random 32-byte reset token, hash (SHA-256)
  |
  v
Store PasswordReset record (expires in 1 hour)
  |
  v
Send password reset email (generic success message to prevent enumeration)
  |
  v
User clicks link, submits { token, newPassword } to /reset-password
  |
  v
Validate token, check expiry
  |
  v
Check new password against HaveIBeenPwned
  |
  v
Hash new password (bcrypt, cost=12)
  |
  v
Transaction: update passwordHash + mark token used + revoke ALL refresh tokens
  |
  v
Audit log: 'auth.reset_password'
```

### MFA Enrollment Workflow
```
User calls POST /auth/mfa/enroll
  |
  v
Generate TOTP secret (otplib)
  |
  v
Encrypt secret with AES-256-GCM (if ENCRYPTION_KEY set)
  |
  v
Store encrypted secret (mfaEnabled still false)
  |
  v
Return { secret, otpauthUrl } for QR code display
  |
  v
User scans QR, submits TOTP code to POST /auth/mfa/verify
  |
  v
Decrypt secret, verify TOTP code
  |
  v
Set mfaEnabled=true --> Audit log: 'auth.mfa_enrolled'
```

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | Public | Register with email/password |
| POST | `/auth/login` | Public | Login (returns tokens + optional MFA challenge) |
| POST | `/auth/refresh` | Public | Refresh access token |
| POST | `/auth/logout` | JWT | Logout (revokes token family) |
| POST | `/auth/forgot-password` | Public | Request password reset email |
| POST | `/auth/reset-password` | Public | Reset password with token |
| POST | `/auth/verify-email` | Public | Verify email with token |
| POST | `/auth/resend-verification` | JWT | Resend verification email |
| GET | `/auth/google` | Public | Initiate Google OAuth |
| GET | `/auth/google/callback` | Public | Google OAuth callback |
| POST | `/auth/mfa/enroll` | JWT | Start MFA enrollment |
| POST | `/auth/mfa/verify` | JWT | Confirm MFA enrollment |
| POST | `/auth/mfa/disable` | JWT | Disable MFA (requires password) |
| GET | `/auth/sessions` | JWT | List active sessions |
| DELETE | `/auth/sessions/:familyId` | JWT | Revoke specific session |
| DELETE | `/auth/sessions` | JWT | Logout from all devices |
| POST | `/auth/accept-invite` | JWT | Accept org invitation |

---

## 2. Organization & Multi-Tenancy

### Features
- Personal org auto-created on registration
- Firm/school/editorial org creation
- Member invitations (email-based, pending invite for unregistered users)
- Role assignment (owner, admin, editor, member, reviewer, student)
- Seat limit enforcement (plan-based)
- Cross-tenant data isolation (Prisma middleware auto-injects organization_id)

### Org Invitation Workflow
```
Owner/Admin calls POST /organizations/:id/members/invite { email, role }
  |
  v
Check seat limit against subscription plan
  |
  v
Look up user by email
  |
  +-- User NOT registered:
  |     |
  |     v
  |   Create PendingInvite (email, role, tokenHash, expiresAt=7 days)
  |     |
  |     v
  |   Send invite email with registration link
  |     |
  |     v
  |   When user registers: auto-accept all pending invites for email
  |
  +-- User registered but NOT member:
  |     |
  |     v
  |   Create OrganizationMember (role, status='active')
  |     |
  |     v
  |   Dual-write: create MemberRole in RBAC system
  |
  +-- Already a member: throw ConflictException
```

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/organizations` | JWT | Create new organization |
| GET | `/organizations/me` | JWT | List user's organizations |
| GET | `/organizations/:id` | JWT+Member | Get org details |
| PATCH | `/organizations/:id` | JWT+Owner/Admin | Update org |
| GET | `/organizations/:id/members` | JWT+Member | List members |
| POST | `/organizations/:id/members/invite` | JWT+Owner/Admin | Invite member |
| PATCH | `/organizations/:id/members/:userId` | JWT+Owner/Admin | Update member role |
| DELETE | `/organizations/:id/members/:userId` | JWT+Owner/Admin | Remove member |

---

## 3. RBAC (Role-Based Access Control)

### Features
- ~90 granular permissions (resource:action format)
- 6 system roles (owner, admin, editor, member, reviewer, student)
- Custom org-scoped role creation
- Role hierarchy (parent-child inheritance via DAG)
- Separation of Duties constraints (mutually exclusive roles)
- Permission resolution with BFS hierarchy traversal
- Redis-cached permissions (5-min TTL)

### Permission Check Workflow (Guard Chain)
```
HTTP Request arrives
  |
  v
JwtAuthGuard: validate JWT signature + expiry --> extract JwtPayload
  |
  v
MfaGuard: if role in [owner, admin, editor, reviewer] --> require mfaVerified=true
  |
  v
TenantGuard: extract organizationId from JWT (never from client)
  |
  v
PermissionsGuard: read @RequiredPermissions() metadata
  |
  v
Resolve memberId from userId + organizationId
  |
  v
Check Redis cache for permissions --> if miss:
  |   Load member's MemberRole assignments
  |   Expand via role hierarchy (BFS traversal)
  |   Collect permissions from all resolved roles
  |   Cache for 5 minutes
  |
  v
hasPermission(memberId, requiredCode) --> Allow or throw 403
  |
  v
SubscriptionGuard: check plan entitlements
  |
  v
Route handler executes
```

### Role Assignment Workflow
```
Admin calls POST /rbac/members/:memberId/roles { roleDefinitionId }
  |
  v
Validate member exists in org
  |
  v
Check for duplicate assignment
  |
  v
Check SoD constraints (mutually exclusive roles)
  |
  v
Enforce cardinality (maxPerOrg limit)
  |
  v
Create MemberRole record
  |
  v
Invalidate member's permission cache
  |
  v
Audit log: 'role.assigned'
```

---

## 4. Legal Document Search

### Features
- Hybrid search: BM25 keyword + kNN semantic vector (OpenSearch)
- Reciprocal Rank Fusion (RRF) for result merging
- Citation lookup (G.R. No., RA No., etc.)
- Autocomplete/suggestions
- Authority boost (official > semi-official > editorial > private)
- Redis result caching (5-min TTL)
- Plan-based quota enforcement

### Search Workflow
```
User submits query with optional filters
  |
  v
Quota check (free: 50/day, pro: unlimited)
  |
  v
Redis cache check (key: cache:search:{SHA256(query+filters)})
  |
  +-- Cache hit: return cached results
  |
  +-- Cache miss:
        |
        v
      BM25 keyword search (OpenSearch legal_documents_keyword index)
        - Multi-match: title^3, citation_text^4, plain_text, gr_no^5
        - Apply metadata filters (court, type, date range, etc.)
        - Fetch limit*3 results (for RRF merging)
        |
        v
      Get query embedding from embedding service (1024-dim vector)
        |
        +-- If available: kNN search (OpenSearch legal_documents_vector index)
        +-- If unavailable: fallback to BM25-only
        |
        v
      Reciprocal Rank Fusion (RRF, k=60)
        - Deduplicate by document ID
        - RRF_score = sum(1 / (60 + rank)) across BM25 + kNN
        |
        v
      Authority Boost multipliers:
        - official: 1.4x, semi_official: 1.2x, editorial: 1.0x, private: 0.8x
        |
        v
      Sort by boosted score, paginate (cursor-based)
        |
        v
      Cache result (Redis, 5-min TTL)
        |
        v
      Audit log: 'search.query'
        |
        v
      Return { items, meta: { hasNext, nextCursor } }
```

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/search` | JWT | Hybrid search with filters |
| GET | `/search/citation/:citation` | Public | Exact citation lookup |
| GET | `/search/suggestions` | Public | Autocomplete suggestions |

---

## 5. Document Reader

### Features
- Full document text with section navigation
- Section-level retrieval (headnote, facts, issue, ruling, ratio, dispositive)
- Citation cross-references (outgoing and incoming)
- Related documents
- Bookmarks and annotations (user-scoped)
- ETag-based caching for unchanged content

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/documents` | Public | List legal documents (cursor pagination) |
| GET | `/documents/:id` | Public | Get document metadata |
| GET | `/documents/:id/sections` | Public | List all sections |
| GET | `/documents/:id/sections/:sectionId` | Public | Get specific section text |
| GET | `/documents/:id/citations` | Public | List outgoing citations |
| GET | `/documents/:id/related` | Public | Related documents (up to 40) |
| POST | `/bookmarks` | JWT | Bookmark a document |
| GET | `/bookmarks` | JWT | List user's bookmarks |
| DELETE | `/bookmarks/:id` | JWT | Remove bookmark |
| POST | `/annotations` | JWT | Create highlight/annotation |
| GET | `/annotations` | JWT | List user's annotations |
| DELETE | `/annotations/:id` | JWT | Remove annotation |

---

## 6. AI-Powered Legal Answers

### Features
- Grounded AI answers with inline citations ([SOURCE uuid] format)
- Intent-based retrieval routing (case_lookup, codal_reference, doctrine_search, etc.)
- Cross-encoder reranking for precision
- Context packing with 4096-token budget
- Mandatory citation validation (NON-OPTIONAL)
- Abstention when evidence is insufficient (never hallucinate)
- SSE streaming for real-time answer display
- Plan-based quotas (free: 15/day, pro: 200/day)

### RAG Pipeline Workflow
```
User submits query
  |
  v
NestJS: quota check + forward to RAG Service (Python/FastAPI)
  |
  v
1. Intent Classification (rule-based, <1ms)
   - CASE_LOOKUP: G.R. No. patterns, case titles
   - CODAL_REFERENCE: RA No., Article/Section patterns
   - DOCTRINE_SEARCH: "doctrine of", "principle of" patterns
   - PROCEDURAL_QUERY: "how to file", "jurisdiction of" patterns
   - LEGAL_QUESTION: question words, "?" suffix
   - GENERAL: fallback
  |
  v
2. Hybrid Retrieval (top 30 passages)
   - BM25 search with intent-boosted fields
   - kNN search (if embedding service available)
   - RRF fusion (k=60)
   - Authority boost (official 1.4x, semi-official 1.2x)
  |
  v
3. Reranking (cross-encoder model, top 8 for answers)
   - If reranker unavailable: fallback to RRF scores
  |
  v
4. Abstention Check
   - NO_RESULTS: no passages found
   - INSUFFICIENT_PASSAGES: fewer than 3 relevant passages
   - LOW_RELEVANCE: top passage score < 0.01
   --> If triggered: return abstention response (never hallucinate)
  |
  v
5. Context Packing (4096-token budget)
   - Greedy inclusion by reranker score
   - Format: [SOURCE doc_id+section_id] title | citation | court\ntext
  |
  v
6. LLM Generation (vLLM, OpenAI-compatible API)
   - System prompt enforces citation rules
   - User query sandboxed as untrusted input
   - temperature=0.2, max_tokens=4096
  |
  v
7. Citation Validation (NON-OPTIONAL)
   - Extract [SOURCE uuid] references via regex
   - Verify each exists in provided passages + PostgreSQL
   - Detect unsupported claims (assertions without citations)
  |
  v
8. Confidence Scoring
   - Based on citation count + passage coverage
   - HIGH >= 0.7, MEDIUM 0.4-0.7, LOW < 0.4
  |
  v
9. Record ModelRun (model_name, version, prompt_template_version, tokens, latency)
  |
  v
Return AnswerResponse { answer, sources, confidence, citations, abstained }
```

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/ai-answers` | JWT | Generate non-streaming answer |
| POST | `/ai-answers/stream` | JWT | Stream answer via SSE |

---

## 7. Case Digest Generation

### Features
- DFIR+ format: Summary, Doctrine, Facts, Petitioner/Respondent Arguments, Issues, Ruling, Dispositive, Cited Authorities
- Confidence scoring (coverage + citation mapping + OCR quality)
- Auto-review status: < 0.7 = needs_human_review, >= 0.7 = ai_generated
- Provenance records linking each field to source sections
- Editorial review queue (approve/reject/assign reviewer)
- Batch operations (bulk approve, reject, assign)
- User scan digests always private (never auto-promoted)

### Digest Generation Workflow
```
User/System triggers POST /digests/generate { legalDocumentId }
  |
  v
Validate document exists + no existing non-rejected digest
  |
  v
Create Digest record (status='draft')
  |
  v
Enqueue BullMQ job 'generate-digest' { digestId, documentId }
  |
  v
Return digest ID immediately (async processing)
  |
  v
[BullMQ Worker]
  |
  v
Fetch document sections from DB (ordered)
  |
  v
Call RAG Service POST /digests/generate with sections
  |
  v
Parse DFIR+ JSON response:
  - summary, facts, petitioner_arguments, respondent_arguments
  - issues, ruling, doctrine, dispositive
  |
  v
Record ModelRun entry (model, version, confidence, tokens)
  |
  v
Create ProvenanceRecords (field -> source_section mapping)
  |
  v
Compute confidence score:
  - coverage = filledFields / requiredFieldCount (6 required)
  - mapping = provenanceCount / filledFields
  - ocrFactor = 0.8 (scans) or 1.0 (official)
  - score = (coverage * 0.4) + (mapping * 0.4) + (ocrFactor * 0.2)
  |
  v
Determine review status:
  - score < 0.7 --> needs_human_review
  - score >= 0.7 + official source --> ai_generated (auto-approvable)
  - User scan origin --> always private visibility
  |
  v
Update digest with content + status
```

### Editorial Review Workflow
```
Admin views GET /admin/digests/review-queue (needs_human_review digests)
  |
  v
Admin examines digest content + provenance records
  |
  +-- Approve: POST /admin/digests/:id/approve
  |     --> visibility='public_editorial', reviewStatus='approved', publishedAt=now
  |
  +-- Reject: POST /admin/digests/:id/reject { notes }
  |     --> reviewStatus='rejected'
  |
  +-- Assign: POST /admin/digests/:id/assign { reviewerUserId }
        --> assignedReviewerUserId set
```

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/digests/generate` | JWT | Trigger AI digest generation (async) |
| POST | `/digests` | JWT | Create digest manually |
| GET | `/digests` | JWT | List digests (cursor, filters) |
| GET | `/digests/:id` | JWT | Get digest detail |
| PATCH | `/digests/:id` | JWT | Update digest |
| DELETE | `/digests/:id` | JWT | Delete digest (owner only) |
| GET | `/digests/:id/provenance` | JWT | Get source references |
| POST | `/digests/:id/compute-confidence` | JWT | Recompute confidence |

---

## 8. Camera Scan & OCR Pipeline

### Features
- Multi-page camera capture with edge detection (mobile)
- On-device image processing (deskew, contrast, compression)
- Server-side OCR (Tesseract 5)
- Quality scoring with rejection/warning thresholds
- Legal document classification
- Citation extraction from OCR text
- Digest generation from scans (paid plan only)
- Flashcard/outline generation from scans
- Privacy-first: all scans default to 'private'

### Camera Scan Workflow (Mobile)
```
[On-Device]
User taps "Scan" in mobile app
  |
  v
Camera preview with edge detection (react-native-document-scanner)
  |
  v
User captures page --> auto-crop, perspective correction
  |
  v
Image processing (expo-image-manipulator):
  - Deskew, deblur, contrast enhancement
  - Compress to JPEG quality 85, max 2048px longest edge
  |
  v
Multi-page queue (user captures additional pages, reorders)
  |
  v
Select privacy level: 'private' (default) or 'editorial_candidate'
  |
  v
Upload to server (multipart POST, TLS 1.3)

[Server-Side]
NestJS receives upload
  |
  v
Validate: magic bytes (file-type), size (20MB max), MIME check
  |
  v
Store in S3: uploads/{orgId}/{userId}/{captureId}/
  |
  v
Create UserUpload + CameraCapture records
  |
  v
Enqueue BullMQ job chain
  |
  v
[Worker Pipeline]
  |
  v
1. ClamAV antivirus scan
   +-- If infected: quarantine + delete + fail
   +-- If clean: continue
  |
  v
2. Sharp image processing
   - limitInputPixels = 100MP (decompression bomb prevention)
   - Strip EXIF metadata
   - Resize to max 2048px
   - Generate 300px thumbnail
  |
  v
3. Quality scoring (OCR service)
   - Resolution, blur detection, contrast analysis
   +-- Score < 0.2: reject with guidance, fail job
   +-- Score < 0.4: warn user, suggest retake, continue
   +-- Score >= 0.4: acceptable, continue
  |
  v
4. OCR text extraction (Tesseract 5 + language detection)
   - Store text in S3: uploads/.../ocr_text.txt
   - Create OcrResult record (quality, confidence, wordCount)
  |
  v
5. Legal document classification (RAG service)
   - Classify as: legal_brief, statute, judgment, contract, memo
  |
  v
6. Citation extraction (regex + NER)
   - Extract G.R. No., S.C.R.A., RA No., etc.
   - Store as extractedCitationsJson
  |
  v
7. Entitlement check
   +-- Paid plan: trigger digest generation (async)
   +-- Free plan: OCR text only, show upgrade prompt
  |
  v
8. Index OCR text in OpenSearch (for search within scans)
  |
  v
Mark processing as 'completed', notify client
```

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/uploads/camera-scan` | JWT | Upload camera scan (202 Accepted) |
| GET | `/uploads/:id/status` | JWT | Poll processing status |
| GET | `/uploads/:id/ocr-results` | JWT | Per-page OCR results |
| GET | `/uploads/:id/ocr-text` | JWT | Full extracted text |
| POST | `/uploads/:id/generate-digest` | JWT | Trigger digest from scan |
| POST | `/uploads/:id/generate-flashcards` | JWT | Generate flashcards from OCR |
| POST | `/uploads/:id/generate-outline` | JWT | Generate outline from OCR |
| POST | `/uploads/:id/attach-to-matter` | JWT | Link scan to a matter |
| PATCH | `/uploads/:id/privacy` | JWT | Toggle privacy level |

---

## 9. File Uploads

### Features
- PDF/image document uploads
- Magic byte validation (file-type package)
- ClamAV antivirus scanning
- Sharp image processing with decompression bomb prevention
- UUID-based object keys (path traversal prevention)
- Content-Disposition: attachment (never serve inline)
- Isolated storage: uploads/{org_id}/{user_id}/{uuid}
- Rate limit: 20 files/hour per user

### Upload Pipeline
```
User uploads file via POST /uploads (multipart/form-data)
  |
  v
Validate: magic bytes, MIME type, size limit (images: 20MB, PDFs: 50MB)
  |
  v
Compute SHA-256 checksum
  |
  v
Generate UUID-based S3 key
  |
  v
Upload raw file to S3
  |
  v
Create UserUpload record (processingStatus='pending')
  |
  v
Enqueue BullMQ 'process-upload' job (3 retries, exponential backoff)
  |
  v
Return { uploadId, jobId, status: 'pending' } (202 Accepted)
```

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/uploads` | JWT | Upload file (202 Accepted) |
| GET | `/uploads` | JWT | List uploads (org-scoped, cursor) |
| GET | `/uploads/:id` | JWT | Get upload details |
| GET | `/uploads/:id/status` | JWT | Quick status poll |
| DELETE | `/uploads/:id` | JWT | Delete upload (S3 + DB) |
| POST | `/uploads/search` | JWT | Full-text search uploaded docs |

---

## 10. Workspace (Matters, Notes, Tasks)

### Features
- **Matters**: Case/project management with document attachments
- **Notes**: Tiptap-compatible rich text notes, linked to matters
- **Tasks**: Assignable tasks with priority, due dates, status tracking
- **Annotations**: User-scoped document highlights with color + notes
- **Comments**: Threaded comments on matters and tasks
- **Activity feed**: Recent workspace actions from audit logs
- **Sharing**: Capability-based share links (token, permission, expiry, password)

### Matter Management Workflow
```
User creates matter: POST /matters { title, description, matterType, court }
  |
  v
Create Matter record (org-scoped, owner=creator)
  |
  v
Attach documents: POST /matters/:id/documents
  - Legal documents (from corpus) OR user uploads (from scans)
  |
  v
Add notes: POST /notes { title, body (Tiptap JSON), matterId }
  |
  v
Create tasks: POST /tasks { title, assignedTo, priority, dueDate, matterId }
  |
  v
Add comments: POST /matters/:id/comments { commentText }
  |
  v
Share with external: POST /shares { entityType, entityId, permission, expiryDate }
  - Generates share token
  - Optional password protection
  - Access via GET /shared/:token (public, no auth)
```

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/matters` | JWT+Tenant | Create matter |
| GET | `/matters` | JWT+Tenant | List matters (cursor, search, status) |
| GET | `/matters/:id` | JWT+Tenant | Get matter with docs + notes |
| PATCH | `/matters/:id` | JWT+Tenant | Update matter |
| DELETE | `/matters/:id` | JWT+Tenant | Delete matter (cascades) |
| POST | `/matters/:id/documents` | JWT+Tenant | Attach document |
| POST | `/notes` | JWT+Tenant | Create note |
| GET | `/notes` | JWT+Tenant | List notes |
| POST | `/tasks` | JWT+Tenant | Create task |
| GET | `/tasks` | JWT+Tenant | List tasks (filters: status, priority, assignee) |
| POST | `/shares` | JWT+Tenant | Create share link |
| GET | `/shared/:token` | Public | Access shared content |

---

## 11. Legal Memos, Pleadings & Comparisons

### Features (Pro+ subscription required)
- **Legal Memos**: AI-drafted legal memoranda from matter context
- **Pleadings**: Template-based court document generation
- **Case Comparisons**: Side-by-side analysis of 2-5 documents
- **Timelines**: Chronological event extraction from documents
- **Hearing Prep**: Preparation packs for court hearings
- **Contradictions**: Identify conflicting legal positions (Team plan)
- **Research Workspaces**: Collaborative legal research spaces

### Case Comparison Workflow
```
User selects 2-5 documents for comparison
  |
  v
POST /case-comparisons/generate { documentIds[] }
  |
  v
Create CaseComparison record (status='generating')
  |
  v
Enqueue BullMQ 'generate-comparison' job
  |
  v
[Worker]
  |
  v
Fetch all document sections
  |
  v
Call RAG service with multi-document context
  |
  v
Generate structured comparison:
  - Similar holdings, differing interpretations
  - Shared cited authorities, unique citations
  - Doctrine evolution across decisions
  |
  v
Record ModelRun for audit
  |
  v
Update CaseComparison with analysis JSON
```

### API Endpoints (All require JWT + Pro subscription)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/memos/generate` | Generate AI legal memo |
| POST | `/pleadings/generate` | Generate pleading from template |
| POST | `/case-comparisons/generate` | Compare 2-5 documents |
| POST | `/timelines/generate` | Extract chronological events |

---

## 12. Study Mode (Codals, Flashcards, Reviewer Packs)

### Features
- **Codal Reader**: Browse Philippine codals by BAR exam subject
- **Flashcard Sets**: Create/manage flashcard sets for study
- **AI Flashcard Generation**: Auto-generate flashcards from topics/documents
- **Spaced Repetition**: Track review verdicts (correct/incorrect/skip) with confidence
- **Reviewer Packs**: Structured study kits for exam preparation
- **Study Sessions**: Track study time and progress
- **Offline Support**: SQLite + MMKV caching on mobile

### AI Flashcard Generation Workflow
```
User selects flashcard set, requests AI generation
  |
  v
POST /study/flashcard-sets/:setId/generate-ai { topic, barSubject, count }
  |
  v
Call RAG service POST /flashcards/generate
  |
  v
Receive cards array: { front, back, difficulty, sourceRefs }
  |
  v
Batch insert to Flashcard table (sourceType='ai_generated')
  |
  v
Record ModelRun for audit
  |
  v
Return { generatedCount, confidenceScore, modelName }
```

### Study Session Workflow
```
User starts study session: POST /study/sessions/start { barSubject, sessionType }
  |
  v
Return sessionId
  |
  v
For each flashcard reviewed:
  POST /study/flashcards/:cardId/review { verdict, confidence }
  - Create FlashcardReview record
  - Update mastery level (spaced repetition)
  |
  v
End session: POST /study/sessions/end { sessionId, timeSpent, correctCount }
```

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/study/bar-subjects` | Public | List BAR subjects with doc counts |
| GET | `/study/codals/:subject` | Public | List codals by subject |
| POST | `/study/flashcard-sets` | JWT | Create flashcard set |
| GET | `/study/flashcard-sets` | JWT | List sets |
| POST | `/study/flashcard-sets/:id/generate-ai` | JWT | AI flashcard generation |
| POST | `/study/flashcards/:id/review` | JWT | Submit review verdict |
| POST | `/study/reviewer-packs` | JWT | Create reviewer pack |
| POST | `/study/sessions/start` | JWT | Start study session |
| POST | `/study/sessions/end` | JWT | End study session |

---

## 13. Community Feed

### Features
- Text + image posts with visibility controls (draft, organization, public)
- Async media upload with Sharp processing (BullMQ)
- Likes, bookmarks, comments (1-level threading)
- Report system with 6 reason categories
- Admin moderation (hide/remove posts and comments)
- Cursor-based pagination on all feeds
- Denormalized counters (likeCount, commentCount, bookmarkCount)
- Soft deletes for audit trail

### Post Creation Workflow
```
[Optional] Upload image: POST /feed/media/upload (multipart, 20MB max)
  |
  v
Validate: magic bytes (JPEG/PNG/WebP only), SHA-256 checksum
  |
  v
Upload raw to S3, enqueue BullMQ 'feed-media' job
  |
  v
[Worker] Sharp pipeline:
  - Feed image: 1080px max width, JPEG quality 85
  - Thumbnail: 300px wide, JPEG quality 80
  - ClamAV scan (quarantine if infected)
  |
  v
Return mediaId (status: 'pending' -> 'ready')
  |
  v
Create post: POST /feed/posts { textContent, visibility, mediaId? }
  |
  v
Validate media ownership + ready status
  |
  v
Create FeedPost record (default visibility: 'organization')
  |
  v
Audit log: 'feed_post.create'
```

### Feed Visibility Rules
| Feed | Filter | Scope |
|------|--------|-------|
| Public (`GET /feed`) | visibility='public', status='published' | All users |
| Organization (`GET /feed/organization`) | org-scoped, visibility in ['organization','public'] | Org members |
| User Profile (`GET /feed/user/:userId`) | Self: all statuses; Others: public only | Per user |
| Bookmarks (`GET /feed/bookmarks`) | User's bookmarked posts | Personal |

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/feed` | JWT | Public community feed |
| GET | `/feed/organization` | JWT+Tenant | Org feed |
| GET | `/feed/user/:userId` | JWT | User profile feed |
| GET | `/feed/bookmarks` | JWT | Bookmarked posts |
| POST | `/feed/posts` | JWT+Tenant | Create post |
| PATCH | `/feed/posts/:postId` | JWT | Update own post |
| DELETE | `/feed/posts/:postId` | JWT | Soft-delete own post |
| POST | `/feed/media/upload` | JWT+Tenant | Upload image (202) |
| POST | `/feed/posts/:postId/like` | JWT | Like post |
| POST | `/feed/posts/:postId/bookmark` | JWT | Bookmark post |
| POST | `/feed/posts/:postId/report` | JWT | Report post |
| POST | `/feed/posts/:postId/comments` | JWT | Create comment |

---

## 14. Community Marketplace

### Features
- Browse public flashcard sets, reviewer packs, and digests
- Rating system (1-5 stars with aggregation)
- Upvote/downvote voting
- Content flagging for moderation
- Expert verification (submit credentials, admin approves, badge granted)
- Contributor profiles with contribution stats
- Featured/trending content curation

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/community/marketplace/flashcard-sets` | Public | Browse flashcard sets |
| GET | `/community/marketplace/reviewer-packs` | Public | Browse reviewer packs |
| GET | `/community/marketplace/digests` | Public | Browse digests |
| GET | `/community/marketplace/featured` | Public | Featured/trending items |
| POST | `/community/ratings` | JWT | Rate content (1-5) |
| PUT | `/community/votes/:entityType/:entityId` | JWT | Upvote/downvote |
| POST | `/community/flags` | JWT | Flag content |
| POST | `/community/expert-verification` | JWT | Submit verification request |

---

## 15. Billing & Subscriptions

### Features
- Plan tiers: free, edu, pro, team, enterprise
- Xendit payment integration (credit card, GCash, GrabPay, PayMaya)
- Pricing engine with coupon + promotion stacking
- Subscription state machine (12 states, 20+ transitions)
- Proration on plan changes
- Trial periods with auto-conversion
- Pause/resume subscriptions
- Seat management
- Invoice history
- Usage quota tracking (Redis counters)

### Checkout Workflow
```
User selects plan on pricing page
  |
  v
Preview: POST /billing/checkout/preview { planCode, billingPeriod, couponCode? }
  |
  v
PricingEngine calculates:
  - Base price
  - Coupon discount (if valid)
  - Promotion discount (if applicable)
  - Proration (if upgrading mid-cycle)
  - Final amount
  |
  v
User confirms: POST /billing/checkout { planCode, billingPeriod, couponCode? }
  |
  v
Reserve coupon (mark pending)
  |
  v
Create Xendit invoice (30-min duration, PHP currency)
  |
  v
Create Payment record (status='pending')
  |
  v
Create CheckoutPriceSnapshot (full pricing audit trail)
  |
  v
Return { checkoutUrl, checkoutSessionId } --> redirect user to Xendit
  |
  v
[User pays on Xendit]
  |
  v
Xendit webhook POST /billing/webhook
  |
  v
Verify webhook token (constant-time comparison)
  |
  v
handlePaymentSuccess():
  |
  v
Transaction:
  - Mark payment as 'succeeded'
  - Deactivate old subscription (status='expired')
  - Create new Subscription with entitlements
  - Create Invoice with line items
  |
  v
Finalize coupon redemption
  |
  v
State machine transition: PROVISIONING -> ACTIVE
  |
  v
Reset quotas (Redis counters)
  |
  v
Send confirmation notification
  |
  v
Audit log: 'subscription.activated'
```

### Subscription State Machine
```
                    +-- START_TRIAL --> TRIALING
                    |                     |
                    |                CONVERT_TRIAL
PROVISIONING -------+                     |
    |               |                     v
    |               +-- ACTIVATE --> [ACTIVE] <-- RENEW
    |                                   |  |
    |                      PAYMENT_FAILED  REQUEST_CANCEL
    |                           |              |
    |                        PAST_DUE      CANCELLING
    |                           |              |
    |                  ENTER_GRACE_PERIOD   CANCEL_IMMEDIATELY
    |                           |              |
    |                      GRACE_PERIOD     CANCELLED
    |                           |              |
    |                        SUSPEND       REACTIVATE
    |                           |              |
    |                       SUSPENDED ----------+
    |
    +-- GRANT_COMPLIMENTARY --> COMPLIMENTARY

All states --> TERMINATE --> TERMINATED (irreversible)
```

### Plan Feature Gating
| Feature | Free | Edu | Pro | Team |
|---------|------|-----|-----|------|
| Search | 50/day | 200/day | Unlimited | Unlimited |
| AI Answers | 15/day | 50/day | 200/day | Unlimited |
| Digests | 3/month | 20/month | Unlimited | Unlimited |
| Camera Scans (digest) | OCR only | 10/month | Unlimited | Unlimited |
| Memos/Pleadings | -- | -- | Yes | Yes |
| Case Comparisons | -- | -- | Yes | Yes |
| Member Management | -- | -- | -- | Yes |
| Audit Logs | -- | -- | -- | Yes |

---

## 16. Admin Editorial Console

### Features
- Source registry management (SC E-Library, Lawphil, Official Gazette, etc.)
- Ingestion job monitoring and manual triggers
- Editorial review queue (approve/reject digests and documents)
- Editorial flags (hallucination risk, weak citation, duplicate, etc.)
- Corpus health dashboard (document counts, coverage gaps, stale content)
- Source health scores (success rate, staleness, publication rate)
- BAR subject coverage analysis
- Ingestion velocity trends
- Batch categorization tools
- Deduplication review queue
- Knowledge graph visualization (citation network)

### Admin Review Workflow
```
Admin views GET /admin/review-queue (digests with needs_human_review)
  |
  v
Examine digest content, provenance records, confidence score
  |
  +-- POST /admin/review-queue/:id/approve
  |     - visibility='public_editorial'
  |     - reviewStatus='approved'
  |     - publishedAt=now
  |     - Audit log: 'editorial.approve'
  |
  +-- POST /admin/review-queue/:id/reject { notes }
        - reviewStatus='rejected'
        - Audit log: 'editorial.reject'
```

### API Endpoints (Admin-only, require community:moderate or admin permissions)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/sources` | List all sources |
| POST | `/admin/sources` | Register new source |
| POST | `/admin/sources/:id/fetch` | Trigger manual ingestion |
| GET | `/admin/ingestion-jobs` | List ingestion jobs |
| GET | `/admin/ingestion/dashboard` | Pipeline stats |
| GET | `/admin/review-queue` | Digests pending review |
| POST | `/admin/review-queue/:id/approve` | Approve digest |
| POST | `/admin/review-queue/:id/reject` | Reject digest |
| GET | `/admin/editorial-flags` | List editorial flags |
| GET | `/admin/corpus-health` | Corpus health metrics |
| GET | `/admin/sources/health` | Source health scores |
| GET | `/admin/coverage-gaps` | Coverage gap analysis |

---

## 17. Source Ingestion Pipeline

### Features
- Automated crawling of Philippine legal sources (SC E-Library, Lawphil, Official Gazette, Congress)
- Scheduled fetches via Celery Beat (cron-based per source endpoint)
- 5-tier deduplication (NEW, DUPLICATE, UPDATE)
- Document parsing (HTML, PDF, OCR)
- Citation extraction and normalization
- Truthfulness validation
- Section segmentation (headnote, facts, issue, ruling, ratio, dispositive)
- Embedding generation for vector search
- OpenSearch indexing (keyword + kNN)
- Post-ingestion chain: doctrines + citations + auto-digest generation

### Ingestion Pipeline Workflow
```
Admin triggers POST /admin/sources/:id/fetch
  --> OR Celery Beat scheduler (cron-based per source endpoint)
  |
  v
Create IngestionJob record (status='pending')
  |
  v
Celery Beat polls every 60s, dispatches run_ingestion_job workers
  |
  v
Worker claims job (status='running')
  |
  v
Load source config + endpoint(s)
  |
  v
For each endpoint:
  |
  v
  Look up fetcher by parser_type (e.g., 'supreme_court_elibrary')
  |
  v
  Fetcher.discover(endpoint_url, last_fetched_at)
    --> Crawl listing pages
    --> Return list of CandidateDoc (url, title, gr_no, type, date)
  |
  v
  For each candidate:
    |
    v
    DedupClassifier.classify(candidate)
      - Compute content_checksum + similarity_key
      +-- NEW: create legal_document
      +-- DUPLICATE: skip
      +-- UPDATE: create legal_document_version (never overwrite)
    |
    v
    Fetch document content (HTML/PDF)
    |
    v
    Parse: extract sections + metadata
    |
    v
    Normalize: citations (G.R. No. -> canonical), whitespace
    |
    v
    TruthfulnessValidator: CREDIBLE / QUESTIONABLE / FABRICATED
    |
    v
    Store legal_document (status='draft', truthfulnessStatus from verdict)
    |
    v
    Dispatch post-ingestion chain (parallel, fire-and-forget):
      |
      +-- generate_embeddings(doc_id)
      |     --> Call embedding service, store in pgvector + OpenSearch
      |
      +-- extract_doctrines(doc_id)
      |     --> Call RAG service, create Doctrine records
      |
      +-- extract_citations(doc_id)
      |     --> Parse citations, create Citation cross-reference records
      |
      +-- generate_ingestion_digest(doc_id)
            --> Call RAG service for DFIR+ digest (non-blocking)
            --> Create Digest + ProvenanceRecords + ModelRun
  |
  v
Update endpoint timestamps (lastFetchedAt, lastSuccessAt)
  |
  v
Complete job: status='completed', log counters (found/created/updated)
  |
  v
Truthfulness Validator auto-publishes if ALL criteria met:
  - Official source (trust: high)
  - Complete document
  - High text integrity
  - Metadata confidence > threshold
  - Citation mapping complete
  - No conflict flags
Otherwise: queue for human review or quarantine
```

---

## 18. Notifications

### Features
- Email notifications (verification, password reset, invites)
- In-app notification center (cursor-paginated, read/unread)
- Real-time WebSocket push (Socket.IO)
- Event-driven architecture (EventEmitter2)
- BullMQ email queue with retries

### Notification Flow
```
Domain event emitted (e.g., 'subscription.payment_failed')
  |
  v
NotificationListener catches event via EventEmitter2
  |
  v
Create Notification record in DB (userId, type, title, body, read=false)
  |
  v
Push via WebSocket: 'notification:new' event to connected client
  |
  v
If email required: enqueue to BullMQ 'emails' queue
  |
  v
Email processor sends via SMTP/SendGrid/Mailgun (3 retries)
```

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/notifications` | JWT | List notifications (cursor, isRead filter) |
| GET | `/notifications/unread-count` | JWT | Unread count |
| PATCH | `/notifications/:id/read` | JWT | Mark as read |
| POST | `/notifications/mark-all-read` | JWT | Mark all as read |
| DELETE | `/notifications/:id` | JWT | Delete notification |

---

## 19. Audit & Compliance

### Features
- Append-only audit_logs table (app cannot UPDATE/DELETE)
- All state-changing operations logged
- All auth events logged
- PII redacted in logs (email: j***@example.com, phone: ****1234)
- Model run tracking (every LLM invocation with model/version/prompt version)
- Provenance records (link derivatives to source documents)
- 2-year retention (Philippine Data Privacy Act compliance)

### Audit Record Structure
```
AuditLog {
  id, organizationId, actorUserId, actorType (user|admin|system),
  action (e.g., 'feed_post.create', 'auth.login', 'digest.approve'),
  entityType, entityId,
  metadataJson (diff of changed fields),
  ipAddress, userAgent,
  createdAt
}

ModelRun {
  id, runType (answer|digest|summary|citation_extract|ocr_postprocess),
  modelName, modelVersion, promptTemplateVersion,
  inputRef, outputRef, confidence,
  tokensIn, tokensOut, latencyMs,
  createdAt
}

ProvenanceRecord {
  id, entityType (document|section|digest|answer), entityId,
  sourceDocumentId, sourceSectionId,
  provenanceType (quoted|derived|summarized|ocr_extracted),
  createdAt
}
```

---

## 20. Infrastructure & Deployment

### Services (Docker Compose)
| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| postgres | pgvector/pgvector:pg16 | 5432 | Primary database + vector embeddings |
| redis | redis:7-alpine | 6379 | Cache, sessions, rate limits, job queues |
| opensearch | opensearch:2.17 | 9200 | Full-text + kNN hybrid search |
| minio | minio/minio | 9000/9001 | S3-compatible object storage |
| clamav | clamav/clamav | 3310 | Malware scanning for uploads |
| api | Dockerfile.api | 3001 | NestJS API gateway |
| web | Dockerfile.web | 3000 | Next.js web application |
| rag-service | Dockerfile.rag | 8000 | Python/FastAPI RAG pipeline |
| ocr-service | Dockerfile.ocr | 8002 | Python/FastAPI OCR service |
| embedding-service | Dockerfile.embedding | 8001 | Sentence embedding service |
| worker-service | Dockerfile.worker | -- | Celery workers (OCR, digest, ingestion) |
| worker-beat | Dockerfile.worker | -- | Celery scheduler (periodic tasks) |

### CI/CD Pipelines (GitHub Actions)
| Workflow | Trigger | Steps |
|----------|---------|-------|
| `ci.yml` | PR/push to main | Lint + type-check + unit tests + build |
| `deploy-staging.yml` | Push to main | Build Docker images + push to GHCR + deploy via SSH + run migrations + health checks |
| `deploy-production.yml` | Manual approval | Same + zero-downtime rolling restart |
| `security-scan.yml` | Scheduled | Dependency vulnerability scanning (Snyk/Trivy) |

### VPS Architecture (Phase 1)
```
Server 1: App Server (4-8 vCPUs, 16-32GB RAM)
  - Next.js web, NestJS API, Nginx, Redis

Server 2: Database Server (4-8 vCPUs, 32GB RAM, SSD)
  - PostgreSQL 16 + pgvector, scheduled backups

Server 3: Search Server (4-8 vCPUs, 32GB RAM, SSD)
  - OpenSearch 2.x (single-node)

Server 4: Worker/AI Node (8 vCPUs, 32-64GB RAM)
  - Python workers, RAG service, Celery, MinIO

Server 5: GPU Node (when available)
  - vLLM server (instruct + embedding + reranker models)
```

### Frontend Pages Summary

**Web App (Next.js 15 App Router) — 91 pages:**
- (auth): login, register, forgot-password, reset-password, verify-email
- (dashboard): search, digests, scans, study, community, feed, workspace, settings, admin
- (public): pricing, privacy, terms, landing

**Mobile App (React Native + Expo Router) — 6 tab navigation:**
1. Search — Legal document search
2. Digests — Saved digests
3. Study — Codals, flashcards, reviewer packs
4. Scan — Camera capture, OCR, digest generation
5. Feed — Community social feed
6. Workspace — Matters, notes, tasks, bookmarks

---

*End of Features & Workflows Document*

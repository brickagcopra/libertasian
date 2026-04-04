# LIBERTASIAN — Local Setup Guide

**Purpose:** Step-by-step instructions to run the entire LIBERTASIAN platform locally for testing.

---

## Prerequisites

Before you begin, install the following on your machine:

| Tool | Required Version | Install Guide |
|------|-----------------|---------------|
| **Node.js** | >= 22.0.0 | https://nodejs.org/ (LTS) |
| **pnpm** | >= 10.0.0 | `npm install -g pnpm@10.30.3` |
| **Docker Desktop** | Latest | https://www.docker.com/products/docker-desktop/ |
| **Python** | >= 3.11 | https://www.python.org/downloads/ (only if running Python services outside Docker) |
| **Git** | Latest | https://git-scm.com/ |

**System requirements (recommended):**
- 16 GB RAM minimum (Docker services use ~4-6 GB)
- 10 GB free disk space (Docker images + volumes)
- Ports available: 3000, 3001, 5432, 6379, 8000, 8001, 8002, 9000, 9001, 9200, 3310

---

## Step 1: Clone and Install Dependencies

```bash
# Navigate to your project directory
cd C:\Users\bma58\onedrive\desktop\project\libertasian

# Install all monorepo dependencies
pnpm install
```

This installs dependencies for all workspaces: `apps/api`, `apps/web`, `apps/mobile`, and `packages/*`.

> **Note:** You may see warnings about React 18 vs 19 type conflicts between mobile and web — this is expected and handled by the build configuration.

---

## Step 2: Create Environment File

```bash
# Copy the example environment file
cp .env.example .env
```

The `.env.example` file comes pre-configured with working local defaults. Key values:

| Variable | Default Value | Notes |
|----------|--------------|-------|
| `DATABASE_URL` | `postgresql://libertasian:libertasian_dev@localhost:5432/libertasian` | Matches docker-compose |
| `REDIS_URL` | `redis://localhost:6379/0` | Matches docker-compose |
| `OPENSEARCH_URL` | `https://localhost:9200` | Matches docker-compose |
| `OPENSEARCH_PASSWORD` | `LibertasianDev2024!` | Matches docker-compose |
| `S3_ENDPOINT` | `http://localhost:9000` | MinIO local |
| `JWT_SECRET` | `change-me-to-a-strong-random-secret-at-least-32-chars` | Dev fallback (symmetric) |
| `CLAMAV_ENABLED` | `true` | Malware scanning |

**For local development, the defaults work as-is.** No changes needed unless you have port conflicts.

> **Important:** The `.env` file lives at the monorepo root. All API scripts (`prisma:migrate:dev`, `seed`, `dev`, etc.) use `dotenv-cli` to load it automatically from `../../.env`. You do NOT need to copy `.env` into `apps/api/`.

---

## Step 3: Start Infrastructure Services (Docker)

Start all backend infrastructure (PostgreSQL, Redis, OpenSearch, MinIO, ClamAV, Python services):

```bash
docker compose up -d
```

This starts **10 containers:**

| Container | Port | Purpose |
|-----------|------|---------|
| `libertasian-postgres` | 5432 | PostgreSQL 16 + pgvector |
| `libertasian-redis` | 6379 | Cache, sessions, job queues |
| `libertasian-opensearch` | 9200 | Full-text + vector search |
| `libertasian-minio` | 9000 (API), 9001 (console) | S3-compatible object storage |
| `libertasian-minio-init` | — | Creates S3 buckets on first run |
| `libertasian-clamav` | 3310 | Malware scanning for uploads |
| `libertasian-ocr-service` | 8002 | OCR + document quality scoring |
| `libertasian-embedding-service` | 8001 | Text embeddings (BGE-small) |
| `libertasian-worker-service` | — | Celery async job worker |
| `libertasian-worker-beat` | — | Celery periodic task scheduler |

### Verify all services are healthy:

```bash
docker compose ps
```

Wait until all containers show `healthy` status (may take 1-2 minutes — ClamAV can take up to 2 minutes for virus definition updates on first start).

> **Note:** You may see a warning about `version` being obsolete in `docker-compose.yml` — this is harmless and can be ignored.

### Troubleshooting Docker startup:

```bash
# View logs for a specific service
docker compose logs postgres
docker compose logs opensearch
docker compose logs clamav

# If OpenSearch fails (common on Windows): increase Docker Desktop memory to 4GB+
# OpenSearch needs vm.max_map_count — Docker Desktop handles this automatically on Windows/Mac

# If ClamAV takes too long, you can skip it for initial testing:
# Set CLAMAV_ENABLED=false in .env (file uploads will skip malware scanning)

# Restart a single service
docker compose restart postgres
```

---

## Step 4: Build the Types Package

The shared `@libertasian/types` package must be built before the API can start:

```bash
pnpm --filter @libertasian/types build
```

This compiles the shared TypeScript types to CommonJS for the NestJS runtime.

---

## Step 5: Generate Prisma Client

```bash
pnpm --filter @libertasian/api prisma:generate
```

This generates the TypeScript Prisma client from the schema (61 models). Required before running the API.

---

## Step 6: Run Database Migrations

Run the migration directly from the `apps/api` directory:

```bash
cd apps/api
npx dotenv -e ../../.env -- npx prisma migrate dev --name init
cd ../..
```

This creates all database tables, indexes, and constraints in PostgreSQL.

> **If migration fails** with a connection error, verify PostgreSQL is running: `docker compose ps postgres`
>
> **If migration fails** with an advisory lock timeout (`P1002`), a previous migration was interrupted. Fix it by terminating stale connections:
> ```bash
> docker exec libertasian-postgres psql -U libertasian -d libertasian -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'libertasian' AND pid <> pg_backend_pid();"
> ```
> Then retry the migration command.

---

## Step 7: Seed the Database

```bash
# Main seed: admin user + org + subscription + ingestion sources
pnpm --filter @libertasian/api seed

# Additional seeds (optional but recommended):
pnpm --filter @libertasian/api seed:bar-subjects
pnpm --filter @libertasian/api seed:pleading-templates
```

**What gets created:**

| Entity | Details |
|--------|---------|
| Admin user | `admin@libertasian.dev` / `Admin123456!` |
| Organization | "LIBERTASIAN Dev" (team type) |
| Membership | Admin role |
| Subscription | Pro plan, 1-year validity, generous entitlements |
| Sources | Supreme Court E-Library, Lawphil, Official Gazette, Congress |
| Bar subjects | Philippine bar exam subject taxonomy (9 subjects) |
| Pleading templates | Legal document templates |

---

## Step 8: (Optional) Generate JWT Keys for RS256

For local development, the symmetric `JWT_SECRET` in `.env` works fine. For production-style RS256 keys:

```bash
pnpm --filter @libertasian/api generate:jwt-keys
```

This creates `apps/api/secrets/jwt-private.pem` and `jwt-public.pem`, and prints base64-encoded versions for `.env`.

To use them, update `.env`:
```bash
JWT_PRIVATE_KEY_PATH=apps/api/secrets/jwt-private.pem
JWT_PUBLIC_KEY_PATH=apps/api/secrets/jwt-public.pem
# And remove/blank out JWT_SECRET
```

---

## Step 9: Build and Start the Applications

### First Run — Build Required

On first run (or after `pnpm clean`), build the API before starting dev mode:

```bash
pnpm --filter @libertasian/api build
```

This is needed because `nest start --watch` uses incremental compilation and expects `dist/` to exist.

### Option A: Start everything at once (Turborepo)

```bash
pnpm dev
```

This starts all apps in parallel via Turborepo:
- **API** (NestJS): http://localhost:3001
- **Web** (Next.js): http://localhost:3000
- **Mobile** (Expo): Opens dev server with QR code

### Option B: Start services individually (recommended for debugging)

Open separate terminals for each:

**Terminal 1 — API (NestJS):**
```bash
pnpm --filter @libertasian/api dev
```

**Terminal 2 — Web (Next.js):**
```bash
pnpm --filter @libertasian/web dev
```

**Terminal 3 — Mobile (Expo) — optional:**
```bash
pnpm --filter @libertasian/mobile start
```

> **Tip:** Start the API first since the web app makes API calls to `http://localhost:3001`.

---

## Step 10: Verify Everything Works

### 10.1 API Health Check

Open in browser or use curl:
```bash
curl http://localhost:3001/api/v1
```

### 10.2 Swagger API Docs

Open: **http://localhost:3001/api/docs**

This shows all available API endpoints with request/response schemas. You can test endpoints directly from the Swagger UI.

### 10.3 Web Application

Open: **http://localhost:3000**

You should see the LIBERTASIAN landing page with features, pricing, and CTAs.

### 10.4 Login with Admin Account

1. Navigate to the login page
2. Email: `admin@libertasian.dev`
3. Password: `Admin123456!`
4. You'll be logged in with a Pro subscription and admin privileges

### 10.5 MinIO Console (Object Storage)

Open: **http://localhost:9001**
- Username: `libertasian`
- Password: `libertasian_dev_secret`

You should see two buckets: `libertasian-uploads` and `libertasian-corpus`.

### 10.6 Prisma Studio (Database Browser)

```bash
pnpm --filter @libertasian/api prisma:studio
```

Opens a visual database browser at **http://localhost:5555** where you can browse and edit all 61 tables.

### 10.7 Mobile App (Optional)

If you started the Expo dev server:
- **Android Emulator:** Press `a` in the Expo terminal
- **iOS Simulator (macOS only):** Press `i` in the Expo terminal
- **Physical device:** Scan the QR code with Expo Go app

---

## Step 11: Run Tests

```bash
# All tests across the monorepo
pnpm test

# API unit tests only
pnpm --filter @libertasian/api test

# API E2E tests (requires running infrastructure)
pnpm --filter @libertasian/api test:e2e

# Web tests (Vitest + React Testing Library)
pnpm --filter @libertasian/web test

# Mobile tests (Jest)
pnpm --filter @libertasian/mobile test

# Python service tests (run from service directory)
cd services/rag-service && python -m pytest tests/ -v
cd services/ocr-service && python -m pytest tests/ -v
```

**Current test coverage:** 1,300+ tests across API, RAG service, OCR service, and web hooks/schemas.

---

## Running Python Services Locally (Without Docker)

If you need to develop/debug Python services outside Docker:

### RAG Service

```bash
cd services/rag-service

# Install uv (Python package manager) if not installed
pip install uv

# Create virtual environment and install dependencies
uv venv
uv pip install -e ".[dev]"

# Run the service
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

### OCR Service

```bash
cd services/ocr-service

# Requires Tesseract OCR installed on your system
# Windows: download from https://github.com/UB-Mannheim/tesseract/wiki
# Mac: brew install tesseract
# Linux: apt install tesseract-ocr

uv venv
uv pip install -e ".[dev]"
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8002
```

### Worker Service (Celery)

```bash
cd services/worker-service
uv venv
uv pip install -e ".[dev]"

# Start worker
uv run celery -A src.celery_app worker --loglevel=info --concurrency=2

# Start beat scheduler (separate terminal)
uv run celery -A src.celery_app beat --loglevel=info
```

### Embedding Service

```bash
cd services/embedding-service
uv venv
uv pip install -e ".[dev]"
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8001
# First run downloads the BGE-small-en-v1.5 model (~130MB)
```

---

## Service Dependency Map

Understanding which services depend on what helps troubleshoot issues:

```
Web (Next.js :3000)
 └── API (NestJS :3001)
      ├── PostgreSQL (:5432)          — required (data store)
      ├── Redis (:6379)               — required (cache, sessions, job queues)
      ├── OpenSearch (:9200)          — optional* (search; graceful degradation)
      ├── MinIO (:9000)               — optional* (file uploads; fails on upload only)
      ├── ClamAV (:3310)             — optional (malware scan; skippable via CLAMAV_ENABLED=false)
      ├── RAG Service (:8000)         — optional* (AI answers, digests; features disabled without it)
      ├── OCR Service (:8002)         — optional* (camera scan OCR; features disabled without it)
      ├── Embedding Service (:8001)   — optional* (vector search; BM25 works without it)
      └── Worker Service              — optional* (async jobs; features degrade without it)
```

**Minimum to test basic functionality:** PostgreSQL + Redis + API + Web

**For full feature testing:** All services

---

## Minimal Startup (API + Web Only)

If you want the fastest possible startup to test basic UI and API:

```bash
# Start only PostgreSQL and Redis
docker compose up -d postgres redis

# Wait for health checks
docker compose ps

# Build types + generate Prisma client
pnpm --filter @libertasian/types build
pnpm --filter @libertasian/api prisma:generate

# Run migration (from apps/api directory)
cd apps/api
npx dotenv -e ../../.env -- npx prisma migrate dev --name init
cd ../..

# Seed database
pnpm --filter @libertasian/api seed

# Build API (first run only)
pnpm --filter @libertasian/api build

# Start API and Web (in separate terminals)
pnpm --filter @libertasian/api dev
# (in another terminal)
pnpm --filter @libertasian/web dev
```

This gives you the web UI, login, dashboard, and all CRUD operations. AI features (search, digests, OCR) won't work without the Python services and OpenSearch.

---

## Stopping Everything

```bash
# Stop Node.js apps: Ctrl+C in each terminal

# Stop Docker infrastructure
docker compose down

# Stop and remove volumes (full reset — deletes all data)
docker compose down -v
```

---

## Common Issues & Fixes

### Port already in use

```bash
# Find what's using a port (Windows)
netstat -ano | findstr :3001

# Kill the process
taskkill /PID <pid> /F
```

### API build produces empty dist/ folder

If `pnpm --filter @libertasian/api build` runs without errors but `dist/` is empty, the TypeScript incremental cache is stale:
```bash
# Delete the stale cache and rebuild
cd apps/api
rm -f tsconfig.build.tsbuildinfo
cd ../..
pnpm --filter @libertasian/api build
```

### Prisma migration drift

If schema changes and migrations get out of sync:
```bash
# Reset the database (WARNING: deletes all data)
pnpm --filter @libertasian/api prisma:migrate:dev --name reset

# Or force reset
pnpm --filter @libertasian/api prisma migrate reset
pnpm --filter @libertasian/api prisma:migrate:dev --name init
pnpm --filter @libertasian/api seed
```

### Docker out of memory

OpenSearch is memory-hungry. If Docker crashes:
1. Open Docker Desktop Settings
2. Go to Resources
3. Set Memory to at least 4 GB (6 GB recommended)
4. Restart Docker Desktop

### OpenSearch SSL certificate error

OpenSearch uses self-signed SSL by default. The API is configured to accept self-signed certs for local dev. If you see SSL errors from `curl`:
```bash
# Use -k flag to skip certificate verification
curl -k https://localhost:9200 -u admin:LibertasianDev2024!
```

### React 18/19 type errors

The mobile app uses React 18 and the web app uses React 19. If you see type errors:
- These are cosmetic — the build is configured to ignore them
- Run `pnpm type-check` to see actual type issues
- The web app has `typescript.ignoreBuildErrors: true` in `next.config.ts`

### OneDrive path casing warnings (Windows)

If you see webpack warnings about duplicate modules with different casing (`OneDrive` vs `onedrive`):
- These are cosmetic and don't affect functionality
- The web app has workarounds in place (`force-dynamic` layout, custom `_document.tsx`)

### pnpm install fails with build errors

If native dependencies fail to build:
```bash
# Ensure build tools are installed (Windows)
npm install -g windows-build-tools

# Or install Visual Studio Build Tools with C++ workload

# Then retry
pnpm install
```

### ClamAV slow startup

ClamAV downloads virus definitions on first start (~200MB). This can take 2-3 minutes. To skip for development:
```
# In .env
CLAMAV_ENABLED=false
```

---

## Quick Reference

| What | URL / Command |
|------|---------------|
| Web app | http://localhost:3000 |
| API | http://localhost:3001/api/v1 |
| Swagger docs | http://localhost:3001/api/docs |
| Prisma Studio | `pnpm --filter @libertasian/api prisma:studio` → http://localhost:5555 |
| MinIO console | http://localhost:9001 (libertasian / libertasian_dev_secret) |
| Admin login | admin@libertasian.dev / Admin123456! |
| Start all | `pnpm dev` |
| Start infra | `docker compose up -d` |
| Stop infra | `docker compose down` |
| Run all tests | `pnpm test` |
| Reset database | `pnpm --filter @libertasian/api prisma migrate reset` |

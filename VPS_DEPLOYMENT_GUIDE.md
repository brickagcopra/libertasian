# LIBERTASIAN — VPS Deployment Guide

> Complete step-by-step guide for deploying the LIBERTASIAN Legal AI Platform to a VPS
>
> Last updated: 2026-04-03

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Phase 1: VPS Provisioning & OS Hardening](#phase-1-vps-provisioning--os-hardening)
- [Phase 2: Docker & Container Infrastructure](#phase-2-docker--container-infrastructure)
- [Phase 3: DNS, SSL & Reverse Proxy](#phase-3-dns-ssl--reverse-proxy)
- [Phase 4: Environment Configuration & Secrets](#phase-4-environment-configuration--secrets)
- [Phase 5: First Production Deployment](#phase-5-first-production-deployment)
- [Phase 6: Monitoring & Observability](#phase-6-monitoring--observability)
- [Phase 7: Ongoing Operations & Maintenance](#phase-7-ongoing-operations--maintenance)
- [Appendix A: Deployment.md Requirements Mapping](#appendix-a-deploymentmd-requirements-mapping)
- [Appendix B: Production Hardening Roadmap](#appendix-b-production-hardening-roadmap)
- [Appendix C: Kubernetes Migration Path](#appendix-c-kubernetes-migration-path)
- [Appendix D: Disaster Recovery Runbook](#appendix-d-disaster-recovery-runbook)
- [Appendix E: Pre-Launch Checklist](#appendix-e-pre-launch-checklist)
- [Appendix F: Environment Variable Reference](#appendix-f-environment-variable-reference)

---

## Architecture Overview

### Production Container Topology

```
                            INTERNET
                               |
                         [ Firewall ]
                          80 / 443
                               |
                    +----------+----------+
                    |      Nginx          |  Reverse proxy, SSL termination,
                    |  (1 CPU / 256 MB)   |  rate limiting, security headers
                    +-----+----------+----+
                          |          |
               +----------+    +-----+------+
               |  Web (Next.js)|  API (NestJS)|
               | (2 CPU / 1 GB)| (4 CPU / 2 GB)|
               +---------------+---+--+--+----+
                                   |  |  |
            +----------------------+  |  +------------------+
            |                         |                     |
   +--------+--------+    +----------+---------+   +--------+---------+
   | PostgreSQL 16   |    |    Redis 7         |   |   OpenSearch     |
   | + pgvector      |    | (1 CPU / 768 MB)   |   |  (4 CPU / 3 GB)  |
   | (4 CPU / 4 GB)  |    +--------------------+   +------------------+
   +-----------------+
            |
   +--------+---------+   +-------------------+   +-------------------+
   |  MinIO (S3)      |   |  ClamAV           |   | Embedding Service |
   | (1 CPU / 512 MB) |   | (1 CPU / 1 GB)    |   | (2 CPU / 2 GB)    |
   +------------------+   +-------------------+   +-------------------+

   +-------------------+   +-------------------+   +-------------------+
   | OCR Service       |   |  RAG Service      |   | Worker Service    |
   | (2 CPU / 1 GB)    |   | (2 CPU / 2 GB)    |   | (2 CPU / 2 GB)    |
   +-------------------+   +-------------------+   +--+----------------+
                                                      |
                                                   +--+----------------+
                                                   | Worker Beat       |
                                                   | (0.5 CPU / 256 MB)|
                                                   +-------------------+

   =================== MONITORING SIDECAR ===================

   Prometheus | Grafana | Alertmanager | Loki | Promtail
   Node Exporter | cAdvisor | PG Exporter | Redis Exporter
```

### Container Inventory

| # | Container | Image | Ports (host) | Resource Limits |
|---|-----------|-------|-------------|-----------------|
| 1 | nginx | nginx:1.27-alpine | 80, 443 | 1 CPU / 256 MB |
| 2 | web | ghcr.io/.../libertasian-web | internal 3000 | 2 CPU / 1 GB |
| 3 | api | ghcr.io/.../libertasian-api | internal 3001 | 4 CPU / 2 GB |
| 4 | postgres | pgvector/pgvector:pg16 | 127.0.0.1:5432 | 4 CPU / 4 GB |
| 5 | redis | redis:7-alpine | 127.0.0.1:6379 | 1 CPU / 768 MB |
| 6 | opensearch | opensearchproject/opensearch:2.17.0 | 127.0.0.1:9200 | 4 CPU / 3 GB |
| 7 | minio | minio/minio:latest | 127.0.0.1:9000-9001 | 1 CPU / 512 MB |
| 8 | clamav | clamav/clamav:1.4 | internal 3310 | 1 CPU / 1 GB |
| 9 | ocr-service | ghcr.io/.../libertasian-ocr-service | internal 8002 | 2 CPU / 1 GB |
| 10 | rag-service | ghcr.io/.../libertasian-rag-service | internal 8000 | 2 CPU / 2 GB |
| 11 | embedding-service | ghcr.io/.../libertasian-embedding-service | internal 8001 | 2 CPU / 2 GB |
| 12 | worker-service | ghcr.io/.../libertasian-worker-service | none | 2 CPU / 2 GB |
| 13 | worker-beat | ghcr.io/.../libertasian-worker-service | none | 0.5 CPU / 256 MB |
| | **Application Total** | | | **~26.5 CPU / ~20 GB** |
| 14-21 | Monitoring stack (8 containers) | | 127.0.0.1 only | ~4.25 CPU / 3.3 GB |
| | **Grand Total** | **21 containers** | | **~31 CPU / ~23 GB** |

> **Note:** Docker resource limits are ceilings, not reservations. A 16-core VPS can run the full stack because services do not all peak simultaneously.

### What Is Already Built

All infrastructure files are in the repository:

| Component | File Path |
|-----------|-----------|
| Production Docker Compose | `docker-compose.prod.yml` |
| Monitoring Docker Compose | `infrastructure/monitoring/docker-compose.monitoring.yml` |
| Dockerfiles (6 services) | `infrastructure/docker/Dockerfile.{api,web,rag,ocr,worker,embedding}` |
| Nginx config | `infrastructure/nginx/nginx.conf` |
| Prometheus config | `infrastructure/monitoring/prometheus/prometheus.yml` |
| Alert rules | `infrastructure/monitoring/prometheus/alert-rules.yml` |
| Grafana dashboards (4) | `infrastructure/monitoring/grafana/dashboards/*.json` |
| Grafana provisioning | `infrastructure/monitoring/grafana/provisioning/` |
| DB backup script | `infrastructure/scripts/db-backup.sh` |
| DB restore script | `infrastructure/scripts/db-restore.sh` |
| CI workflow | `.github/workflows/ci.yml` |
| Staging deploy | `.github/workflows/deploy-staging.yml` |
| Production deploy | `.github/workflows/deploy-production.yml` |
| Security scanning | `.github/workflows/security-scan.yml` |
| k6 load testing | `infrastructure/k6/` |
| Env template | `.env.example` |

---

## Prerequisites

### VPS Sizing

| Tier | vCPUs | RAM | Disk | Use Case |
|------|-------|-----|------|----------|
| Minimum | 8 | 24 GB | 200 GB SSD | Staging only; services will throttle |
| **Recommended** | **16** | **32 GB** | **500 GB NVMe** | **Production with monitoring** |
| Comfortable | 32 | 64 GB | 1 TB NVMe | Production with scaling headroom |

### Required Accounts

- [ ] VPS provider account (Hetzner, DigitalOcean, Linode, Contabo, etc.)
- [ ] GitHub account with repository access (for GHCR image pulls)
- [ ] Domain name with DNS management access
- [ ] SMTP provider (for transactional email — Resend, Mailgun, AWS SES, etc.)
- [ ] Xendit account (for billing — optional, can enable later)
- [ ] Sentry account (for error tracking — optional)

### Local Machine Requirements

- Git CLI
- SSH client
- GitHub CLI (`gh`) for creating releases

---

## Phase 1: VPS Provisioning & OS Hardening

### 1.1 — Create VPS Instance

Provision a VPS with:
- **OS:** Ubuntu 24.04 LTS
- **Specs:** 16 vCPU / 32 GB RAM / 500 GB NVMe (recommended tier)
- **Location:** closest to your primary user base
- **Networking:** public IPv4, optionally IPv6

Note your server's public IP address: `YOUR_VPS_IP`.

### 1.2 — Initial SSH Access

```bash
ssh root@YOUR_VPS_IP
```

### 1.3 — Create Deploy User

```bash
# Create user with home directory
adduser deploy
# Add to sudo group
usermod -aG sudo deploy
# Copy SSH keys from root
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

### 1.4 — SSH Hardening

```bash
# Edit SSH config
sudo nano /etc/ssh/sshd_config
```

Set these values:

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
```

```bash
sudo systemctl restart sshd
```

**Test from a new terminal before closing the root session:**

```bash
ssh deploy@YOUR_VPS_IP
```

### 1.5 — Firewall (UFW)

All internal service ports (5432, 6379, 9200, 9000, 9090, 3333, etc.) are already bound to `127.0.0.1` in `docker-compose.prod.yml`. Only Nginx exposes ports 80 and 443 externally.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp       # SSH
sudo ufw allow 80/tcp       # HTTP (redirects to HTTPS)
sudo ufw allow 443/tcp      # HTTPS
sudo ufw enable
sudo ufw status verbose
```

### 1.6 — System Updates & Essential Packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
  curl wget git htop iotop ncdu unzip \
  fail2ban \
  apt-transport-https ca-certificates gnupg lsb-release \
  build-essential
```

### 1.7 — fail2ban Configuration

```bash
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

Ensure SSH jail is enabled:

```ini
[sshd]
enabled = true
port    = 22
filter  = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime  = 3600
findtime = 600
```

```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 1.8 — Swap Configuration

Important when the full stack approaches memory limits:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Set swappiness (low value = prefer RAM)
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.d/99-libertasian.conf
```

### 1.9 — Kernel Tuning

**Critical for the LIBERTASIAN stack:**

```bash
cat <<'EOF' | sudo tee /etc/sysctl.d/99-libertasian.conf
# OpenSearch requires this — container will crash without it
vm.max_map_count=262144

# Redis background save
vm.overcommit_memory=1

# File descriptors for 21+ containers with many connections
fs.file-max=65536

# Swap preference (prefer RAM)
vm.swappiness=10

# Network tuning
net.core.somaxconn=65535
net.ipv4.tcp_max_syn_backlog=65535
EOF

sudo sysctl --system
```

**Verify critical setting:**

```bash
sysctl vm.max_map_count
# Must show: vm.max_map_count = 262144
```

### 1.10 — Automatic Security Updates

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 1.11 — Verification Checklist

```bash
# Verify SSH as deploy user
ssh deploy@YOUR_VPS_IP

# Verify firewall
sudo ufw status

# Verify fail2ban
sudo fail2ban-client status sshd

# Verify kernel params
sysctl vm.max_map_count vm.overcommit_memory fs.file-max

# Verify swap
free -h
```

---

## Phase 2: Docker & Container Infrastructure

### 2.1 — Install Docker Engine

```bash
# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add deploy user to docker group
sudo usermod -aG docker deploy

# Apply group change (re-login or run)
newgrp docker
```

**Verify:**

```bash
docker --version
docker compose version
docker run hello-world
```

### 2.2 — Docker Daemon Configuration

```bash
sudo mkdir -p /etc/docker
cat <<'EOF' | sudo tee /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  },
  "live-restore": true,
  "default-address-pools": [
    { "base": "172.17.0.0/12", "size": 24 }
  ]
}
EOF

sudo systemctl restart docker
```

### 2.3 — Authenticate to GHCR

The CI/CD pipelines push images to `ghcr.io/<owner>/libertasian-<service>:<tag>`. For the VPS to pull these images:

```bash
# Create a GitHub Personal Access Token (PAT) with read:packages scope
# Then login:
echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u brick --password-stdin
```

> The deploy workflows handle this automatically. For manual deployment, the PAT is needed.

### 2.4 — Project Directory Setup

```bash
# Create project directory
sudo mkdir -p /opt/libertasian
sudo chown deploy:deploy /opt/libertasian

# Create subdirectories
mkdir -p /opt/libertasian/{backups,ssl,logs}

# Clone the repository (or pull deployment files only)
cd /opt/libertasian
git clone https://github.com/YOUR_ORG/libertasian.git .
```

### 2.5 — Docker Image Strategy

| Image | Built By | Tag Strategy | Registry |
|-------|----------|-------------|----------|
| libertasian-api | GitHub Actions | `v1.0.0`, `1.0`, `latest` | ghcr.io |
| libertasian-web | GitHub Actions | `v1.0.0`, `1.0`, `latest` | ghcr.io |
| libertasian-rag-service | GitHub Actions | `v1.0.0`, `1.0`, `latest` | ghcr.io |
| libertasian-ocr-service | GitHub Actions | `v1.0.0`, `1.0`, `latest` | ghcr.io |
| libertasian-worker-service | GitHub Actions | `v1.0.0`, `1.0`, `latest` | ghcr.io |
| libertasian-embedding-service | GitHub Actions | `v1.0.0`, `1.0`, `latest` | ghcr.io |
| nginx:1.27-alpine | Docker Hub | upstream tag | Docker Hub |
| pgvector/pgvector:pg16 | Docker Hub | upstream tag | Docker Hub |
| redis:7-alpine | Docker Hub | upstream tag | Docker Hub |
| opensearchproject/opensearch:2.17.0 | Docker Hub | upstream tag | Docker Hub |
| minio/minio:latest | Docker Hub | upstream tag | Docker Hub |
| clamav/clamav:1.4 | Docker Hub | upstream tag | Docker Hub |

**For first deployment (before CI is wired to this VPS), build locally:**

```bash
docker compose -f docker-compose.prod.yml build
```

**After CI is wired, images are pulled from GHCR:**

```bash
docker compose -f docker-compose.prod.yml pull
```

### 2.6 — Pre-Pull Base Images

Pull upstream images ahead of time to avoid timeout during first `compose up`:

```bash
docker pull nginx:1.27-alpine
docker pull pgvector/pgvector:pg16
docker pull redis:7-alpine
docker pull opensearchproject/opensearch:2.17.0
docker pull minio/minio:latest
docker pull minio/mc:latest
docker pull clamav/clamav:1.4
```

---

## Phase 3: DNS, SSL & Reverse Proxy

### 3.1 — DNS Records

Create the following DNS A records pointing to your VPS IP:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | libertasian.com | YOUR_VPS_IP | 300 |
| A | www.libertasian.com | YOUR_VPS_IP | 300 |
| A | api.libertasian.com | YOUR_VPS_IP | 300 |
| A | monitoring.libertasian.com | YOUR_VPS_IP | 300 |

> Replace `libertasian.com` with your actual domain. Update `server_name` in `infrastructure/nginx/nginx.conf` (line 61) accordingly.

**Verify DNS propagation:**

```bash
dig +short libertasian.com
# Should return YOUR_VPS_IP
```

### 3.2 — SSL with Certbot

```bash
# Install certbot
sudo apt install -y certbot

# Stop any service on port 80 temporarily
# (Nginx isn't running yet, so port 80 should be free)

# Obtain certificate (standalone mode)
sudo certbot certonly --standalone \
  -d libertasian.com \
  -d www.libertasian.com \
  -d api.libertasian.com \
  --email admin@libertasian.com \
  --agree-tos \
  --no-eff-email
```

### 3.3 — Certificate Placement

The `docker-compose.prod.yml` mounts `./infrastructure/nginx/ssl:/etc/nginx/ssl:ro`. The `nginx.conf` expects `fullchain.pem` and `privkey.pem` at `/etc/nginx/ssl/`.

```bash
# Create the ssl directory
mkdir -p /opt/libertasian/infrastructure/nginx/ssl

# Symlink certificates
sudo ln -sf /etc/letsencrypt/live/libertasian.com/fullchain.pem \
  /opt/libertasian/infrastructure/nginx/ssl/fullchain.pem
sudo ln -sf /etc/letsencrypt/live/libertasian.com/privkey.pem \
  /opt/libertasian/infrastructure/nginx/ssl/privkey.pem

# Ensure the deploy user can read the certs
sudo chmod 755 /etc/letsencrypt/live/
sudo chmod 755 /etc/letsencrypt/archive/
```

### 3.4 — Auto-Renewal Cron

```bash
# Test renewal
sudo certbot renew --dry-run

# Add renewal cron with Nginx reload hook
cat <<'EOF' | sudo tee /etc/cron.d/certbot-renew
0 3 * * * root certbot renew --quiet --deploy-hook "docker restart libertasian-nginx"
EOF
```

The Prometheus alert `CertificateExpirySoon` (in `alert-rules.yml`) fires when the certificate expires in less than 14 days, as a safety net.

### 3.5 — Nginx Configuration Review

The existing `infrastructure/nginx/nginx.conf` is production-ready with:

- HTTP to HTTPS redirect (port 80 → 443)
- TLS 1.2/1.3 with strong ciphers
- All security headers per CLAUDE.md (HSTS, CSP, X-Frame-Options DENY, etc.)
- Rate limiting: auth 10 req/min, API 300 req/min, uploads 20 req/hour
- SSE proxy for AI streaming with 300s timeout
- 50 MB upload limit
- Server tokens hidden

**Action required:** Update `server_name` on line 61 if using a different domain.

**Optional for production:** Consider restricting or password-protecting the Swagger docs endpoint at `/api/docs` (lines 122-126). Currently open to all.

---

## Phase 4: Environment Configuration & Secrets

### 4.1 — Environment Strategy

| Environment | Source | Compose File | Image Tags |
|------------|--------|-------------|------------|
| Local dev | `docker-compose.yml` | `docker-compose.yml` | local builds |
| Staging | `.env.staging` | `docker-compose.prod.yml` | `staging-{sha}` |
| Production | `.env` | `docker-compose.prod.yml` | `v1.0.0` (semver) |

### 4.2 — Generate Cryptographic Keys

**RS256 JWT Key Pair (4096-bit):**

```bash
# Generate private key
openssl genrsa -out jwt-private.pem 4096

# Extract public key
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem

# Base64 encode for .env (single-line, no newlines)
JWT_PRIVATE_KEY=$(cat jwt-private.pem | base64 -w 0)
JWT_PUBLIC_KEY=$(cat jwt-public.pem | base64 -w 0)

echo "JWT_PRIVATE_KEY=$JWT_PRIVATE_KEY"
echo "JWT_PUBLIC_KEY=$JWT_PUBLIC_KEY"
```

**AES-256-GCM Encryption Key:**

```bash
openssl rand -hex 32
# Use output as ENCRYPTION_KEY
```

**Backup Encryption Key:**

```bash
openssl rand -hex 32
# Use output as BACKUP_ENCRYPTION_KEY
```

**Internal API Key (service-to-service):**

```bash
openssl rand -hex 32
# Use for both INTERNAL_API_KEY and WORKER_INTERNAL_API_KEY (must match)
```

### 4.3 — Create Production .env

```bash
cd /opt/libertasian
cp .env.example .env
chmod 600 .env
nano .env
```

Fill in all values. Here is the complete reference with production guidance:

```bash
# ===========================================
# LIBERTASIAN — Production Environment
# ===========================================

# Core
NODE_ENV=production
APP_PORT=3001
APP_URL=https://libertasian.com
API_URL=https://api.libertasian.com

# Database (internal Docker networking)
DATABASE_URL=postgresql://libertasian:YOUR_STRONG_DB_PASSWORD@postgres:5432/libertasian?schema=public
DATABASE_READ_REPLICA_URL=postgresql://libertasian:YOUR_STRONG_DB_PASSWORD@postgres:5432/libertasian
DATABASE_POOL_SIZE=20

# PostgreSQL credentials (used by docker-compose.prod.yml)
POSTGRES_USER=libertasian
POSTGRES_PASSWORD=YOUR_STRONG_DB_PASSWORD
POSTGRES_DB=libertasian

# Redis (with password)
REDIS_URL=redis://:YOUR_STRONG_REDIS_PASSWORD@redis:6379/0
REDIS_PASSWORD=YOUR_STRONG_REDIS_PASSWORD

# OpenSearch
OPENSEARCH_URL=https://opensearch:9200
OPENSEARCH_USERNAME=admin
OPENSEARCH_PASSWORD=YOUR_STRONG_OPENSEARCH_PASSWORD

# Object Storage (MinIO — internal Docker networking)
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=YOUR_MINIO_ACCESS_KEY
S3_SECRET_KEY=YOUR_MINIO_SECRET_KEY
S3_BUCKET_UPLOADS=libertasian-uploads
S3_BUCKET_CORPUS=libertasian-corpus

# Auth (JWT) — RS256 for production
JWT_PRIVATE_KEY=BASE64_ENCODED_PRIVATE_KEY_FROM_STEP_4_2
JWT_PUBLIC_KEY=BASE64_ENCODED_PUBLIC_KEY_FROM_STEP_4_2
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800
ENCRYPTION_KEY=HEX_KEY_FROM_STEP_4_2

# Google OAuth (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://api.libertasian.com/api/v1/auth/google/callback

# SMTP
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=LIBERTASIAN <noreply@libertasian.com>

# AI Services (internal Docker networking)
VLLM_BASE_URL=http://rag-service:8000/v1
EMBEDDING_SERVICE_URL=http://embedding-service:8001
RAG_SERVICE_URL=http://rag-service:8000
OCR_SERVICE_URL=http://ocr-service:8002

# Worker Service (internal Docker networking)
WORKER_REDIS_URL=redis://:YOUR_STRONG_REDIS_PASSWORD@redis:6379/0
WORKER_CELERY_RESULT_BACKEND=redis://:YOUR_STRONG_REDIS_PASSWORD@redis:6379/1
WORKER_DATABASE_URL=postgresql://libertasian:YOUR_STRONG_DB_PASSWORD@postgres:5432/libertasian
WORKER_OCR_SERVICE_URL=http://ocr-service:8002
WORKER_S3_ENDPOINT=http://minio:9000
WORKER_S3_ACCESS_KEY=YOUR_MINIO_ACCESS_KEY
WORKER_S3_SECRET_KEY=YOUR_MINIO_SECRET_KEY
WORKER_S3_BUCKET_UPLOADS=libertasian-uploads

# Internal API Key (must match between API and Worker)
INTERNAL_API_KEY=HEX_KEY_FROM_STEP_4_2
WORKER_INTERNAL_API_KEY=HEX_KEY_FROM_STEP_4_2
WORKER_NESTJS_API_URL=http://api:3001/api/v1

# ClamAV
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
CLAMAV_TIMEOUT=30000
CLAMAV_ENABLED=true

# Billing (Xendit) — set when ready
XENDIT_SECRET_KEY=
XENDIT_WEBHOOK_CALLBACK_TOKEN=

# Monitoring
SENTRY_DSN=
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=YOUR_STRONG_GRAFANA_PASSWORD

# Backup
BACKUP_ENCRYPTION_KEY=HEX_KEY_FROM_STEP_4_2
```

> **Important:** Replace all `YOUR_STRONG_*` placeholders with actual strong passwords. Use `openssl rand -base64 32` to generate random passwords.

### 4.4 — Secure .env File Permissions

```bash
chmod 600 /opt/libertasian/.env
chown deploy:deploy /opt/libertasian/.env
```

### 4.5 — GitHub Actions Secrets

For CI/CD automated deployments, configure these secrets in your GitHub repository (Settings > Secrets and variables > Actions):

| Secret | Description |
|--------|-------------|
| `PRODUCTION_HOST` | VPS IP address |
| `PRODUCTION_USER` | `deploy` |
| `PRODUCTION_SSH_KEY` | SSH private key for the deploy user |
| `PRODUCTION_SSH_PORT` | `22` (or custom port) |
| `STAGING_HOST` | Staging VPS IP (if separate) |
| `STAGING_USER` | `deploy` |
| `STAGING_SSH_KEY` | SSH private key for staging |
| `STAGING_SSH_PORT` | `22` |

The `GITHUB_TOKEN` is automatic and handles GHCR authentication in workflows.

---

## Phase 5: First Production Deployment

### 5.1 — Pre-Flight Checklist

Before starting, verify:

- [ ] VPS provisioned and hardened (Phase 1)
- [ ] Docker installed and running (Phase 2)
- [ ] GHCR authenticated (Phase 2.3)
- [ ] Repository cloned at `/opt/libertasian` (Phase 2.4)
- [ ] DNS records pointing to VPS IP (Phase 3.1)
- [ ] SSL certificates obtained and symlinked (Phase 3.2-3.3)
- [ ] `.env` file created and secured (Phase 4.3-4.4)
- [ ] `vm.max_map_count=262144` verified (Phase 1.9)

### 5.2 — Build or Pull Images

**Option A: First deployment (build locally):**

```bash
cd /opt/libertasian
docker compose -f docker-compose.prod.yml build
```

**Option B: After CI is wired (pull from GHCR):**

```bash
docker compose -f docker-compose.prod.yml pull
```

### 5.3 — Start Infrastructure Services First

Start data stores and let them become healthy before starting application services:

```bash
cd /opt/libertasian

# Start infrastructure layer
docker compose -f docker-compose.prod.yml up -d \
  postgres redis opensearch minio clamav

# Monitor health checks
watch docker compose -f docker-compose.prod.yml ps
```

**Expected startup times:**

| Service | Healthy In | Notes |
|---------|-----------|-------|
| PostgreSQL | ~10s | Fast startup |
| Redis | ~5s | Instant |
| OpenSearch | ~30-60s | JVM warm-up |
| MinIO | ~10s | Fast startup |
| ClamAV | ~120s+ | Downloads virus definitions on first start |

Wait until ALL show `(healthy)` status. ClamAV has a `start_period: 120s` in the compose file.

### 5.4 — MinIO Bucket Initialization

The `minio-init` service runs automatically after MinIO is healthy:

```bash
docker compose -f docker-compose.prod.yml up -d minio-init

# Verify buckets were created
docker logs libertasian-minio-init
```

### 5.5 — Database Migrations

Run Prisma migrations to create all database tables:

```bash
docker compose -f docker-compose.prod.yml run --rm \
  api npx prisma migrate deploy
```

Expected output: migrations applied successfully.

### 5.6 — Seed Initial Data

Seed RBAC roles, subscription plans, legal document metadata:

```bash
docker compose -f docker-compose.prod.yml run --rm \
  api npx prisma db seed
```

### 5.7 — Start Application Services

```bash
docker compose -f docker-compose.prod.yml up -d
```

This starts all remaining services: `ocr-service`, `embedding-service`, `rag-service`, `api`, `worker-service`, `worker-beat`, `web`, `nginx`.

### 5.8 — Container Startup Order

The `docker-compose.prod.yml` dependency chain ensures correct ordering:

```
1. postgres, redis                    (no dependencies)
2. opensearch, minio, clamav          (no dependencies)
3. minio-init                         (depends: minio healthy)
4. ocr-service, embedding-service     (no app dependencies)
5. rag-service                        (depends: opensearch healthy, redis healthy)
6. api                                (depends: postgres healthy, redis healthy, clamav healthy)
7. worker-service                     (depends: redis, postgres, minio, ocr-service healthy)
8. worker-beat                        (depends: redis, postgres healthy)
9. web                                (no explicit container deps)
10. nginx                             (depends: api healthy, web healthy)
```

### 5.9 — Verify Deployment

```bash
# Check all containers are running and healthy
docker compose -f docker-compose.prod.yml ps

# Check API health
curl -s http://localhost:3001/api/v1/health | jq .

# Check Web is serving
curl -sI http://localhost:3000

# Check external HTTPS access
curl -sI https://libertasian.com
curl -s https://api.libertasian.com/api/v1/health | jq .

# Check container logs for errors
docker compose -f docker-compose.prod.yml logs --tail=50 api
docker compose -f docker-compose.prod.yml logs --tail=50 web
docker compose -f docker-compose.prod.yml logs --tail=50 nginx
```

### 5.10 — Troubleshooting Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| OpenSearch crashes immediately | `vm.max_map_count` not set | Run `sudo sysctl -w vm.max_map_count=262144` and add to `/etc/sysctl.d/99-libertasian.conf` |
| ClamAV stays "starting" for 2+ minutes | Normal behavior — downloading virus definitions | Wait for `start_period: 120s` to pass |
| API shows "connection refused" to DB | `.env` uses `localhost` instead of `postgres` | Use Docker service names: `postgres:5432`, `redis:6379`, etc. |
| Nginx returns 502 Bad Gateway | Upstream services not yet healthy | Wait for `api` and `web` to become healthy: `docker compose ps` |
| OpenSearch "authentication failed" | `OPENSEARCH_PASSWORD` mismatch | Ensure `OPENSEARCH_PASSWORD` in `.env` matches `OPENSEARCH_INITIAL_ADMIN_PASSWORD` |
| Redis "NOAUTH" errors | Redis password not set correctly | Ensure `REDIS_PASSWORD` is set in `.env` and matches URLs |
| Embedding service OOM killed | Model download fills memory | Increase memory limit or pre-download model |
| Permission denied on SSL files | Certbot files not readable | Run `sudo chmod 755 /etc/letsencrypt/live/ /etc/letsencrypt/archive/` |

---

## Phase 6: Monitoring & Observability

### 6.1 — Deploy Monitoring Stack

```bash
cd /opt/libertasian

# Start monitoring alongside production
docker compose -f docker-compose.prod.yml \
  -f infrastructure/monitoring/docker-compose.monitoring.yml \
  up -d
```

This adds 8 monitoring containers, all bound to `127.0.0.1`:

| Service | Port | Purpose |
|---------|------|---------|
| Prometheus | 127.0.0.1:9090 | Metrics collection & alerting |
| Grafana | 127.0.0.1:3333 | Dashboard visualization |
| Alertmanager | 127.0.0.1:9093 | Alert routing |
| Loki | 127.0.0.1:3100 | Log aggregation |
| Promtail | — | Log shipping |
| Node Exporter | 127.0.0.1:9100 | System metrics |
| cAdvisor | 127.0.0.1:8080 | Container metrics |
| PG Exporter | 127.0.0.1:9187 | Database metrics |
| Redis Exporter | 127.0.0.1:9121 | Cache metrics |

### 6.2 — Create Alertmanager Configuration

The monitoring compose references an Alertmanager config that needs to be created:

```bash
mkdir -p /opt/libertasian/infrastructure/monitoring/alertmanager
```

Create `infrastructure/monitoring/alertmanager/alertmanager.yml`:

```yaml
# ==========================================================================
# LIBERTASIAN — Alertmanager Configuration
# ==========================================================================

global:
  resolve_timeout: 5m

route:
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'critical'
      repeat_interval: 1h
    - match:
        severity: warning
      receiver: 'default'
      repeat_interval: 4h

receivers:
  - name: 'default'
    # Email notifications
    email_configs:
      - to: 'alerts@libertasian.com'
        from: 'alertmanager@libertasian.com'
        smarthost: 'smtp.your-provider.com:587'
        auth_username: 'your-smtp-user'
        auth_password: 'your-smtp-password'
        require_tls: true
        send_resolved: true

  - name: 'critical'
    email_configs:
      - to: 'oncall@libertasian.com'
        from: 'alertmanager@libertasian.com'
        smarthost: 'smtp.your-provider.com:587'
        auth_username: 'your-smtp-user'
        auth_password: 'your-smtp-password'
        require_tls: true
        send_resolved: true
    # Optional: Slack webhook
    # slack_configs:
    #   - api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
    #     channel: '#alerts-critical'
    #     send_resolved: true

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname']
```

Update the monitoring compose to mount this file. Add to the `alertmanager` service volumes in `docker-compose.monitoring.yml`:

```yaml
volumes:
  - ./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
  - alertmanager_data:/alertmanager
```

### 6.3 — Create Promtail Configuration

Create `infrastructure/monitoring/promtail/config.yml`:

```yaml
# ==========================================================================
# LIBERTASIAN — Promtail Configuration
# Ships container logs to Loki
# ==========================================================================

server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  # Docker container logs
  - job_name: docker
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s
    relabel_configs:
      # Use container name as label
      - source_labels: ['__meta_docker_container_name']
        regex: '/(.*)'
        target_label: 'container'
      # Add container ID
      - source_labels: ['__meta_docker_container_id']
        target_label: 'container_id'
      # Filter to libertasian containers only
      - source_labels: ['__meta_docker_container_name']
        regex: 'libertasian-.*'
        action: keep
    pipeline_stages:
      - docker: {}
      - timestamp:
          source: time
          format: RFC3339Nano

  # System logs
  - job_name: system
    static_configs:
      - targets:
          - localhost
        labels:
          job: system
          __path__: /var/log/syslog
```

Update the monitoring compose to mount this file. Add to the `promtail` service volumes:

```yaml
volumes:
  - ./promtail/config.yml:/etc/promtail/config.yml:ro
  - /var/log:/var/log:ro
  - /var/lib/docker/containers:/var/lib/docker/containers:ro
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

### 6.4 — Verify Monitoring Stack

```bash
# Check all monitoring containers
docker compose -f docker-compose.prod.yml \
  -f infrastructure/monitoring/docker-compose.monitoring.yml \
  ps

# Verify Prometheus targets (from VPS)
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets | length'
# Should show 12 targets

# Verify Grafana is accessible (from VPS)
curl -sI http://localhost:3333
```

### 6.5 — Access Grafana

Grafana is bound to `127.0.0.1:3333`. To access from your local machine, use SSH tunnel:

```bash
# From your local machine
ssh -L 3333:127.0.0.1:3333 deploy@YOUR_VPS_IP

# Then open in browser: http://localhost:3333
# Login with GRAFANA_ADMIN_USER / GRAFANA_ADMIN_PASSWORD from .env
```

**Pre-provisioned dashboards:**

| Dashboard | Content |
|-----------|---------|
| API Performance | Request rate, latency P50/P95/P99, error rate, rate limit hits, WebSocket connections, BullMQ depth |
| System Health | Service status, CPU/memory/disk per container, Redis/PostgreSQL gauges, network I/O |
| AI Pipeline | Query volume, generation latency, token usage, abstention rate, OCR metrics, ingestion pipeline, corpus size |
| k6 Load Testing | VUs, req/s, error rate, latency breakdown, AI TTFT, OCR duration, check pass rate |

### 6.6 — Alert Rules Summary

Pre-configured in `infrastructure/monitoring/prometheus/alert-rules.yml`:

| Alert | Condition | Severity |
|-------|-----------|----------|
| HighApiErrorRate | >5% 5xx for 5 min | CRITICAL |
| HighApiLatency | P95 >200ms for 5 min | WARNING |
| ApiDown | Unreachable for 1 min | CRITICAL |
| HighAiResponseTime | P95 >15s for 5 min | WARNING |
| HighAbstentionRate | >30% for 15 min | WARNING |
| OcrServiceDown / EmbeddingServiceDown | 2 min | WARNING |
| PostgresConnectionPoolExhaustion | >80% for 5 min | CRITICAL |
| PostgresDown | 1 min | CRITICAL |
| RedisHighMemory | >80% for 5 min | WARNING |
| RedisDown | 1 min | CRITICAL |
| OpenSearchClusterRed | Immediate | CRITICAL |
| HighIngestionFailureRate | >10% for 15 min | WARNING |
| HighDiskUsage | >85% for 10 min | WARNING |
| HighCpuUsage | >90% for 10 min | WARNING |
| HighMemoryUsage | >90% for 10 min | WARNING |
| CertificateExpirySoon | <14 days for 1 hour | WARNING |

---

## Phase 7: Ongoing Operations & Maintenance

### 7.1 — CI/CD Pipeline Overview

The project has 4 GitHub Actions workflows:

| Workflow | Trigger | What It Does |
|----------|---------|-------------|
| `ci.yml` | PR & push to main | Lint, typecheck, build, test |
| `deploy-staging.yml` | Push to main | Build images (tag: `staging-{sha}`), deploy via SSH |
| `deploy-production.yml` | GitHub Release (vX.Y.Z) | Validate tag, build images (semver tags), pre-deploy DB backup, deploy via SSH, health checks, rollback on failure |
| `security-scan.yml` | Weekly + PRs | npm/pip audit, Trivy container scan, CodeQL SAST, TruffleHog secrets |

**Flow:**

```
feature branch → PR → CI checks → merge to main → auto staging deploy
                                                         ↓
                                               verify on staging
                                                         ↓
                                            create GitHub Release (v1.0.0)
                                                         ↓
                                         auto production deploy with backup
```

### 7.2 — Release Process

```bash
# 1. Ensure main is up to date and staging is verified
git checkout main
git pull

# 2. Create annotated tag
git tag -a v1.0.0 -m "Release v1.0.0: Initial production deployment"
git push origin v1.0.0

# 3. Create GitHub Release (triggers deploy-production.yml)
gh release create v1.0.0 \
  --title "v1.0.0 — Initial Production Release" \
  --notes "First production deployment of LIBERTASIAN Legal AI Platform"
```

The production deploy workflow will:
1. Validate the semver tag format
2. Build 6 Docker images in parallel
3. Create a pre-deployment database backup
4. SSH to VPS: pull images, run migrations, compose up
5. Run health checks (60 attempts, 3s apart)
6. On failure: provide rollback command and create issue comment

### 7.3 — Rollback Procedure

The deploy workflow saves the current version tag to `.last-deployed-tag` and the previous to `.rollback-tag`.

**Automated rollback (from the failure message):**

```bash
ssh deploy@YOUR_VPS_IP
cd /opt/libertasian

# Read the rollback tag
ROLLBACK_TAG=$(cat .rollback-tag)
echo "Rolling back to: $ROLLBACK_TAG"

# Checkout previous version's config files
git fetch origin main --tags
git checkout "$ROLLBACK_TAG" -- docker-compose.prod.yml infrastructure/

# Pull old images
docker compose -f docker-compose.prod.yml pull

# Restart with old version
docker compose -f docker-compose.prod.yml up -d --remove-orphans

# Verify
curl -s http://localhost:3001/api/v1/health
```

**Database rollback (if migration caused issues):**

```bash
# Restore from pre-deploy backup
ls -la /opt/libertasian/backups/pre-deploy-*
bash infrastructure/scripts/db-restore.sh /opt/libertasian/backups/pre-deploy-YYYYMMDD-HHMMSS.sql.gz
```

### 7.4 — Database Backup Schedule

Set up automated daily backups:

```bash
# Create cron job
cat <<'EOF' | sudo tee /etc/cron.d/libertasian-backup
# Daily database backup at 2 AM, keep last 7, upload to MinIO
0 2 * * * deploy cd /opt/libertasian && bash infrastructure/scripts/db-backup.sh --upload --keep 7 >> /opt/libertasian/logs/backup.log 2>&1
EOF
```

**Manual backup:**

```bash
cd /opt/libertasian
bash infrastructure/scripts/db-backup.sh --upload --keep 7
```

The backup script (`infrastructure/scripts/db-backup.sh`):
- Creates a `pg_dump` in custom format (compact, restorable)
- Optionally encrypts with AES-256-CBC (if `BACKUP_ENCRYPTION_KEY` is set)
- Optionally uploads to MinIO/S3
- Rotates old backups (keeps last N)

### 7.5 — Database Restore Procedure

```bash
cd /opt/libertasian

# List available backups
ls -la backups/

# Restore (interactive — will ask for confirmation)
bash infrastructure/scripts/db-restore.sh backups/libertasian-YYYYMMDD-HHMMSS.dump
# Or for encrypted backups:
bash infrastructure/scripts/db-restore.sh backups/libertasian-YYYYMMDD-HHMMSS.dump.enc
```

The restore script:
1. Creates a pre-restore safety backup
2. Stops API, Web, and Worker services
3. Terminates existing database connections
4. Drops and recreates the database
5. Enables pgvector and uuid-ossp extensions
6. Restores from dump
7. Runs `prisma migrate deploy`
8. Restarts all services

### 7.6 — Crawler & Worker Management

Workers are isolated in separate containers (`worker-service`, `worker-beat`):

```bash
# View worker logs
docker logs -f libertasian-worker-service

# Pause ingestion (stop workers without affecting API)
docker compose -f docker-compose.prod.yml stop worker-service worker-beat

# Resume ingestion
docker compose -f docker-compose.prod.yml start worker-service worker-beat

# View queue depths (from Redis)
docker exec libertasian-redis redis-cli -a YOUR_REDIS_PASSWORD KEYS "bull:*:waiting"

# View Celery worker status
docker exec libertasian-worker-service celery -A src.celery_app inspect active
docker exec libertasian-worker-service celery -A src.celery_app inspect reserved
```

### 7.7 — Common Maintenance Commands

```bash
# View all container status
docker compose -f docker-compose.prod.yml ps

# View logs for a specific service
docker compose -f docker-compose.prod.yml logs --tail=100 -f api

# Restart a single service (no downtime for others)
docker compose -f docker-compose.prod.yml restart api

# Check disk usage
df -h
docker system df

# Prune unused images
docker image prune -f --filter "until=72h"

# Check database size
docker exec libertasian-postgres psql -U libertasian -c "SELECT pg_size_pretty(pg_database_size('libertasian'));"

# Check Redis memory
docker exec libertasian-redis redis-cli -a YOUR_REDIS_PASSWORD INFO memory | grep used_memory_human

# Check OpenSearch cluster health
curl -sk https://localhost:9200/_cluster/health -u admin:YOUR_OPENSEARCH_PASSWORD | jq .
```

### 7.8 — Load Testing

Run k6 performance tests against the deployed environment:

```bash
cd /opt/libertasian

# Seed test data (first time only)
bash infrastructure/k6/scripts/seed-test-data.sh

# Run smoke test (2 VUs, 30s — sanity check)
bash infrastructure/k6/scripts/run-smoke.sh

# Run load test (0→20→50 VUs, 5 min)
bash infrastructure/k6/scripts/run-load.sh

# Run stress test (0→50→100→200→0 VUs, 10 min)
bash infrastructure/k6/scripts/run-stress.sh
```

Results are stored in InfluxDB and viewable in the Grafana "k6 Load Testing" dashboard.

### 7.9 — Schema Migration Strategy

**Safe migration rules for production:**

1. **Expand-and-contract pattern:** Add new columns as nullable first, deploy code that handles both old and new, backfill data, then make columns required in a later release
2. **Never drop columns in the same release** that removes code reading them
3. **Pre-deployment migrations:** `ALTER TABLE ADD COLUMN`, `CREATE INDEX CONCURRENTLY` (non-blocking)
4. **Post-deployment migrations:** `ALTER TABLE DROP COLUMN`, `ALTER TABLE ALTER COLUMN SET NOT NULL` (only after code no longer uses the old column)
5. **Long-running migrations:** Run manually during maintenance windows: `CREATE INDEX CONCURRENTLY` does not lock the table

```bash
# Preview what migrations will run
docker compose -f docker-compose.prod.yml run --rm \
  api npx prisma migrate status

# Apply migrations
docker compose -f docker-compose.prod.yml run --rm \
  api npx prisma migrate deploy
```

---

## Appendix A: Deployment.md Requirements Mapping

| # | Deployment.md Section | Guide Coverage | Status |
|---|----------------------|----------------|--------|
| 1 | Production architecture overview | Architecture Overview section | COVERED |
| 2 | Environment strategy | Phase 4.1 (local/staging/production) | COVERED |
| 3 | Kubernetes deployment design | Docker Compose is primary; Appendix C for K8s migration | DOCKER COMPOSE |
| 4 | Docker image strategy | Phase 2.5, existing Dockerfiles (multi-stage, non-root) | COVERED |
| 5 | NestJS backend production hardening | Phase 5, Appendix B (gaps) | PARTIAL — see Appendix B |
| 6 | Web frontend production plan | Phase 5, nginx.conf (CDN headers, CSP, cache) | COVERED |
| 7 | React Native compatibility | Appendix B Priority 3 (API versioning) | NOT YET BUILT |
| 8 | PostgreSQL migration & backup | Phase 7.4-7.5, Phase 7.9 (expand-and-contract) | COVERED |
| 9 | Crawler & external-resource strategy | Phase 7.6 (isolated workers, pause/resume) | COVERED |
| 10 | CI/CD pipeline design | Phase 7.1-7.2, 4 GitHub Actions workflows | COVERED |
| 11 | Release & rollback strategy | Phase 7.2-7.3 (semver, rollback-tag) | COVERED |
| 12 | Observability & alerting | Phase 6 (Prometheus, Grafana, Loki, alerts) | COVERED |
| 13 | Security plan | Phase 1 (OS), Phase 3 (SSL), Phase 4 (secrets), Appendix E | COVERED |
| 14 | Disaster recovery | Phase 7.4-7.5, Appendix D | COVERED |
| 15 | Phased implementation roadmap | This entire guide (Phase 1-7) | COVERED |
| 16 | Pre-launch checklist | Appendix E | COVERED |

---

## Appendix B: Production Hardening Roadmap

### Priority 1 — Before Launch

These items are gaps in the current codebase that should be addressed before going live:

**1. Graceful Shutdown Handling**
- **File:** `apps/api/src/main.ts`
- **Gap:** No `app.enableShutdownHooks()`, no SIGTERM handler, no BullMQ queue draining
- **Impact:** Pods may lose in-flight requests and BullMQ jobs on restart
- **Note:** The Dockerfiles already use `dumb-init` which forwards signals correctly

**2. Enhanced Health Checks**
- **File:** `apps/api/src/modules/health/`
- **Gap:** Only checks PostgreSQL via `SELECT 1`. No Redis, OpenSearch, or queue health checks
- **Need:** Split into `/api/v1/health/live` (process alive) and `/api/v1/health/ready` (all dependencies up)

**3. Alertmanager Configuration**
- **Gap:** Config file not included in repo; compose references it but no file is mounted
- **Fix:** Created inline in Phase 6.2 of this guide

**4. Promtail Configuration**
- **Gap:** Same as Alertmanager — compose expects it but no config provided
- **Fix:** Created inline in Phase 6.3 of this guide

### Priority 2 — First Month After Launch

**5. Structured JSON Logging**
- Replace console-based logging with pino or winston JSON output
- Enable Promtail to parse structured fields (level, correlationId, userId)

**6. Request Correlation IDs**
- Add middleware to generate/propagate `X-Request-ID` headers
- Include in all log entries for distributed tracing

**7. BullMQ Dead-Letter Queues**
- Configure DLQ for all 15+ job types
- Alert on DLQ depth via Prometheus

### Priority 3 — Quarter 2

**8. Circuit Breaker for External Services**
- Add circuit breaker pattern (e.g., `opossum`) for OCR/RAG/embedding service calls
- Fail fast when downstream services are unhealthy

**9. API Versioning for Mobile Compatibility**
- Design `/api/v1/` vs `/api/v2/` routing strategy
- Implement deprecation headers for mobile clients on older API versions

**10. Swagger Endpoint Protection**
- Password-protect or disable `/api/docs` in production
- Currently open at `infrastructure/nginx/nginx.conf` lines 122-126

---

## Appendix C: Kubernetes Migration Path

### When to Consider Kubernetes

Migrate from Docker Compose to Kubernetes when:

- **Multiple nodes:** VPS scaling beyond a single machine
- **Auto-scaling:** Need horizontal pod autoscaling based on load
- **Team growth:** Multiple teams deploying independently
- **Zero-downtime deploys:** Need rolling updates with readiness probes (Docker Compose `rolling_update` is limited)
- **Service mesh:** Need mTLS, traffic splitting, canary deployments

### Docker Compose to Kubernetes Mapping

| Docker Compose | Kubernetes Resource |
|---------------|-------------------|
| `services:` | `Deployment` + `Service` |
| `build:` | CI/CD builds image, `Deployment` references image |
| `depends_on:` | `initContainers` + readiness probes |
| `healthcheck:` | `livenessProbe` + `readinessProbe` + `startupProbe` |
| `deploy.resources` | `resources.requests` + `resources.limits` |
| `volumes:` (named) | `PersistentVolumeClaim` |
| `ports:` | `Service` (ClusterIP/NodePort/LoadBalancer) |
| `env_file:` | `Secret` + `ConfigMap` |
| nginx | `Ingress` (nginx-ingress-controller) + cert-manager |

### Recommended Tooling

- **Kustomize** for environment overlays (dev/staging/prod)
- **cert-manager** for automatic TLS certificate management
- **NGINX Ingress Controller** as the ingress class
- **Sealed Secrets** or **External Secrets Operator** for secret management
- **Helm** for third-party chart deployments (PostgreSQL, Redis, OpenSearch)

---

## Appendix D: Disaster Recovery Runbook

### Scenario 1: Complete VPS Rebuild

1. Provision new VPS (Phase 1)
2. Install Docker (Phase 2)
3. Clone repository, restore `.env` from secure backup
4. Pull images from GHCR
5. Restore database from most recent backup in MinIO/S3
6. Start all services
7. Update DNS to point to new VPS IP
8. Verify SSL certificates (re-obtain if needed)

**RTO:** ~2 hours | **RPO:** Last backup (daily = max 24h data loss)

### Scenario 2: Database-Only Restore

```bash
cd /opt/libertasian
bash infrastructure/scripts/db-restore.sh backups/LATEST_BACKUP_FILE
```

**RTO:** ~15 minutes | **RPO:** Last backup

### Scenario 3: Single Service Failure

```bash
# Restart the failing service
docker compose -f docker-compose.prod.yml restart SERVICE_NAME

# If restart doesn't help, check logs
docker compose -f docker-compose.prod.yml logs --tail=200 SERVICE_NAME

# If image is corrupted, force recreate
docker compose -f docker-compose.prod.yml up -d --force-recreate SERVICE_NAME
```

**RTO:** ~1 minute

### Scenario 4: Full Stack Restart

```bash
cd /opt/libertasian
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

**RTO:** ~5 minutes (ClamAV warm-up is the bottleneck)

### Scenario 5: Version Rollback

```bash
cd /opt/libertasian
ROLLBACK_TAG=$(cat .rollback-tag)
git checkout "$ROLLBACK_TAG" -- docker-compose.prod.yml infrastructure/
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

If the database migration must also be reverted:

```bash
bash infrastructure/scripts/db-restore.sh backups/pre-deploy-YYYYMMDD-HHMMSS.sql.gz
```

**RTO:** ~10 minutes

### Scenario 6: Disk Full

```bash
# Identify large consumers
sudo du -sh /var/lib/docker/*
docker system df

# Prune unused images and build cache
docker system prune -af --volumes

# If PostgreSQL WAL files are large
docker exec libertasian-postgres psql -U libertasian -c "CHECKPOINT;"

# Check and rotate log files
sudo journalctl --vacuum-size=500M
```

### Scenario 7: External Service Outage (Authoritative Sites)

Worker crawl failures do not affect the API:
- Workers retry with exponential backoff
- Failed jobs remain in Redis queue
- Pause workers if needed: `docker compose stop worker-service worker-beat`
- Resume when external sites recover

---

## Appendix E: Pre-Launch Checklist

### OS & Network Security

- [ ] SSH root login disabled
- [ ] SSH password auth disabled
- [ ] UFW firewall active (only 22, 80, 443)
- [ ] fail2ban running
- [ ] Automatic security updates enabled
- [ ] All internal ports bound to 127.0.0.1 (verified in docker-compose.prod.yml)

### SSL & HTTPS

- [ ] SSL certificate obtained and valid
- [ ] Certificate symlinked to `infrastructure/nginx/ssl/`
- [ ] Auto-renewal cron configured
- [ ] HTTP redirects to HTTPS (nginx.conf line 56)
- [ ] HSTS header active (nginx.conf line 71)
- [ ] TLS 1.2/1.3 only (nginx.conf line 66)

### Application Security

- [ ] `NODE_ENV=production` in `.env`
- [ ] RS256 JWT keys configured (not HS256 dev fallback)
- [ ] Strong passwords for PostgreSQL, Redis, OpenSearch, MinIO
- [ ] `INTERNAL_API_KEY` and `WORKER_INTERNAL_API_KEY` match and are strong random values
- [ ] `ENCRYPTION_KEY` set to real AES-256-GCM key
- [ ] Nginx security headers active (CSP, X-Frame-Options DENY, etc.)
- [ ] Rate limiting active (auth, API, upload zones)
- [ ] ClamAV enabled for file upload scanning
- [ ] Server tokens hidden (nginx.conf line 34)
- [ ] `.env` file permissions: 600

### Docker Security

- [ ] All 6 custom images run as non-root (UID 1001)
- [ ] All images use multi-stage builds (minimal runtime)
- [ ] `dumb-init` used for signal handling (api, web)
- [ ] Docker log rotation configured (`daemon.json`)
- [ ] No `--privileged` flag on application containers (only cAdvisor)

### Data & Backup

- [ ] Database backup cron configured (daily at 2 AM)
- [ ] Backup encryption enabled (`BACKUP_ENCRYPTION_KEY` set)
- [ ] Test restore from backup at least once
- [ ] MinIO buckets created (`libertasian-uploads`, `libertasian-corpus`)
- [ ] Persistent volumes for postgres, redis, opensearch, minio, clamav

### Monitoring

- [ ] Prometheus scraping all 12 targets
- [ ] Grafana accessible via SSH tunnel
- [ ] Alert rules loaded (check Prometheus /rules endpoint)
- [ ] Alertmanager configured with notification receivers
- [ ] All 4 Grafana dashboards visible

### Application

- [ ] Database migrations applied (`prisma migrate deploy`)
- [ ] Seed data loaded (RBAC roles, plans, etc.)
- [ ] Health check passing: `GET /api/v1/health`
- [ ] HTTPS accessible externally
- [ ] Web frontend loads correctly
- [ ] Container health checks all passing: `docker compose ps`

---

## Appendix F: Environment Variable Reference

| Variable | Required | Example Production Value | Security |
|----------|----------|------------------------|----------|
| `NODE_ENV` | Yes | `production` | Public |
| `APP_PORT` | Yes | `3001` | Public |
| `APP_URL` | Yes | `https://libertasian.com` | Public |
| `API_URL` | Yes | `https://api.libertasian.com` | Public |
| `DATABASE_URL` | Yes | `postgresql://libertasian:PASS@postgres:5432/libertasian` | SECRET |
| `DATABASE_READ_REPLICA_URL` | No | Same as DATABASE_URL (single node) | SECRET |
| `DATABASE_POOL_SIZE` | No | `20` | Public |
| `POSTGRES_USER` | Yes | `libertasian` | Config |
| `POSTGRES_PASSWORD` | Yes | Strong random | SECRET |
| `POSTGRES_DB` | Yes | `libertasian` | Config |
| `REDIS_URL` | Yes | `redis://:PASS@redis:6379/0` | SECRET |
| `REDIS_PASSWORD` | Yes | Strong random | SECRET |
| `OPENSEARCH_URL` | Yes | `https://opensearch:9200` | Config |
| `OPENSEARCH_USERNAME` | Yes | `admin` | Config |
| `OPENSEARCH_PASSWORD` | Yes | Strong random | SECRET |
| `S3_ENDPOINT` | Yes | `http://minio:9000` | Config |
| `S3_ACCESS_KEY` | Yes | Strong random | SECRET |
| `S3_SECRET_KEY` | Yes | Strong random | SECRET |
| `S3_BUCKET_UPLOADS` | Yes | `libertasian-uploads` | Config |
| `S3_BUCKET_CORPUS` | Yes | `libertasian-corpus` | Config |
| `JWT_PRIVATE_KEY` | Yes (prod) | Base64-encoded RS256 PEM | SECRET |
| `JWT_PUBLIC_KEY` | Yes (prod) | Base64-encoded RS256 PEM | SECRET |
| `JWT_SECRET` | Dev only | — | SECRET |
| `JWT_ACCESS_TTL` | No | `900` (15 min) | Config |
| `JWT_REFRESH_TTL` | No | `604800` (7 days) | Config |
| `ENCRYPTION_KEY` | Yes | `openssl rand -hex 32` | SECRET |
| `GOOGLE_CLIENT_ID` | No | OAuth client ID | Config |
| `GOOGLE_CLIENT_SECRET` | No | OAuth secret | SECRET |
| `GOOGLE_CALLBACK_URL` | No | `https://api.libertasian.com/api/v1/auth/google/callback` | Config |
| `SMTP_HOST` | No | `smtp.resend.com` | Config |
| `SMTP_PORT` | No | `587` | Config |
| `SMTP_USER` | No | SMTP username | Config |
| `SMTP_PASS` | No | SMTP password | SECRET |
| `SMTP_FROM` | No | `LIBERTASIAN <noreply@libertasian.com>` | Config |
| `VLLM_BASE_URL` | No | `http://rag-service:8000/v1` | Config |
| `EMBEDDING_SERVICE_URL` | No | `http://embedding-service:8001` | Config |
| `RAG_SERVICE_URL` | No | `http://rag-service:8000` | Config |
| `OCR_SERVICE_URL` | No | `http://ocr-service:8002` | Config |
| `WORKER_REDIS_URL` | Yes | `redis://:PASS@redis:6379/0` | SECRET |
| `WORKER_CELERY_RESULT_BACKEND` | Yes | `redis://:PASS@redis:6379/1` | SECRET |
| `WORKER_DATABASE_URL` | Yes | `postgresql://libertasian:PASS@postgres:5432/libertasian` | SECRET |
| `WORKER_OCR_SERVICE_URL` | Yes | `http://ocr-service:8002` | Config |
| `WORKER_S3_ENDPOINT` | Yes | `http://minio:9000` | Config |
| `WORKER_S3_ACCESS_KEY` | Yes | Same as S3_ACCESS_KEY | SECRET |
| `WORKER_S3_SECRET_KEY` | Yes | Same as S3_SECRET_KEY | SECRET |
| `WORKER_S3_BUCKET_UPLOADS` | Yes | `libertasian-uploads` | Config |
| `INTERNAL_API_KEY` | Yes | `openssl rand -hex 32` | SECRET |
| `WORKER_INTERNAL_API_KEY` | Yes | Must match INTERNAL_API_KEY | SECRET |
| `WORKER_NESTJS_API_URL` | Yes | `http://api:3001/api/v1` | Config |
| `CLAMAV_HOST` | Yes | `clamav` | Config |
| `CLAMAV_PORT` | Yes | `3310` | Config |
| `CLAMAV_TIMEOUT` | No | `30000` | Config |
| `CLAMAV_ENABLED` | No | `true` | Config |
| `XENDIT_SECRET_KEY` | No | Xendit production key | SECRET |
| `XENDIT_WEBHOOK_CALLBACK_TOKEN` | No | Xendit webhook token | SECRET |
| `SENTRY_DSN` | No | Sentry project DSN URL | Config |
| `GRAFANA_ADMIN_USER` | No | `admin` | Config |
| `GRAFANA_ADMIN_PASSWORD` | Yes | Strong random | SECRET |
| `BACKUP_ENCRYPTION_KEY` | Yes | `openssl rand -hex 32` | SECRET |

---

*End of VPS Deployment Guide*

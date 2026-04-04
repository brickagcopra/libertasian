You are a senior DevOps, platform, backend, and release-engineering architect.

Your task is to prepare my existing application for safe production deployment on a live VPS-based Kubernetes environment, while also designing a long-term strategy for continuous feature delivery, safe updates, staged testing, observability, rollback, and controlled use of external authoritative resources.

My app is already built and has:
- web frontend
- React Native mobile app
- NestJS backend
- PostgreSQL
- Docker
- Kubernetes
- external integrations and crawlers that need access to real authoritative websites in order to test properly
- ongoing development even after production launch

The app must be deployed live because some workflows only work correctly when the system can gather real data from authoritative websites.

I want you to follow the best and safest industry practices for:
- going live on production
- continuous deployment after launch
- safe testing on live-connected systems
- gradual updates without downtime
- rollback if something fails
- separation of environments
- observability
- secure secrets handling
- data safety
- release safety
- Kubernetes best practices
- Docker production best practices
- backend/frontend production hardening
- mobile compatibility with continuously evolving backend APIs

==================================================
1. PRIMARY GOAL
==================================================

Design and implement a production deployment and release strategy for my app so that:

1. the app can be safely deployed on a live VPS
2. it can connect to real authoritative external websites
3. new features can continue to be developed and released after launch
4. live production remains stable during ongoing development
5. releases are safe, controlled, observable, and reversible
6. testing and staging can happen without breaking live users
7. the architecture supports continuous improvement instead of one-time deployment

==================================================
2. REQUIRED MINDSET
==================================================

You must think like a production platform engineer, not just a coder.

Your solution must prioritize:
- stability
- rollback safety
- minimal downtime
- reproducible deployments
- backward compatibility
- operational visibility
- progressive rollout
- environment isolation
- least privilege
- disaster recovery
- safe schema change strategy
- safe crawler execution
- safe background job execution

Do not propose shortcuts that are risky in production.

==================================================
3. HIGH-LEVEL STRATEGY REQUIRED
==================================================

Design the system using a professional production strategy that includes:

A. separate environments
- local
- development
- staging
- production

B. production deployment through containers and Kubernetes

C. rolling or controlled deployment strategy so live traffic is not broken during releases

D. health-check and readiness strategy so bad pods do not receive traffic

E. controlled feature rollout so unfinished features can be deployed dark or behind feature flags

F. safe schema migration strategy for PostgreSQL

G. observability stack for logs, metrics, traces, and alerts

H. secure secrets and environment configuration handling

I. CI/CD pipeline for automated build, test, release, and rollback support

J. safe background processing strategy for crawlers, jobs, queues, and workers

K. strategy for testing features that depend on real authoritative websites without destabilizing production

L. strategy for mobile app compatibility while backend evolves continuously

==================================================
4. DEPLOYMENT STRATEGY REQUIREMENTS
==================================================

Design the deployment system for a live VPS using Kubernetes and Docker.

The deployment plan must include:

- Docker image strategy
- multi-stage builds
- minimal runtime images
- environment-specific configuration
- immutable image tagging
- image registry strategy
- Kubernetes manifests or Helm/Kustomize structure
- Deployment resources
- Services
- Ingress/reverse proxy
- TLS/HTTPS
- horizontal and/or vertical scaling guidance
- readiness probes
- liveness probes
- startup probes
- resource requests and limits
- rollout strategy
- rollback strategy
- node separation if appropriate
- persistent storage strategy if needed
- worker deployment strategy
- cron job strategy
- database connectivity strategy
- zero-downtime or near-zero-downtime update approach

Do not allow production traffic to hit pods that are not fully ready.

Do not allow broken deployments to silently replace healthy ones.

==================================================
5. BACKEND PRODUCTION REQUIREMENTS
==================================================

Prepare the NestJS backend for production.

The plan must include:

- production-safe config structure
- environment variable validation
- separation of public config and secret config
- health endpoints
- readiness endpoints
- liveness endpoints
- graceful shutdown handling
- connection cleanup
- structured logging
- request correlation / request ID support
- security headers if relevant
- rate limiting if relevant
- queue/job separation if needed
- worker-safe architecture
- background task isolation from request-serving pods
- safe external crawling service design
- retry policies
- timeout policies
- circuit breaker / backoff guidance where appropriate
- idempotency for critical write flows
- versioned API strategy for frontend/mobile compatibility

The backend must support continuous release without breaking existing clients.

==================================================
6. FRONTEND PRODUCTION REQUIREMENTS
==================================================

Prepare the web frontend for production.

The plan must include:

- production build strategy
- environment-aware API configuration
- safe static asset handling
- cache strategy
- versioning strategy
- API backward compatibility requirements
- frontend feature flags
- safe rollout of new UI features
- error monitoring integration
- fallback UX for backend degradation
- deployment strategy that does not require hard downtime

==================================================
7. REACT NATIVE / MOBILE COMPATIBILITY REQUIREMENTS
==================================================

Prepare the system so the mobile app can continue working while the backend changes over time.

The strategy must include:

- backward-compatible API evolution
- mobile-safe deprecation policy
- support for old app versions for a defined window
- versioned endpoints or version negotiation where appropriate
- remote feature flags for mobile
- safe rollout of backend changes before mobile release
- no forced dependency on instant mobile app store approval for every backend release
- compatibility handling for users on older app versions

Design backend changes so that production backend can evolve without constantly breaking mobile clients.

==================================================
8. DATABASE AND MIGRATION STRATEGY
==================================================

Design a safe PostgreSQL production migration strategy.

The strategy must include:

- migration pipeline
- schema versioning
- backward-compatible database changes
- expand-and-contract migration pattern where appropriate
- no dangerous destructive migrations during live rollout
- pre-deployment migrations vs post-deployment migrations rules
- database backup strategy
- restore testing strategy
- rollback guidance
- handling of long-running migrations
- indexing strategy
- migration safety checks
- seeded admin/bootstrap data strategy
- environment-specific data separation

Do not assume that production database changes can be done unsafely.

==================================================
9. CRAWLER / EXTERNAL RESOURCE STRATEGY
==================================================

My app needs to gather data from authoritative websites, and some testing only works when connected to live external resources.

Design a safe strategy for this.

Requirements:

- separate crawler/ingestion workers from main user-facing API pods
- use queues for crawl jobs
- define rate limiting and politeness rules
- define retry and dead-letter behavior
- ensure crawler failures do not break production API
- separate crawl staging/testing jobs from user-facing production requests when possible
- maintain source provenance
- maintain structured logs for every crawl
- support dry-run mode
- support partial rollout of new crawler logic
- support sandboxed ingestion verification before publishing records to live users
- support review/quarantine if crawled data quality is poor
- prevent duplicate ingestion
- avoid letting experimental crawler changes directly corrupt production data

If real-world source access is needed, propose the safest architecture for allowing that while protecting the live system.

==================================================
10. CI/CD REQUIREMENTS
==================================================

Design a CI/CD pipeline that supports continuous updates after launch.

The pipeline must include:

- branch strategy
- build pipeline
- lint/test/typecheck pipeline
- container image build and publish
- vulnerability scanning if possible
- environment promotion flow
- staging deployment
- production deployment approval gates
- database migration step
- smoke tests
- post-deploy verification
- rollback path
- release notes or changelog support
- feature flag integration
- canary or staged rollout guidance if appropriate
- handling of hotfixes
- handling of urgent rollback
- secret-safe pipeline design

The system must support frequent feature updates even when the production app is already live.

==================================================
11. RELEASE STRATEGY REQUIREMENTS
==================================================

Design a professional release strategy.

Include:
- trunk-based or disciplined branching recommendation
- release branches if needed
- feature flags
- dark launches
- canary releases or phased rollout if realistic
- blue/green vs rolling update decision with reasoning
- rollback triggers
- release checklist
- post-release monitoring period
- safe hotfix policy
- backward compatibility rules for API and DB

The release strategy must assume that development continues continuously after go-live.

==================================================
12. OBSERVABILITY AND OPERATIONS
==================================================

Create an observability and operations plan that includes:

- centralized logs
- structured logs
- metrics
- uptime checks
- application health dashboards
- queue/job dashboards
- database health monitoring
- crawl success/failure metrics
- alerting strategy
- error tracking
- tracing if practical
- audit logs where important
- release monitoring
- SLO/SLI suggestions if appropriate

The system must make it easy to detect:
- bad deployments
- broken crawlers
- database problems
- queue backlog
- external dependency failures
- rising error rates
- performance regressions

==================================================
13. SECURITY REQUIREMENTS
==================================================

Apply production-safe security practices:

- secrets must not be hardcoded
- least-privilege service access
- environment separation
- secure ingress and HTTPS
- controlled admin access
- secure database credentials
- rotate secrets where feasible
- secure image sources
- minimal Docker runtime images
- dependency hygiene
- API security basics
- safe logging that avoids leaking secrets
- worker security isolation where needed

==================================================
14. FAILURE AND DISASTER RECOVERY
==================================================

Create a clear failure plan.

Include:
- what happens if a deployment fails
- what happens if readiness checks fail
- what happens if the database migration partially succeeds
- what happens if crawler logic malfunctions
- what happens if external authoritative sites are unavailable
- what happens if a worker queue backs up
- how to pause risky ingestion
- backup frequency guidance
- restore workflow
- manual rollback procedure
- automated rollback criteria where possible

==================================================
15. IMPLEMENTATION CONSTRAINTS
==================================================

Follow these constraints strictly:

- do not assume a one-time deployment
- do not propose editing production servers manually as the default workflow
- do not rely on ad hoc hotfixes directly on the server
- do not tightly couple crawler experiments to production user traffic
- do not break old frontend/mobile clients unnecessarily
- do not use destructive database changes without a safe migration path
- do not put all workloads in one pod if they should be separated
- do not trust environment setup without validation
- do not deploy containers without proper health checks
- do not release unfinished features without feature flags when risk exists

==================================================
16. EXPECTED OUTPUT FORMAT
==================================================

Respond with a complete, implementation-focused plan in this exact structure:

1. production architecture overview
2. environment strategy
3. Kubernetes deployment design
4. Docker image strategy
5. NestJS backend production hardening plan
6. web frontend production plan
7. React Native compatibility and release strategy
8. PostgreSQL migration and backup strategy
9. crawler and external-resource strategy
10. CI/CD pipeline design
11. release and rollback strategy
12. observability and alerting plan
13. security plan
14. disaster recovery and failure handling
15. phased implementation roadmap
16. checklist before first production launch

==================================================
17. FINAL EXPECTATION
==================================================

Your answer must be practical, safe, production-oriented, and suitable for an app that will continue evolving after launch.

Do not give generic advice only.
Give a concrete, system-level, production-ready strategy with specific implementation guidance.
Prefer stable, industry-standard operational practices over clever but risky ideas.
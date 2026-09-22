import * as Joi from 'joi';

/**
 * The single environment-variable contract for this API.
 *
 * Extracted from AppModule so that a process which must NOT boot AppModule —
 * see `modules/rbac/platform-grant-cli.module.ts` — still validates its
 * environment against exactly the same rules. Two copies of this schema would
 * drift, and the copy that drifted would be the one a bootstrap CLI runs
 * against production.
 */
export const ENV_VALIDATION_SCHEMA = Joi.object({
  // 'test' is accepted so the e2e suite can boot the real AppModule
  // under CI's NODE_ENV=test. Every NODE_ENV branch in this app tests
  // for 'production' or 'development' explicitly, so 'test' behaves as
  // a non-production, non-development environment throughout.
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),
  APP_PORT: Joi.number().default(3001),
  APP_URL: Joi.string().default('http://localhost:3000'),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().default('redis://localhost:6379/0'),
  JWT_SECRET: Joi.string().default('dev-secret-change-in-production'),
  JWT_PRIVATE_KEY_PATH: Joi.string().optional().allow(''),
  JWT_PUBLIC_KEY_PATH: Joi.string().optional().allow(''),
  JWT_PRIVATE_KEY: Joi.string().optional().allow(''),
  JWT_PUBLIC_KEY: Joi.string().optional().allow(''),
  JWT_ACCESS_TTL: Joi.number().default(900),
  JWT_REFRESH_TTL: Joi.number().default(604800),
  // Two-layer brute-force protection (LoginThrottleService) — failures-only,
  // per-account + per-IP velocity. All optional with NAT-safe defaults.
  AUTH_LOCK_ACCOUNT_THRESHOLD: Joi.number().default(10),
  AUTH_LOCK_IP_THRESHOLD: Joi.number().default(100),
  AUTH_LOCK_WINDOW_SEC: Joi.number().default(900),
  AUTH_LOCK_MAX_MIN: Joi.number().default(30),
  // Google OAuth (optional — enable by setting client ID and secret)
  GOOGLE_CLIENT_ID: Joi.string().optional().allow(''),
  GOOGLE_CLIENT_SECRET: Joi.string().optional().allow(''),
  GOOGLE_CALLBACK_URL: Joi.string().default('http://localhost:3001/api/v1/auth/google/callback'),
  // Mobile social login (ID-token exchange). Google iOS/Android client
  // IDs extend the audience allowlist for POST /auth/google/mobile;
  // APPLE_BUNDLE_ID is the audience for Apple identity tokens.
  GOOGLE_IOS_CLIENT_ID: Joi.string().optional().allow(''),
  GOOGLE_ANDROID_CLIENT_ID: Joi.string().optional().allow(''),
  APPLE_BUNDLE_ID: Joi.string().default('com.libertasian.app'),
  OPENSEARCH_URL: Joi.string().default('http://localhost:9200'),
  OPENSEARCH_USERNAME: Joi.string().optional().allow(''),
  OPENSEARCH_PASSWORD: Joi.string().optional().allow(''),
  // S3 / MinIO
  S3_ENDPOINT: Joi.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: Joi.string().default('libertasian'),
  S3_SECRET_KEY: Joi.string().default('libertasian_dev_secret'),
  S3_BUCKET_UPLOADS: Joi.string().default('libertasian-uploads'),
  // Unset keeps the previously hardcoded 'us-east-1' (MinIO ignores it,
  // but SigV4 still signs it).
  S3_REGION: Joi.string().optional(),
  // OCR Service (Python)
  OCR_SERVICE_URL: Joi.string().default('http://localhost:8002'),
  // RAG Service (Python)
  RAG_SERVICE_URL: Joi.string().default('http://localhost:8000'),
  // SMTP (optional — falls back to log-only in dev)
  SMTP_HOST: Joi.string().optional().allow(''),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().optional().allow(''),
  SMTP_PASS: Joi.string().optional().allow(''),
  SMTP_FROM: Joi.string().default('LIBERTASIAN <noreply@libertasian.com>'),
  // Billing — which gateway adapter BillingModule binds to PAYMENT_PROVIDER.
  PAYMENT_PROVIDER: Joi.string().valid('xendit', 'paymongo').default('xendit'),
  // Billing (Xendit)
  XENDIT_SECRET_KEY: Joi.string().default('xnd_development_change_me'),
  XENDIT_WEBHOOK_CALLBACK_TOKEN: Joi.string().default('callback_token_change_me'),
  // D14 mechanism C — whether the mobile client may show a purchase entry
  // point on a surface it would otherwise hide, resolved PER PLATFORM.
  //
  // BOTH DEFAULT TO FALSE AND MUST STAY THAT WAY. With them false the app
  // behaves identically to the currently approved build, which is what
  // makes it safe to submit while store products are still in review. A
  // `true` default would flip that on at deploy time and offer a purchase
  // for products that do not exist — reachable by omission, with no review
  // gate in front of it.
  //
  // Two vars, not one: an Android-approved / iOS-pending state is normal
  // during a rollout and a single flag gets it wrong for one of them. Set
  // each ONLY once that platform's products are live and approved.
  STORE_PURCHASE_AVAILABLE_IOS: Joi.boolean().default(false),
  STORE_PURCHASE_AVAILABLE_ANDROID: Joi.boolean().default(false),
  // D10a — organizations whose SANDBOX store purchases are honoured in
  // production. App Review buys in sandbox against this API; with D10
  // applied unconditionally its purchase unlocks nothing. Comma-separated
  // org uuids, EMPTY BY DEFAULT: an unset value restores plain D10, so a
  // TestFlight tester with a sandbox Apple ID can never buy free Pro.
  STORE_SANDBOX_REVIEW_ORG_IDS: Joi.string().allow('').default(''),
  // How long such a grant lasts. A sandbox subscription dies in ~30
  // minutes; honouring that would revoke the reviewer mid-review.
  STORE_SANDBOX_REVIEW_GRANT_HOURS: Joi.number().min(1).max(720).default(24),
  // Store purchases (IAP) — which conduit StorePurchasesModule binds to
  // STORE_PURCHASE_PROVIDER. Unlike PAYMENT_PROVIDER this is NOT an
  // exclusive-or with the web gateway: both run at the same time, for
  // different subscribers.
  STORE_PURCHASE_CONDUIT: Joi.string().valid('revenuecat').default('revenuecat'),
  // The value RevenueCat echoes back in the `Authorization` header. NOT an
  // HMAC key — there is no signature over the body to recompute.
  //
  // THE DEFAULT IS THE EMPTY STRING AND MUST STAY THAT WAY. An unset
  // secret makes RevenueCatService.verifyWebhookAuthorization return
  // 'invalid' for every request, so the endpoint is CLOSED when
  // unconfigured. Any non-empty default here would be a shared, published
  // credential that lets an anonymous caller move a subscription.
  REVENUECAT_WEBHOOK_AUTH_TOKEN: Joi.string().allow('').default(''),
  // Secret API key for the §9 pull path. Empty disables the nightly
  // reconciliation sweep rather than failing it once per org per night.
  REVENUECAT_API_KEY: Joi.string().allow('').default(''),
  REVENUECAT_API_URL: Joi.string().default('https://api.revenuecat.com'),
  // Billing (PayMongo)
  PAYMONGO_SECRET_KEY: Joi.string().default('sk_test_change_me'),
  PAYMONGO_WEBHOOK_SECRET: Joi.string().default('whsk_test_change_me'),
  // Replay window for the Paymongo-Signature timestamp, in seconds.
  PAYMONGO_SIGNATURE_TOLERANCE_SEC: Joi.number().default(300),
  // Instruments offered on a one-off checkout session (CSV).
  PAYMONGO_PAYMENT_METHOD_TYPES: Joi.string().default('card,gcash,paymaya,grab_pay'),
  // ClamAV
  CLAMAV_HOST: Joi.string().default('localhost'),
  CLAMAV_PORT: Joi.number().default(3310),
  CLAMAV_TIMEOUT: Joi.number().default(30000),
  CLAMAV_ENABLED: Joi.string().valid('true', 'false').default('true'),
  // Internal service-to-service API key (worker-service → NestJS)
  INTERNAL_API_KEY: Joi.string().default(''),
  // Feature flag — controls the /derivatives public (student-facing)
  // endpoints. Disabled by default; flip to 'true' in staging/prod once
  // editorial has approved a baseline batch of derivatives.
  FEATURE_DERIVATIVES_PUBLIC: Joi.string().valid('true', 'false').default('false'),
  // Feature flag — controls the public read surface for approved bar
  // exam ALAC answers. Disabled by default; flip to 'true' once a
  // baseline batch of answers has been approved by editorial.
  FEATURE_BAR_EXAM_ANSWERS_PUBLIC: Joi.string().valid('true', 'false').default('false'),
  // Kill switch for every paid-tier gate in the API. Prod runs `false`,
  // but as of 2026-09-20 the reason is no longer "no payment gateway is
  // live" — iOS 1.0.2 (build 32) has been on the App Store since
  // 2026-09-14 with four approved, purchasable IAPs, and Apple has
  // reviewed and approved a paid tier there.
  //
  // The reason now is that THIS FLAG IS GLOBAL and the other two surfaces
  // still have no rail: Android's Play billing is off pending a Google
  // payments profile, and web has no gateway at all after Xendit declined
  // the merchant activation. Flipping this would gate those users with a
  // 402 subscription_required they cannot clear — an unfulfillable demand
  // for payment, which is what got iOS build 23 rejected under App Review
  // 3.1.1. Gate iOS through `STORE_PURCHASE_AVAILABLE_IOS`, which is
  // per-platform, not through this.
  //
  // THE DEFAULT IS `false` BECAUSE THE SAFE DIRECTION MUST BE THE DEFAULT
  // DIRECTION. It used to be `true`, which meant production was compliant
  // only for as long as one line survived in one .env file. Lose that line
  // — a rebuilt environment, a new host, a deploy seeded from
  // .env.example, a container that comes up without the var — and the
  // paywall switches itself on, server-side, instantly, for every
  // installed copy of an ALREADY-APPROVED iOS binary that has no way to
  // buy anything. That is an app-removal path reachable by omission, with
  // no review gate anywhere in front of it.
  //
  // Enforcing the paywall is therefore a DELIBERATE ACT: it requires an
  // explicit `PAYWALL_ENFORCED=true` in the environment. Absence is not
  // consent. Set it on the day IAP ships, not before.
  //
  // Note that `isPaywallEnforced()` (common/config/paywall.ts) still
  // treats every non-`false` value as enforced, so a typo in an explicit
  // value cannot accidentally disable the paywall. The two rules compose:
  // an ABSENT var is off, a MALFORMED var is on.
  PAYWALL_ENFORCED: Joi.boolean().default(false),
  // Browsers only — the web read surface. Separate from PAYWALL_ENFORCED
  // because the surfaces ship on different clocks and, as of 2026-09-20,
  // are in three different states: iOS sells through approved IAPs,
  // Android is pending a Google payments profile, and web has no
  // ON-SURFACE purchase route at all (Xendit declined the merchant
  // activation). One global switch gets that wrong for whichever side it
  // is not set for.
  //
  // WHAT A GATED WEB USER'S ROUTE OUT ACTUALLY IS. Not nothing, and not a
  // web checkout: it is subscribing in the iOS app, where IAP is live and
  // selling. That route works for a gated web user who also owns an
  // iPhone. It does NOT exist for an Android owner or for someone on a
  // desktop alone — for them a gated web surface has no way out at all.
  //
  // Flipping this is therefore a deliberate PRODUCT decision about
  // whether an iOS-only purchase route is an acceptable way out for web
  // users, not an engineering blocker. The engineering is ready either
  // way. A decision to proceed was taken 2026-09-20.
  //
  // DEFAULT `false`, so this ships inert and gating the web is a
  // deliberate act, exactly like the two flags above.
  //
  // MUST BE IN THIS SCHEMA, not just read from the environment.
  // `isWebPaywallEnforced` compares with `=== true`, and only the
  // validated env-var path coerces `'true'` into a real boolean. A var
  // missing from here arrives as the STRING `'true'`, fails the
  // comparison, and the flag is silently inert — set in the environment,
  // doing nothing, with nothing in the logs to say so.
  PAYWALL_ENFORCED_WEB: Joi.boolean().default(false),
  // Search dedup post-filter: when 'true' (default), excludes
  // non-canonical duplicate documents from search results via a
  // Redis-backed must_not.terms clause. Flip to 'false' to revert
  // instantly if the filter ever over-suppresses in prod.
  SEARCH_DEDUP_FILTER_ENABLED: Joi.string().valid('true', 'false').default('true'),
  // Bootstrap the OpenSearch alias → physical index topology at boot.
  // Never destructive: it only creates missing indices and refuses to
  // touch a concrete index squatting on an alias name (see
  // OpenSearchService.ensureIndexes). Flip to 'false' to opt out.
  SEARCH_AUTO_ENSURE_INDEXES: Joi.string().valid('true', 'false').default('true'),
  // Vector dimension the embedding service emits. BAAI/bge-small-en-v1.5
  // = 384. MUST match the model or the knn_vector field rejects writes.
  EMBEDDING_DIM: Joi.number().integer().min(1).max(4096).default(384),
  // Documents per PostgreSQL page during a full index rebuild.
  SEARCH_INDEX_REBUILD_BATCH_SIZE: Joi.number().integer().min(1).max(2000).default(500),
  // Ranking v2: tiered bool.should, native collapse, intent-aware
  // clauses. Flip to 'false' to restore the legacy single-fuzzy
  // multi_match builder without a code deploy (retained one release).
  SEARCH_RANKER_V2: Joi.string().valid('true', 'false').default('true'),
  // Deepest reachable result offset (page+1)*limit. Past this the API
  // returns 400 rather than letting OpenSearch 500 on max_result_window.
  SEARCH_MAX_WINDOW: Joi.number().integer().min(20).max(10000).default(1000),
  // RRF blends BM25 and kNN only within this offset; deeper pages
  // paginate lexically so ordering stays stable.
  SEARCH_FUSION_WINDOW: Joi.number().integer().min(10).max(1000).default(100),
  // Below this top score the response is flagged meta.abstained with
  // suggestions instead of presenting weak matches as answers.
  SEARCH_MIN_SCORE: Joi.number().min(0).default(1.0),
  // function_score multipliers (CLAUDE.md: official > semi-official >
  // editorial). Recency decay is deliberately mild — landmark cases are old.
  SEARCH_BOOST_OFFICIAL: Joi.number().min(0).default(1.2),
  SEARCH_BOOST_TRUST_OFFICIAL: Joi.number().min(0).default(1.3),
  SEARCH_BOOST_TRUST_SEMI_OFFICIAL: Joi.number().min(0).default(1.15),
  SEARCH_BOOST_TRUST_EDITORIAL: Joi.number().min(0).default(1.0),
  SEARCH_RECENCY_SCALE_DAYS: Joi.number().integer().min(1).default(3650),
  SEARCH_RECENCY_DECAY: Joi.number().min(0).max(1).default(0.6),
  SEARCH_RECENCY_WEIGHT: Joi.number().min(0).default(1.1),
  // Amazon Polly (Audio Corpus Phase 1). All optional so existing envs
  // keep booting; the default AWS provider chain is used when the
  // explicit access keys are absent (e.g. IAM role in prod).
  AWS_REGION: Joi.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: Joi.string().optional().allow(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional().allow(''),
  // Default voice + engine must be consistent: 'Matthew' is a neural
  // voice that works with the default 'neural' engine.
  // Long-form voices (Gregory/Ruth/Danielle) require POLLY_ENGINE=long-form
  // — ~6× cost (~$100 vs ~$16 /1M chars).
  POLLY_VOICE_ID: Joi.string().default('Matthew'),
  POLLY_ENGINE: Joi.string()
    .valid('standard', 'neural', 'long-form', 'generative')
    .default('neural'),
  // Newscaster delivery (<amazon:domain name="news">) on the neural
  // engine. 'true' (default) wraps SSML for a news-anchor tone; 'false'
  // disables. Never applied on generative/long-form engines.
  POLLY_NEWSCASTER: Joi.string().valid('true', 'false').default('true'),
  // Self-hosted TTS. Defaults keep Polly active; flipping TTS_PROVIDER
  // to 'kokoro' is the single switch that changes backends.
  TTS_PROVIDER: Joi.string().valid('polly', 'kokoro').default('polly'),
  TTS_SERVICE_URL: Joi.string().default('http://tts-service:8003'),
  KOKORO_VOICE_ID: Joi.string().default('af_heart'),
  // Bearer token for the API → tts-service hop. OPTIONAL and unset in
  // prod, where the call never leaves the Docker network; both sides
  // no-op when it is absent, so this deploys with no coordination. It is
  // REQUIRED on both sides when the TTS host is remote (rented GPU),
  // because the endpoint is then reachable off-box.
  TTS_AUTH_TOKEN: Joi.string().optional().allow(''),
  // Wall-clock seconds per second of audio, the multiplier behind the
  // length-proportional synthesis timeout. Default 2.5 is prod's measured
  // CPU worst case with headroom; a GPU host should set ~0.25.
  KOKORO_REALTIME_FACTOR: Joi.number().positive().optional(),
  // Hard cap on one /synthesize call. Text whose budget exceeds it is
  // refused before the call rather than started and abandoned.
  KOKORO_TIMEOUT_CEILING_MS: Joi.number()
    .integer()
    .positive()
    .optional(),
  // Cap on the total mp3 bytes ONE synthesis may produce. Chunking bounds
  // how long a document may take, not how much audio it assembles in
  // memory; the largest codal encodes to ~350 MB against a 1,048 MB heap.
  // Defaults to 150 MiB in KokoroClient.
  KOKORO_MAX_OUTPUT_BYTES: Joi.number().integer().positive().optional(),
  // Reconciler. BOTH default false; tier 3 (decisions) requires BOTH.
  AUDIO_RECONCILER_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('false'),
  AUDIO_RECONCILE_DECISIONS: Joi.string()
    .valid('true', 'false')
    .default('false'),
  AUDIO_RECONCILE_BATCH: Joi.number().integer().min(1).default(200),
  AUDIO_RECONCILE_DRY_RUN: Joi.string()
    .valid('true', 'false')
    .default('false'),
  AUDIO_STORAGE_PATH: Joi.string().default('/'),
  // Must not exceed TTS_WORKERS — see AudioGenerationProcessor.
  AUDIO_PROCESSOR_CONCURRENCY: Joi.number().integer().min(1).default(2),
  // Dedicated audio bucket (Cloudflare R2). NO DEFAULTS: leaving
  // AUDIO_S3_ENDPOINT unset makes AudioStorageService delegate to the
  // shared MinIO S3Service, which is the current behaviour everywhere.
  // Private uploads and camera scans never move off MinIO.
  AUDIO_S3_ENDPOINT: Joi.string().optional(),
  AUDIO_S3_ACCESS_KEY: Joi.string().optional(),
  AUDIO_S3_SECRET_KEY: Joi.string().optional(),
  AUDIO_S3_BUCKET: Joi.string().optional(),
  AUDIO_S3_REGION: Joi.string().optional(),
});

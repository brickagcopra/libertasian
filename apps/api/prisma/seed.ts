import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { seedPlans, seedFeatureFlags } from './seeds/plan-seed';
import { seedContentDisclaimers } from './seed-disclaimers';
import { seedChartOfAccounts } from '../src/modules/accounting/constants/chart-of-accounts.seed';

const prisma = new PrismaClient();

/**
 * Main seed script for local development.
 *
 * Creates:
 * - Admin user (admin@libertasian.dev / Admin123456!)
 * - Test users (editor, reviewer, user, user2 @libertasian.com / Test123456!)
 * - Admin organization + memberships for all users
 * - Pro subscription (unlimited entitlements)
 * - Source registry entries (SC E-Library, Lawphil, Official Gazette, Congress)
 *
 * Idempotent: uses upsert / findFirst + conditional create.
 */

const ADMIN_EMAIL = 'admin@libertasian.dev';
const ADMIN_PASSWORD = 'Admin123456!';
const ADMIN_NAME = 'Dev Admin';
const ORG_NAME = 'LIBERTASIAN Dev';
const ORG_SLUG = 'libertasian-dev';

const TEST_PASSWORD = 'Test123456!';

interface TestUser {
  email: string;
  fullName: string;
  role: string;
}

const TEST_USERS: TestUser[] = [
  { email: 'editor@libertasian.com', fullName: 'Test Editor', role: 'editor' },
  { email: 'reviewer@libertasian.com', fullName: 'Test Reviewer', role: 'reviewer' },
  { email: 'user@libertasian.com', fullName: 'Test User', role: 'user' },
  { email: 'user2@libertasian.com', fullName: 'Test User 2', role: 'user' },
];

interface SourceSeed {
  name: string;
  type: string;
  domain: string;
  trustLevel: string;
  fetchStrategy: string;
  endpoints: {
    endpointUrl: string;
    contentTypeHint: string;
    parserType: string;
    scheduleCron: string;
  }[];
}

const SOURCES: SourceSeed[] = [
  {
    name: 'Supreme Court E-Library',
    type: 'official',
    domain: 'elibrary.judiciary.gov.ph',
    trustLevel: 'high',
    fetchStrategy: 'crawler',
    endpoints: [
      {
        endpointUrl:
          'https://elibrary.judiciary.gov.ph/thebookshelf/docmonth/Jan/2025/1',
        contentTypeHint: 'text/html',
        parserType: 'supreme_court_elibrary',
        scheduleCron: '0 2 * * *',
      },
    ],
  },
  {
    // NOTE: Lawphil is a long-running mirror of SC decisions. We classify it as
    // `official` / `high` trust so its docs clear truthfulness validation on the
    // same path as SC E-Library docs. See PR description for rationale — this
    // is a policy call that should be reviewed before merge.
    name: 'Lawphil',
    type: 'official',
    domain: 'lawphil.net',
    trustLevel: 'high',
    fetchStrategy: 'crawler',
    endpoints: [
      {
        endpointUrl: 'https://lawphil.net/judjuris/judjuris.html',
        contentTypeHint: 'text/html',
        parserType: 'lawphil',
        scheduleCron: '0 3 * * *',
      },
    ],
  },
  {
    name: 'Official Gazette',
    type: 'official',
    domain: 'officialgazette.gov.ph',
    trustLevel: 'high',
    fetchStrategy: 'crawler',
    endpoints: [
      {
        endpointUrl: 'https://www.officialgazette.gov.ph/section/laws/executive-issuances/',
        contentTypeHint: 'text/html',
        parserType: 'official_gazette',
        scheduleCron: '0 4 * * *',
      },
    ],
  },
  {
    name: 'Philippine Congress',
    type: 'official',
    domain: 'congress.gov.ph',
    trustLevel: 'high',
    fetchStrategy: 'crawler',
    endpoints: [
      {
        endpointUrl: 'https://www.congress.gov.ph/legisdocs/?v=ra',
        contentTypeHint: 'text/html',
        parserType: 'congress',
        scheduleCron: '0 5 * * *',
      },
    ],
  },
];

async function main() {
  console.log('Seeding development data...\n');

  // 1. Create admin user
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash, fullName: ADMIN_NAME, status: 'active', emailVerified: true },
    create: {
      email: ADMIN_EMAIL,
      passwordHash,
      fullName: ADMIN_NAME,
      status: 'active',
      emailVerified: true,
      mfaEnabled: false,
    },
  });
  console.log(`  User: ${user.email} (${user.id})`);

  // 2. Create admin organization
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { name: ORG_NAME, billingOwnerUserId: user.id },
    create: {
      name: ORG_NAME,
      slug: ORG_SLUG,
      type: 'team',
      billingOwnerUserId: user.id,
    },
  });
  console.log(`  Organization: ${org.name} (${org.id})`);

  // 3. Create organization membership
  const existingMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
  });
  if (!existingMembership) {
    await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: 'admin',
        status: 'active',
      },
    });
    console.log('  Membership: admin role created');
  } else {
    await prisma.organizationMember.update({
      where: { id: existingMembership.id },
      data: { role: 'admin', status: 'active' },
    });
    console.log('  Membership: admin role updated');
  }

  // 4. Create test users and their org memberships
  const testPasswordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  console.log('\n  Seeding test users...');
  for (const testUser of TEST_USERS) {
    const created = await prisma.user.upsert({
      where: { email: testUser.email },
      update: {
        passwordHash: testPasswordHash,
        fullName: testUser.fullName,
        status: 'active',
        emailVerified: true,
        onboardingCompletedAt: new Date(),
      },
      create: {
        email: testUser.email,
        passwordHash: testPasswordHash,
        fullName: testUser.fullName,
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        onboardingCompletedAt: new Date(),
      },
    });
    console.log(`    User: ${created.email} (${created.id}) — role: ${testUser.role}`);

    const existingTestMembership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: org.id, userId: created.id } },
    });
    if (!existingTestMembership) {
      await prisma.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: created.id,
          role: testUser.role,
          status: 'active',
        },
      });
    } else {
      await prisma.organizationMember.update({
        where: { id: existingTestMembership.id },
        data: { role: testUser.role, status: 'active' },
      });
    }
  }
  console.log(`  ${TEST_USERS.length} test users seeded.`);

  // 5. Create pro subscription
  const now = new Date();
  const oneYearLater = new Date(now);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

  const existingSub = await prisma.subscription.findFirst({
    where: { organizationId: org.id, status: 'active' },
  });
  if (!existingSub) {
    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        planCode: 'pro',
        status: 'active',
        billingPeriod: 'yearly',
        currentPeriodStart: now,
        currentPeriodEnd: oneYearLater,
        seats: 10,
        entitlementsJson: {
          searchQueries: -1,
          aiAnswers: 200,
          digestGeneration: 100,
          cameraScans: 500,
          fileUploads: 1000,
        },
      },
    });
    console.log('  Subscription: pro plan created');
  } else {
    console.log(`  Subscription: active plan already exists (${existingSub.id})`);
  }

  // 6. Seed sources and endpoints
  console.log('\n  Seeding ingestion sources...');
  for (const sourceSeed of SOURCES) {
    const existing = await prisma.source.findFirst({
      where: { name: sourceSeed.name, domain: sourceSeed.domain },
    });

    let sourceId: string;

    if (existing) {
      await prisma.source.update({
        where: { id: existing.id },
        data: {
          type: sourceSeed.type,
          trustLevel: sourceSeed.trustLevel,
          fetchStrategy: sourceSeed.fetchStrategy,
          enabled: true,
        },
      });
      sourceId = existing.id;
      console.log(`    Updated source: ${sourceSeed.name}`);
    } else {
      const created = await prisma.source.create({
        data: {
          name: sourceSeed.name,
          type: sourceSeed.type,
          domain: sourceSeed.domain,
          trustLevel: sourceSeed.trustLevel,
          fetchStrategy: sourceSeed.fetchStrategy,
          enabled: true,
        },
      });
      sourceId = created.id;
      console.log(`    Created source: ${sourceSeed.name}`);
    }

    for (const epSeed of sourceSeed.endpoints) {
      const existingEp = await prisma.sourceEndpoint.findFirst({
        where: {
          sourceId,
          parserType: epSeed.parserType,
          endpointUrl: epSeed.endpointUrl,
        },
      });

      if (existingEp) {
        await prisma.sourceEndpoint.update({
          where: { id: existingEp.id },
          data: {
            contentTypeHint: epSeed.contentTypeHint,
            scheduleCron: epSeed.scheduleCron,
            status: 'active',
          },
        });
      } else {
        await prisma.sourceEndpoint.create({
          data: {
            sourceId,
            endpointUrl: epSeed.endpointUrl,
            contentTypeHint: epSeed.contentTypeHint,
            parserType: epSeed.parserType,
            scheduleCron: epSeed.scheduleCron,
            status: 'active',
          },
        });
      }
    }
  }

  // 7. Seed plans, prices, entitlements, and feature flags
  await seedPlans(prisma);
  await seedFeatureFlags(prisma);

  // 8. Seed chart of accounts for accounting system
  await seedChartOfAccounts(prisma);

  // 8b. Seed canonical content_disclaimers rows (§8.2 / §8.6)
  console.log('\n  Seeding content disclaimers...');
  await seedContentDisclaimers(prisma);

  // 9. Seed AI settings defaults
  console.log('\n  Seeding AI settings...');
  const AI_SETTINGS_DEFAULTS = [
    {
      key: 'llm_monthly_budget_usd',
      value: { amount: 200, currency: 'USD' },
      description:
        'Monthly spending limit for OpenAI API usage. AI features are paused when this limit is reached.',
    },
    {
      key: 'llm_model',
      value: { model: 'gpt-4o-mini', provider: 'openai' },
      description: 'The LLM model used for all AI generation tasks.',
    },
    {
      key: 'llm_enabled',
      value: { enabled: true },
      description: 'Master switch to enable/disable all AI generation features.',
    },
    {
      key: 'ingestion_schedule',
      value: {
        // Global flag ON by default so scheduled ingestion runs out of the box.
        // Per-source flags are all ON — including official_gazette and congress.
        // Those two sit behind Cloudflare Turnstile today and will no-op at the
        // fetcher layer (CloudflareBlockedError recorded to errors_json), but we
        // keep their schedules enabled so we keep getting telemetry on whether
        // the block lifts. See worker-service fetchers and the PR description.
        enabled: true,
        schedules: [
          { sourceKey: 'supreme_court_elibrary', cron: '0 2 * * *', enabled: true },
          { sourceKey: 'lawphil', cron: '0 3 * * *', enabled: true },
          { sourceKey: 'official_gazette', cron: '0 4 * * *', enabled: true },
          { sourceKey: 'congress', cron: '0 5 * * *', enabled: true },
        ],
      },
      description:
        'Automatic ingestion schedule. Each source can be independently enabled with a cron expression.',
    },
    {
      key: 'ingestion_rate_limit',
      value: { max_concurrent_jobs: 2, delay_between_requests_sec: 2 },
      description: 'Rate limiting for ingestion crawlers to avoid overwhelming source servers.',
    },
  ];

  for (const setting of AI_SETTINGS_DEFAULTS) {
    await prisma.aiSettings.upsert({
      where: { key: setting.key },
      update: {},
      create: {
        key: setting.key,
        value: setting.value,
        description: setting.description,
      },
    });
    console.log(`    AI setting: ${setting.key}`);
  }

  console.log(`\nSeed complete.`);
  console.log(`  Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  Test users login: ${TEST_USERS.map((u) => u.email).join(', ')} / ${TEST_PASSWORD}`);
  console.log(`  ${SOURCES.length} sources with endpoints seeded.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

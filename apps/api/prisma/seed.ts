import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { seedPlans, seedFeatureFlags } from './seeds/plan-seed';
import { seedChartOfAccounts } from '../src/modules/accounting/constants/chart-of-accounts.seed';

const prisma = new PrismaClient();

/**
 * Main seed script for local development.
 *
 * Creates:
 * - Admin user (admin@libertasian.dev / Admin123456!)
 * - Admin organization
 * - Organization membership (admin role)
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
          'https://elibrary.judiciary.gov.ph/thebookshelf/docmonth/category/1',
        contentTypeHint: 'text/html',
        parserType: 'supreme_court_elibrary',
        scheduleCron: '0 2 * * *',
      },
    ],
  },
  {
    name: 'Lawphil',
    type: 'semi_official',
    domain: 'lawphil.net',
    trustLevel: 'medium',
    fetchStrategy: 'crawler',
    endpoints: [
      {
        endpointUrl: 'https://lawphil.net/judjuris/juri_sc.html',
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
        endpointUrl: 'https://www.officialgazette.gov.ph/section/issuances/',
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
        endpointUrl: 'https://www.congress.gov.ph/legisdocs/',
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

  // 4. Create pro subscription
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

  // 5. Seed sources and endpoints
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

  // 6. Seed plans, prices, entitlements, and feature flags
  await seedPlans(prisma);
  await seedFeatureFlags(prisma);

  // 7. Seed chart of accounts for accounting system
  await seedChartOfAccounts(prisma);

  console.log(`\nSeed complete.`);
  console.log(`  Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
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

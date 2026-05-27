/**
 * E2E Test Account Seed — Maestro mobile flows
 *
 * Idempotently creates the minimum data the Maestro smoke flows
 * (apps/mobile/.maestro/auth/login.yaml + nav/tabs.yaml from PR #192) need:
 *
 *   1. One Organization              (slug "libertasian-e2e", type "team")
 *   2. One User                      (email + bcrypt password hash from env)
 *   3. One OrganizationMember        (role "member", status "active")
 *
 * Plus a best-effort RBAC link: if the baseline `member` system RoleDefinition
 * exists (i.e. `pnpm seed:rbac` has been run against this DB), we also
 * upsert a MemberRole row so endpoints gated by RBAC permission checks accept
 * the user. The historical dev seeder skipped member_roles; without the link
 * the auth + tab-nav flows still work, but RBAC-gated endpoints will 403.
 *
 * Credentials are read from environment variables — never hardcoded:
 *
 *   E2E_TEST_EMAIL       Login email for the test account.
 *   E2E_TEST_PASSWORD    Plaintext password (bcrypt-hashed at cost 12 before
 *                        storage).
 *
 * Run against an **isolated test database** only. The caller is responsible
 * for overriding DATABASE_URL to point at libertasian_e2e (or equivalent)
 * before invoking this script. See apps/mobile/.maestro/README.md →
 * "E2E backend via ngrok" for the full runbook.
 *
 * Run: pnpm --filter api seed:e2e
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ORG_NAME = 'LIBERTASIAN E2E';
const ORG_SLUG = 'libertasian-e2e';
const ORG_TYPE = 'team';

const BCRYPT_COST = 12;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required env var: ${name}. ` +
        `Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD in your shell or the .env file ` +
        `loaded by the seed:e2e script. See apps/mobile/.maestro/README.md.`,
    );
  }
  return value;
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    LIBERTASIAN — E2E Test Account Seed          ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const email = requireEnv('E2E_TEST_EMAIL').trim().toLowerCase();
  const password = requireEnv('E2E_TEST_PASSWORD');

  console.log(`  Target DB: ${process.env['DATABASE_URL']?.replace(/:[^:@]+@/, ':***@') ?? '(unset)'}`);
  console.log(`  Test email: ${email}\n`);

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // 1. User — upsert by unique email.
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      status: 'active',
      emailVerified: true,
      onboardingCompletedAt: new Date(),
    },
    create: {
      email,
      passwordHash,
      fullName: 'E2E Test User',
      status: 'active',
      emailVerified: true,
      mfaEnabled: false,
      onboardingCompletedAt: new Date(),
    },
  });
  console.log(`  User:          ${user.email} (${user.id})`);

  // 2. Organization — upsert by unique slug. Wire billingOwner to the test
  //    user so the org has a coherent owner; the maestro flows do not exercise
  //    billing surface area, but keeping the FK populated mirrors seed.ts.
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { name: ORG_NAME, billingOwnerUserId: user.id },
    create: {
      name: ORG_NAME,
      slug: ORG_SLUG,
      type: ORG_TYPE,
      billingOwnerUserId: user.id,
    },
  });
  console.log(`  Organization:  ${org.name} (${org.id})`);

  // 3. OrganizationMember — mandatory for tenant scoping. The Prisma tenant
  //    middleware injects `WHERE organization_id = ?` from membership, so
  //    without this row every tenant-scoped query returns empty.
  const existingMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
  });
  if (existingMembership) {
    await prisma.organizationMember.update({
      where: { id: existingMembership.id },
      data: { role: 'member', status: 'active' },
    });
    console.log(`  Membership:    member (updated, ${existingMembership.id})`);
  } else {
    const created = await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: 'member',
        status: 'active',
      },
    });
    console.log(`  Membership:    member (created, ${created.id})`);
  }

  const membership = await prisma.organizationMember.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
  });

  // 4. Best-effort RBAC link. The baseline `member` RoleDefinition is seeded
  //    by `pnpm seed:rbac` as a system-wide role (organizationId = null,
  //    isSystem = true). If it hasn't been seeded against this DB yet, we
  //    skip with a warning rather than failing — auth + tab-nav flows do not
  //    strictly require it, but RBAC-permission-gated endpoints will return
  //    403 without it.
  const memberRoleDef = await prisma.roleDefinition.findFirst({
    where: { slug: 'member', isSystem: true, organizationId: null },
  });

  if (memberRoleDef) {
    const existingLink = await prisma.memberRole.findUnique({
      where: {
        organizationMemberId_roleDefinitionId: {
          organizationMemberId: membership.id,
          roleDefinitionId: memberRoleDef.id,
        },
      },
    });
    if (!existingLink) {
      await prisma.memberRole.create({
        data: {
          organizationMemberId: membership.id,
          roleDefinitionId: memberRoleDef.id,
          assignedByUserId: null,
          expiresAt: null,
        },
      });
      console.log(`  RBAC link:     member RoleDefinition attached`);
    } else {
      console.log(`  RBAC link:     member RoleDefinition already attached`);
    }
  } else {
    console.warn(
      `  RBAC link:     SKIPPED — system "member" RoleDefinition not found. ` +
        `If RBAC-gated endpoints 403 during E2E, run "pnpm --filter api seed:rbac" first.`,
    );
  }

  console.log('\n  Seed complete.\n');
  console.log('  Maestro flows can now sign in with:');
  console.log(`    MAESTRO_TEST_EMAIL=${email}`);
  console.log('    MAESTRO_TEST_PASSWORD=<value from $E2E_TEST_PASSWORD>\n');
}

main()
  .catch((e) => {
    console.error('\nE2E seed failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

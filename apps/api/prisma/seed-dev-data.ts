/**
 * Dev Data Seed Orchestrator
 *
 * Populates all 12 features with realistic Philippine legal data.
 * Requires base seeds to have run first (admin user, org, sources, bar subjects, pleading templates).
 *
 * Run: pnpm --filter api seed:dev
 *
 * Execution order:
 *   1. Validate prerequisites
 *   2. Dev users (editor, member, student)
 *   3. Legal documents (5 docs + sections + versions + citations)
 *   4. Digests + provenance records        (Phase 2)
 *   5. Camera scans + OCR results          (Phase 2)
 *   6. Study mode (flashcards, reviewers)  (Phase 3)
 *   7. Workspace (matters, tasks, notes)   (Phase 4)
 *   8. AI features (memos, comparisons)    (Phase 4)
 *   9. RBAC (permissions, roles, hierarchy) + backfill existing roles
 */

import { PrismaClient } from '@prisma/client';
import { seedDevUsers, SeededUsers } from './seeds/dev-users';
import { seedLegalDocuments, SeededDocuments } from './seeds/legal-documents';
import { seedDigests, SeededDigests } from './seeds/digests-data';
import { seedScans, SeededScans } from './seeds/scans-data';
import { seedStudyData, SeededStudyData } from './seeds/study-data';
import { seedWorkspaceData, SeededWorkspace } from './seeds/workspace-data';
import { seedAiFeatures, SeededAiFeatures } from './seeds/ai-features-data';
import { seedRbac, SeededRbac } from './seeds/rbac-seed';
import { migrateExistingRolesToRbac, MigratedRoles } from './seeds/rbac-migrate-existing-roles';

const prisma = new PrismaClient();

async function validatePrerequisites(): Promise<void> {
  console.log('=== Validating prerequisites ===');

  // Check admin user exists
  const admin = await prisma.user.findUnique({ where: { email: 'admin@libertasian.dev' } });
  if (!admin) {
    throw new Error('Admin user not found. Run: pnpm --filter api seed');
  }
  console.log('  Admin user: OK');

  // Check organization exists
  const org = await prisma.organization.findUnique({ where: { slug: 'libertasian-dev' } });
  if (!org) {
    throw new Error('Organization not found. Run: pnpm --filter api seed');
  }
  console.log('  Organization: OK');

  // Check sources exist
  const sourceCount = await prisma.source.count();
  if (sourceCount === 0) {
    throw new Error('No sources found. Run: pnpm --filter api seed:sources');
  }
  console.log(`  Sources: ${sourceCount} found`);

  // Check bar subjects exist
  const tagCount = await prisma.legalMetadataTag.count({ where: { tagType: 'bar_subject' } });
  if (tagCount === 0) {
    throw new Error('No bar subject tags found. Run: pnpm --filter api seed:bar-subjects');
  }
  console.log(`  Bar subjects: ${tagCount} found`);

  console.log('  All prerequisites satisfied.\n');
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    LIBERTASIAN — Dev Data Seed                  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  await validatePrerequisites();

  // Phase 1: Users + Legal Documents
  const users: SeededUsers = await seedDevUsers(prisma);
  const docs: SeededDocuments = await seedLegalDocuments(prisma);

  // Phase 2: Digests + Scans
  const digests: SeededDigests = await seedDigests(prisma, users, docs);
  const scans: SeededScans = await seedScans(prisma, users, digests);

  // Phase 3: Study mode
  const study: SeededStudyData = await seedStudyData(prisma, users, docs, digests);

  // Phase 4: Workspace + AI features
  const workspace: SeededWorkspace = await seedWorkspaceData(prisma, users, docs, scans);
  const aiFeatures: SeededAiFeatures = await seedAiFeatures(prisma, users, docs, workspace);

  // Phase 5: RBAC — permissions, roles, hierarchy, constraints + backfill
  const rbac: SeededRbac = await seedRbac(prisma);
  const migrated: MigratedRoles = await migrateExistingRolesToRbac(prisma);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║    Dev data seed complete!                      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\n  Users:');
  console.log(`    admin:   admin@libertasian.dev / Admin123456!`);
  console.log(`    editor:  editor@libertasian.dev / Editor123456!`);
  console.log(`    member:  member@libertasian.dev / Member123456!`);
  console.log(`    student: student@libertasian.dev / Student123456!`);
  console.log(`\n  Documents: 5 legal documents (53 sections, 8 citations)`);
  console.log(`  Digests:   6 digests + provenance + reviews + doctrine extracts`);
  console.log(`  Scans:     4 camera scans + OCR results + processing jobs`);
  console.log(`  Study:     3 flashcard sets (25 cards) + 2 reviewer packs + streaks`);
  console.log(`  Workspace: 3 matters + 6 tasks + 5 notes + 4 bookmarks + 4 annotations`);
  console.log(`  AI:        2 memos + 1 comparison + 2 pleadings + 1 timeline + 1 hearing prep`);
  console.log(`  RBAC:      ${rbac.permissionCount} permissions, ${rbac.roleCount} roles, ${rbac.rolePermissionCount} mappings, ${rbac.hierarchyEdgeCount} hierarchy edges, ${rbac.constraintCount} constraints`);
  console.log(`  Migration: ${migrated.created} member→role assignments backfilled`);
  console.log(`  Verify: pnpm --filter api prisma:studio\n`);
}

main()
  .catch((e) => {
    console.error('\nDev seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

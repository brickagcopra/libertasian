/**
 * Standalone RBAC seed runner.
 *
 * Usage: pnpm --filter api seed:rbac
 *
 * Safe to run on prod — seeds are idempotent (upsert-based).
 * Also reconciles the legacy 'system-admin' role slug to 'admin'.
 */
import { PrismaClient } from '@prisma/client';
import { seedRbac } from './seeds/rbac-seed';

const prisma = new PrismaClient();

seedRbac(prisma)
  .then((result) => {
    console.log('\nRBAC seed result:', JSON.stringify(result, null, 2));
  })
  .catch((e) => {
    console.error('RBAC seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

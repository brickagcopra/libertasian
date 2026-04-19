import { PrismaClient } from '@prisma/client';
import { seedPlans } from './seeds/plan-seed';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding plans...');
  await seedPlans(prisma);
  console.log('Plans seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

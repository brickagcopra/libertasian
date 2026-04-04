/**
 * Seed script for pleading templates.
 * Run: pnpm --filter api seed:pleading-templates
 */

import { PrismaClient } from '@prisma/client';
import { pleadingTemplates } from './seeds/pleading-templates';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding pleading templates...');

  for (const template of pleadingTemplates) {
    const existing = await prisma.pleadingTemplate.findUnique({
      where: { slug: template.slug },
    });

    if (existing) {
      // Update existing template
      await prisma.pleadingTemplate.update({
        where: { slug: template.slug },
        data: {
          name: template.name,
          category: template.category,
          court: template.court ?? null,
          description: template.description,
          templateJson: template.templateJson,
          isActive: true,
        },
      });
      console.log(`  Updated: ${template.name} (${template.slug})`);
    } else {
      // Create new template
      await prisma.pleadingTemplate.create({
        data: {
          name: template.name,
          slug: template.slug,
          category: template.category,
          court: template.court ?? null,
          description: template.description,
          templateJson: template.templateJson,
          isActive: true,
        },
      });
      console.log(`  Created: ${template.name} (${template.slug})`);
    }
  }

  console.log(`\nDone! ${pleadingTemplates.length} templates seeded.`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

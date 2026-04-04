import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BAR_SUBJECTS = [
  { code: 'civil_law', name: 'Civil Law', tagType: 'bar_subject' },
  { code: 'commercial_law', name: 'Commercial Law', tagType: 'bar_subject' },
  { code: 'criminal_law', name: 'Criminal Law', tagType: 'bar_subject' },
  { code: 'labor_law', name: 'Labor Law', tagType: 'bar_subject' },
  { code: 'political_law', name: 'Political Law', tagType: 'bar_subject' },
  { code: 'public_international_law', name: 'Public International Law', tagType: 'bar_subject' },
  { code: 'remedial_law', name: 'Remedial Law', tagType: 'bar_subject' },
  { code: 'taxation_law', name: 'Taxation Law', tagType: 'bar_subject' },
  { code: 'legal_ethics', name: 'Legal and Judicial Ethics', tagType: 'bar_subject' },
] as const;

const EXTENDED_SUBJECTS = [
  { code: 'environmental_law', name: 'Environmental Law', tagType: 'subject' },
  { code: 'family_law', name: 'Family Law', tagType: 'subject' },
  { code: 'property_law', name: 'Property Law', tagType: 'subject' },
  { code: 'administrative_law', name: 'Administrative Law', tagType: 'subject' },
  { code: 'constitutional_law', name: 'Constitutional Law', tagType: 'subject' },
] as const;

async function main() {
  console.log('Seeding bar subjects...');

  for (const subject of BAR_SUBJECTS) {
    await prisma.legalMetadataTag.upsert({
      where: { code: subject.code },
      update: { name: subject.name, tagType: subject.tagType },
      create: { code: subject.code, name: subject.name, tagType: subject.tagType },
    });
    console.log(`  Upserted: ${subject.code} → ${subject.name}`);
  }

  console.log(`Done. ${BAR_SUBJECTS.length} bar subjects seeded.`);

  console.log('Seeding extended subject tags...');

  for (const subject of EXTENDED_SUBJECTS) {
    await prisma.legalMetadataTag.upsert({
      where: { code: subject.code },
      update: { name: subject.name, tagType: subject.tagType },
      create: { code: subject.code, name: subject.name, tagType: subject.tagType },
    });
    console.log(`  Upserted: ${subject.code} → ${subject.name}`);
  }

  console.log(`Done. ${EXTENDED_SUBJECTS.length} extended subjects seeded.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

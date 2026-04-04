import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed ingestion sources and their endpoints.
 *
 * Source model has no unique constraint on `name`, so we use
 * findFirst + conditional create/update instead of upsert.
 */

interface SourceSeed {
  name: string;
  type: string;
  domain: string;
  trustLevel: string;
  fetchStrategy: string;
  endpoints: EndpointSeed[];
}

interface EndpointSeed {
  endpointUrl: string;
  contentTypeHint: string;
  parserType: string;
  scheduleCron: string;
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
        endpointUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/docmonth/category/1',
        contentTypeHint: 'text/html',
        parserType: 'supreme_court_elibrary',
        scheduleCron: '0 2 * * *', // daily at 2 AM
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
        scheduleCron: '0 3 * * *', // daily at 3 AM
      },
    ],
  },
];

async function main() {
  console.log('Seeding ingestion sources...');

  for (const sourceSeed of SOURCES) {
    // Find existing by name + domain (closest to unique identity)
    const existing = await prisma.source.findFirst({
      where: { name: sourceSeed.name, domain: sourceSeed.domain },
    });

    let sourceId: string;

    if (existing) {
      // Update existing source
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
      console.log(`  Updated source: ${sourceSeed.name} (${sourceId})`);
    } else {
      // Create new source
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
      console.log(`  Created source: ${sourceSeed.name} (${sourceId})`);
    }

    // Seed endpoints for this source
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
        console.log(`    Updated endpoint: ${epSeed.parserType} (${existingEp.id})`);
      } else {
        const createdEp = await prisma.sourceEndpoint.create({
          data: {
            sourceId,
            endpointUrl: epSeed.endpointUrl,
            contentTypeHint: epSeed.contentTypeHint,
            parserType: epSeed.parserType,
            scheduleCron: epSeed.scheduleCron,
            status: 'active',
          },
        });
        console.log(`    Created endpoint: ${epSeed.parserType} (${createdEp.id})`);
      }
    }
  }

  console.log(`Done. ${SOURCES.length} sources seeded.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

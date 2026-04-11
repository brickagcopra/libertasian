import {
  BadRequestException,
  ConflictException,
  INestApplication,
  Module,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { DerivativeArtifactModule } from '../src/modules/derivative-artifact/derivative-artifact.module';
import { DerivativeArtifactService } from '../src/modules/derivative-artifact/derivative-artifact.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedContentDisclaimers } from '../prisma/seed-disclaimers';

/**
 * End-to-end integration test for the §2.2 / §4.5 foundation: writing a
 * `DerivativeArtifact` through `DerivativeArtifactService.create` against
 * a real PostgreSQL instance.
 *
 * Uses a minimal test module (not AppModule) because no production
 * controller exposes this service yet — the derivative generation
 * pipeline lands with later PRs. Seeds the content_disclaimers table via
 * the same helper used by the content-disclaimers e2e suite, then creates
 * a fresh Source + LegalDocument + LegalDocumentSection per test run so
 * the §2.2 `@@unique([sourceDocumentId, derivativeType, taxonomyVersion])`
 * constraint can be exercised deterministically.
 *
 * Requires a running PostgreSQL with all migrations applied (the standard
 * `docker compose up -d postgres` + `pnpm --filter api prisma:migrate:dev`).
 */

@Module({
  imports: [PrismaModule, DerivativeArtifactModule],
})
class TestAppModule {}

describe('DerivativeArtifact write path (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: DerivativeArtifactService;

  // Per-run fixture ids
  let sourceId: string;
  let legalDocumentId: string;
  let legalDocumentSectionId: string;
  let disclaimerId: string;
  let runTag: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    service = moduleFixture.get(DerivativeArtifactService);

    // Seed content_disclaimers idempotently.
    await seedContentDisclaimers(prisma);
    const disclaimer = await prisma.contentDisclaimer.findUnique({
      where: { contentClass: 'ai_digest' },
    });
    if (!disclaimer) {
      throw new Error(
        'ai_digest disclaimer missing after seed — migration not applied?',
      );
    }
    disclaimerId = disclaimer.id;

    // Create fresh fixture rows scoped to this run so no cleanup drift
    // between test files can interfere.
    runTag = `derivative-artifact-e2e-${Date.now()}`;
    const source = await prisma.source.create({
      data: {
        name: `${runTag} source`,
        type: 'test',
      },
    });
    sourceId = source.id;

    const doc = await prisma.legalDocument.create({
      data: {
        sourceId,
        documentType: 'case',
        title: `${runTag} decision`,
        citationText: `${runTag} G.R. No. 999999`,
        jurisdiction: 'PH',
      },
    });
    legalDocumentId = doc.id;

    const section = await prisma.legalDocumentSection.create({
      data: {
        legalDocumentId,
        sectionType: 'body',
        sectionLabel: 'Facts',
        ordering: 1,
        plainText: 'On a date certain, petitioner filed a complaint...',
      },
    });
    legalDocumentSectionId = section.id;
  });

  afterAll(async () => {
    // Tear down everything we created in reverse FK order. Use the tag
    // match on the Source name so repeated test runs do not accumulate.
    await prisma.provenanceRecord.deleteMany({
      where: { sourceDocumentId: legalDocumentId },
    });
    await prisma.derivativeArtifact.deleteMany({
      where: { sourceDocumentId: legalDocumentId },
    });
    await prisma.legalDocumentSection.deleteMany({
      where: { legalDocumentId },
    });
    await prisma.legalDocument.deleteMany({ where: { id: legalDocumentId } });
    await prisma.source.deleteMany({ where: { id: sourceId } });
    await app.close();
  });

  const baseDto = () => ({
    derivativeType: 'case_digest' as const,
    sourceDocumentId: legalDocumentId,
    sourceSectionId: legalDocumentSectionId,
    title: `${runTag} case digest`,
    contentJson: {
      factsHtml: '<p>On a date certain, petitioner filed a complaint.</p>',
      issuesHtml: '<p>Whether respondent breached the contract.</p>',
      rulingHtml: '<p>Yes.</p>',
    },
    contentHash: `sha256:${runTag}:digest:v1`,
    contentRights: 'ai_generated_derivative' as const,
    contentDisclaimerId: disclaimerId,
    provenanceRecords: [
      {
        sourceDocumentId: legalDocumentId,
        sourceSectionId: legalDocumentSectionId,
        provenanceType: 'source_passage' as const,
      },
    ],
  });

  it('writes a DerivativeArtifact row with its provenance rows in one transaction', async () => {
    const artifact = await service.create(baseDto());

    expect(artifact.id).toBeDefined();
    expect(artifact.derivativeType).toBe('case_digest');
    expect(artifact.sourceDocumentId).toBe(legalDocumentId);
    expect(artifact.contentDisclaimerId).toBe(disclaimerId);
    expect(artifact.reviewStatus).toBe('draft');
    expect(artifact.visibility).toBe('private');
    expect(artifact.audience).toBe('both');
    expect(artifact.language).toBe('en');

    // Verify the provenance row hit the DB.
    const provRows = await prisma.provenanceRecord.findMany({
      where: { entityType: 'derivative_artifact', entityId: artifact.id },
    });
    expect(provRows).toHaveLength(1);
    expect(provRows[0].sourceDocumentId).toBe(legalDocumentId);
    expect(provRows[0].sourceSectionId).toBe(legalDocumentSectionId);
    expect(provRows[0].provenanceType).toBe('source_passage');

    // Verify the non-null disclaimer FK join returns the seeded row.
    const joined = await prisma.derivativeArtifact.findUnique({
      where: { id: artifact.id },
      include: { contentDisclaimer: true },
    });
    expect(joined).not.toBeNull();
    expect(joined!.contentDisclaimer).not.toBeNull();
    expect(joined!.contentDisclaimer.contentClass).toBe('ai_digest');
    expect(joined!.contentDisclaimer.isActive).toBe(true);

    // Clean up this row so the later unique-constraint test can reuse the
    // same (sourceDocumentId, derivativeType, taxonomyVersion=NULL) triple.
    // NOTE: PostgreSQL treats NULL as distinct in unique constraints, so
    // two rows with taxonomyVersion=NULL do NOT actually collide. We use
    // an explicit `taxonomy_version` in the unique-constraint test below
    // to exercise the constraint deterministically.
    await prisma.provenanceRecord.deleteMany({
      where: { entityId: artifact.id },
    });
    await prisma.derivativeArtifact.delete({ where: { id: artifact.id } });
  });

  it('rejects writes with an empty provenanceRecords array (§4.5)', async () => {
    await expect(
      service.create({ ...baseDto(), provenanceRecords: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects writes with an unknown contentDisclaimerId (§2.5 / §8.6)', async () => {
    await expect(
      service.create({
        ...baseDto(),
        contentDisclaimerId: '00000000-0000-0000-0000-00000000dead',
      }),
    ).rejects.toThrow(NotFoundException);

    // Defence check: no orphan artifact was written by the failed attempt.
    const count = await prisma.derivativeArtifact.count({
      where: { sourceDocumentId: legalDocumentId },
    });
    expect(count).toBe(0);
  });

  it('enforces @@unique([sourceDocumentId, derivativeType, taxonomyVersion]) via ConflictException', async () => {
    const dto = { ...baseDto(), taxonomyVersion: 'study_8' as const };

    const first = await service.create(dto);
    expect(first.taxonomyVersion).toBe('study_8');

    await expect(service.create(dto)).rejects.toThrow(ConflictException);

    // Only one row persisted.
    const rows = await prisma.derivativeArtifact.findMany({
      where: {
        sourceDocumentId: legalDocumentId,
        derivativeType: 'case_digest',
        taxonomyVersion: 'study_8',
      },
    });
    expect(rows).toHaveLength(1);

    // Clean up so the afterAll teardown is idempotent.
    await prisma.provenanceRecord.deleteMany({
      where: { entityId: first.id },
    });
    await prisma.derivativeArtifact.delete({ where: { id: first.id } });
  });
});

import { INestApplication, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { DerivativeArtifactModule } from '../src/modules/derivative-artifact/derivative-artifact.module';
import { DerivativeArtifactService } from '../src/modules/derivative-artifact/derivative-artifact.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedContentDisclaimers } from '../prisma/seed-disclaimers';

/**
 * End-to-end integration test for the MCQ child tables landed in this
 * PR: writing one `DerivativeArtifact` + one `McqQuestion` + four
 * `McqOption` rows through `DerivativeArtifactService.createMcqQuestion`
 * against a real PostgreSQL instance.
 *
 * Minimal test module (not AppModule) because no production controller
 * is wired to this path yet — §5.3 generation pipeline lands in Phase 5.
 * Seeds content_disclaimers via the same helper as the content-disclaimers
 * suite (picks up the `ai_mcq` row from b40d170), then creates a fresh
 * Source + LegalDocument + LegalDocumentSection per run so the §2.2
 * `@@unique([sourceDocumentId, derivativeType, taxonomyVersion])` and
 * `@@unique([mcqQuestionId, optionLabel])` constraints can be exercised
 * without colliding with prior runs.
 *
 * Requires a running PostgreSQL with all migrations applied (the standard
 * `docker compose up -d postgres` + `pnpm --filter api prisma:migrate:dev`).
 */

@Module({
  imports: [PrismaModule, DerivativeArtifactModule],
})
class TestAppModule {}

describe('MCQ question write path (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: DerivativeArtifactService;

  let sourceId: string;
  let legalDocumentId: string;
  let legalDocumentSectionId: string;
  let mcqDisclaimerId: string;
  let runTag: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    service = moduleFixture.get(DerivativeArtifactService);

    await seedContentDisclaimers(prisma);
    const disclaimer = await prisma.contentDisclaimer.findUnique({
      where: { contentClass: 'ai_mcq' },
    });
    if (!disclaimer) {
      throw new Error(
        'ai_mcq disclaimer missing after seed — migration not applied?',
      );
    }
    mcqDisclaimerId = disclaimer.id;

    runTag = `mcq-question-e2e-${Date.now()}`;
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
        citationText: `${runTag} G.R. No. 888888`,
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
    // Cascade from derivative_artifact removes mcq_questions and mcq_options
    // automatically, but provenance rows are keyed generically (no FK from
    // entityId) so we nuke them explicitly.
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
    sourceDocumentId: legalDocumentId,
    sourceSectionId: legalDocumentSectionId,
    title: `${runTag} contract perfection MCQ`,
    contentHash: `sha256:${runTag}:mcq:v1`,
    contentRights: 'ai_generated_derivative' as const,
    contentDisclaimerId: mcqDisclaimerId,
    questionStem:
      'Under Philippine civil law, when is a contract said to be perfected?',
    explanation:
      'A contract is perfected by mere consent, i.e., upon the meeting of the offer and acceptance on the object and cause. See Art. 1305 of the Civil Code.',
    difficulty: 'medium' as const,
    questionFormat: 'single_best' as const,
    difficultySelfReport: 'medium' as const,
    supportingSectionIds: [legalDocumentSectionId],
    options: [
      {
        optionLabel: 'A' as const,
        optionText: 'When a written offer is communicated to the offeree.',
        isCorrect: false,
        rationale: 'Merely communicating an offer does not perfect a contract.',
      },
      {
        optionLabel: 'B' as const,
        optionText:
          'When the parties reach a meeting of the minds on the object and the cause.',
        isCorrect: true,
        rationale:
          'Consent perfects the contract under Art. 1305 of the Civil Code.',
      },
      {
        optionLabel: 'C' as const,
        optionText: 'When the agreed consideration is paid in full.',
        isCorrect: false,
        rationale:
          'Payment is performance, not perfection; contracts may be perfected without any payment.',
      },
      {
        optionLabel: 'D' as const,
        optionText: 'When the contract is reduced to a public instrument.',
        isCorrect: false,
        rationale:
          'Writing is a form requirement for some contracts but is not required for perfection generally.',
      },
    ],
    provenanceRecords: [
      {
        sourceDocumentId: legalDocumentId,
        sourceSectionId: legalDocumentSectionId,
        provenanceType: 'source_passage' as const,
      },
    ],
  });

  it('writes a DerivativeArtifact + McqQuestion + four McqOption rows atomically and returns the triple', async () => {
    const result = await service.createMcqQuestion(baseDto());

    // Base artifact row is shaped correctly.
    expect(result.artifact.id).toBeDefined();
    expect(result.artifact.derivativeType).toBe('mcq_question');
    expect(result.artifact.sourceDocumentId).toBe(legalDocumentId);
    expect(result.artifact.contentDisclaimerId).toBe(mcqDisclaimerId);
    expect(result.artifact.reviewStatus).toBe('draft');
    expect(result.artifact.visibility).toBe('private');

    // contentJson carries the §5.3 output-schema payload (minus abstain).
    const cj = result.artifact.contentJson as unknown as {
      questionStem: string;
      explanation: string;
      options: Array<{ label: string; isCorrect: boolean }>;
      difficultySelfReport: string;
      supportingSectionIds: string[];
    };
    expect(cj.questionStem).toContain('Philippine civil law');
    expect(cj.explanation).toContain('Art. 1305');
    expect(cj.options.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(cj.options.filter((o) => o.isCorrect)).toHaveLength(1);
    expect(cj.supportingSectionIds).toContain(legalDocumentSectionId);
    expect(cj.difficultySelfReport).toBe('medium');

    // McqQuestion row lands with the right columns.
    expect(result.mcqQuestion.derivativeArtifactId).toBe(result.artifact.id);
    expect(result.mcqQuestion.difficulty).toBe('medium');
    expect(result.mcqQuestion.questionFormat).toBe('single_best');
    expect(result.mcqQuestion.subjectTopicId).toBeNull();

    // All four options land with distinct labels.
    expect(result.mcqOptions).toHaveLength(4);
    const labels = result.mcqOptions.map((o) => o.optionLabel).sort();
    expect(labels).toEqual(['A', 'B', 'C', 'D']);
    expect(result.mcqOptions.filter((o) => o.isCorrect)).toHaveLength(1);

    // Verify the child tables hit the DB.
    const persistedQuestion = await prisma.mcqQuestion.findUnique({
      where: { id: result.mcqQuestion.id },
      include: { options: true, derivativeArtifact: true },
    });
    expect(persistedQuestion).not.toBeNull();
    expect(persistedQuestion!.options).toHaveLength(4);
    expect(persistedQuestion!.derivativeArtifact.derivativeType).toBe(
      'mcq_question',
    );

    // Verify the disclaimer FK join still resolves to the seeded row.
    const joined = await prisma.derivativeArtifact.findUnique({
      where: { id: result.artifact.id },
      include: { contentDisclaimer: true, mcqQuestion: true },
    });
    expect(joined).not.toBeNull();
    expect(joined!.contentDisclaimer.contentClass).toBe('ai_mcq');
    expect(joined!.contentDisclaimer.isActive).toBe(true);
    expect(joined!.mcqQuestion).not.toBeNull();
    expect(joined!.mcqQuestion!.id).toBe(result.mcqQuestion.id);

    // Clean up this row so the unique-constraint test below does not
    // collide on (sourceDocumentId, derivativeType, taxonomyVersion). The
    // taxonomyVersion is null here so PG treats the rows as distinct, but
    // we clean up anyway to keep the state predictable.
    await prisma.provenanceRecord.deleteMany({
      where: { entityId: result.artifact.id },
    });
    // Cascade removes mcq_questions and mcq_options automatically.
    await prisma.derivativeArtifact.delete({
      where: { id: result.artifact.id },
    });
  });

  it('ON DELETE CASCADE from derivative_artifacts removes the mcq_questions and mcq_options rows', async () => {
    const result = await service.createMcqQuestion(baseDto());
    const artifactId = result.artifact.id;
    const questionId = result.mcqQuestion.id;
    const optionIds = result.mcqOptions.map((o) => o.id);

    // Delete provenance first (no FK cascade from artifact → provenance).
    await prisma.provenanceRecord.deleteMany({
      where: { entityId: artifactId },
    });

    // Deleting the artifact should cascade through mcq_questions →
    // mcq_options.
    await prisma.derivativeArtifact.delete({ where: { id: artifactId } });

    const remainingQuestion = await prisma.mcqQuestion.findUnique({
      where: { id: questionId },
    });
    expect(remainingQuestion).toBeNull();

    const remainingOptions = await prisma.mcqOption.findMany({
      where: { id: { in: optionIds } },
    });
    expect(remainingOptions).toHaveLength(0);
  });

  it('rejects a DTO with duplicate option labels before touching the DB', async () => {
    const badDto = baseDto();
    badDto.options[3] = { ...badDto.options[3], optionLabel: 'A' };

    await expect(service.createMcqQuestion(badDto)).rejects.toThrow(
      /labels \{A, B, C, D\}/,
    );

    // Nothing should have been written.
    const artifactCount = await prisma.derivativeArtifact.count({
      where: { sourceDocumentId: legalDocumentId },
    });
    expect(artifactCount).toBe(0);
  });

  it('rejects a DTO where zero options are marked correct, without writing rows', async () => {
    const badDto = baseDto();
    badDto.options = badDto.options.map((o) => ({ ...o, isCorrect: false }));

    await expect(service.createMcqQuestion(badDto)).rejects.toThrow(
      /exactly one correct option/i,
    );

    const artifactCount = await prisma.derivativeArtifact.count({
      where: { sourceDocumentId: legalDocumentId },
    });
    expect(artifactCount).toBe(0);
  });
});

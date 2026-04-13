import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { DerivativeResponse } from '../src/common/decorators/derivative-response.decorator';
import { AttachDisclaimerInterceptor } from '../src/common/interceptors/attach-disclaimer.interceptor';
import { ContentDisclaimersModule } from '../src/modules/content-disclaimers/content-disclaimers.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedContentDisclaimers } from '../prisma/seed-disclaimers';

/**
 * End-to-end integration test for the §8.6 launch gate: a derivative
 * response decorated with `@DerivativeResponse` leaves the API with a
 * non-null `disclaimer` envelope attached.
 *
 * Uses a minimal test module with a test-only controller because no
 * production controller currently returns `DerivativeArtifact` rows —
 * that model is introduced in a follow-up PR. Decorating an existing
 * production endpoint is deferred to that follow-up so this PR keeps
 * its blast radius to table + service + interceptor + tests only.
 *
 * Requires a running PostgreSQL with the `content_disclaimers` migration
 * applied. Seeds the canonical rows before the controller boots.
 */

@Controller('_test/derivatives')
class TestDerivativeController {
  @Get('digest')
  @DerivativeResponse('ai_digest')
  getDigest() {
    return {
      id: 'test-digest-id',
      derivativeType: 'case_digest',
      contentJson: {
        facts: 'Test facts',
        issues: ['Test issue'],
        ruling: 'Test ruling',
      },
    };
  }

  @Get('mcqs')
  @DerivativeResponse('ai_mcq')
  getMcqs() {
    return [
      { id: 'q1', stem: 'Q1?', options: ['A', 'B', 'C', 'D'], answer: 'A' },
      { id: 'q2', stem: 'Q2?', options: ['A', 'B', 'C', 'D'], answer: 'B' },
    ];
  }

  @Get('regular')
  getRegular() {
    // Not decorated, no `derivativeType` field — should pass through.
    return { id: 'plain', message: 'no disclaimer expected' };
  }
}

@Module({
  imports: [PrismaModule, ContentDisclaimersModule],
  controllers: [TestDerivativeController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AttachDisclaimerInterceptor },
  ],
})
class TestAppModule {}

describe('Content disclaimers auto-attachment (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    // Ensure seed rows are present before the app boots so the service
    // cache loads a fully populated table.
    await seedContentDisclaimers(prisma);

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('seeds exactly 5 canonical content_disclaimers rows', async () => {
    const rows = await prisma.contentDisclaimer.findMany({
      orderBy: { contentClass: 'asc' },
    });
    const classes = rows.map((r) => r.contentClass);

    expect(classes.sort()).toEqual(
      [
        'ai_digest',
        'ai_mcq',
        'ai_suggested_bar_answer',
        'sample_contract',
        'sample_pleading',
      ].sort(),
    );

    for (const row of rows) {
      expect(row.bodyHtml.length).toBeGreaterThan(0);
      expect(row.bodyPlain.length).toBeGreaterThan(0);
      expect(row.isActive).toBe(true);
      expect(row.version).toBeGreaterThanOrEqual(1);
    }
  });

  it('attaches the ai_digest disclaimer to a decorated object endpoint', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/_test/derivatives/digest')
      .expect(200);

    expect(res.body).toMatchObject({
      id: 'test-digest-id',
      derivativeType: 'case_digest',
    });
    expect(res.body.disclaimer).toBeDefined();
    expect(res.body.disclaimer.contentClass).toBe('ai_digest');
    expect(res.body.disclaimer.version).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.disclaimer.bodyHtml).toBe('string');
    expect(res.body.disclaimer.bodyHtml.length).toBeGreaterThan(0);
    expect(typeof res.body.disclaimer.bodyPlain).toBe('string');
    expect(res.body.disclaimer.bodyPlain.length).toBeGreaterThan(0);
    expect(res.body.disclaimer.bodyHtml).toContain('AI-generated case digest');
    expect(res.body.disclaimer.bodyPlain).toContain(
      'LIBERTASIAN is an educational research platform',
    );
  });

  it('wraps a decorated array endpoint in an envelope with disclaimer at top level', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/_test/derivatives/mcqs')
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.disclaimer.contentClass).toBe('ai_mcq');
    expect(res.body.disclaimer.bodyHtml).toContain(
      'multiple-choice question',
    );
  });

  it('passes regular (non-derivative) responses through unchanged', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/_test/derivatives/regular')
      .expect(200);

    expect(res.body).toEqual({
      id: 'plain',
      message: 'no disclaimer expected',
    });
    expect(res.body.disclaimer).toBeUndefined();
  });
});

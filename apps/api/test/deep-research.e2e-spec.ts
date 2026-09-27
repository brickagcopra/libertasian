import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import {
  createAuthenticatedUser,
  createTestApp,
  updateSubscriptionPlan,
} from './helpers';

/**
 * Deep Research E2E — gateway behaviour against a real Postgres + Redis.
 *
 * rag-service is NOT required: fetches to `/research/deep` are answered by a
 * canned SSE stream, every other fetch passes through untouched. What is
 * under test is the gateway: tier gate (402), quota (429 / refund), run
 * persistence and tenant + owner scoping.
 */

type Frame = [event: string, payload: Record<string, unknown>];

function sse(frames: Frame[]): Response {
  const body = frames.map(([e, p]) => `event: ${e}\ndata: ${JSON.stringify(p)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const DONE = {
  runId: 'ignored',
  modelName: 'gpt-4o-mini',
  promptTemplateVersion: 'deep-research-v1',
  latencyMs: 10,
  costUsd: 0.001,
  tokensIn: 100,
  tokensOut: 50,
  modelVersion: 'gpt-4o-mini',
};

function completed(): Response {
  return sse([
    ['stage', { stage: 'planning' }],
    ['plan', { subQueries: ['a', 'b', 'c'] }],
    ['sources', { sources: [] }],
    ['result', { summary: 'S', sections: [], removedClaims: 0, abstained: false }],
    ['done', DONE],
  ]);
}

function abstained(): Response {
  return sse([
    ['stage', { stage: 'planning' }],
    ['plan', { subQueries: ['a', 'b', 'c'] }],
    [
      'result',
      {
        summary: 'Not enough sources.',
        sections: [],
        removedClaims: 0,
        abstained: true,
        abstainReason: 'insufficient_passages',
      },
    ],
    ['done', DONE],
  ]);
}

describe('Deep Research (E2E)', () => {
  let app: INestApplication;
  let nextRag: () => Response = completed;
  const realFetch = global.fetch;
  beforeAll(async () => {
    // ConfigModule snapshots the environment when AppModule is imported, so
    // setting process.env here would be too late. Enforce the paywall at the
    // ConfigService read instead — the one every paywall check goes through.
    const realGet = ConfigService.prototype.get;
    jest
      .spyOn(ConfigService.prototype, 'get')
      .mockImplementation(function (this: ConfigService, key: string, ...rest: unknown[]) {
        if (key === 'PAYWALL_ENFORCED') return true;
        return (realGet as (...a: unknown[]) => unknown).call(this, key, ...rest);
      } as ConfigService['get']);
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/research/deep')) return nextRag();
      return realFetch(input, init);
    });
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  async function usage(token: string) {
    const res = await request(app.getHttpServer())
      .get('/api/v1/quotas/usage')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.quotas.deepResearchPerMonth as { used: number; limit: number };
  }

  async function runOnce(token: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/deep-research/stream')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'What is the doctrine of res judicata?' })
      .buffer(true)
      .parse((r, cb) => {
        let text = '';
        r.on('data', (c: Buffer) => (text += c.toString()));
        r.on('end', () => cb(null, text));
      });
    return res;
  }

  function runIdFrom(text: string): string {
    const m = /event: done\ndata: (\{.*\})/.exec(text);
    if (!m) throw new Error(`no done frame in: ${text.slice(0, 300)}`);
    return (JSON.parse(m[1]!) as { runId: string }).runId;
  }

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/deep-research/stream')
      .send({ question: 'What is res judicata?' })
      .expect(401);
    await request(app.getHttpServer()).get('/api/v1/deep-research').expect(401);
  });

  it('free plan with the paywall enforced → 402 subscription_required, no quota spent', async () => {
    const user = await createAuthenticatedUser(app, { email: `dr-free-${Date.now()}@test.com` });
    const res = await request(app.getHttpServer())
      .post('/api/v1/deep-research/stream')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ question: 'What is res judicata?' });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('subscription_required');
    expect((await usage(user.accessToken)).used).toBe(0);
  });

  it('exposes deepResearchPerMonth on /quotas/usage', async () => {
    const user = await createAuthenticatedUser(app, { email: `dr-q-${Date.now()}@test.com` });
    await updateSubscriptionPlan(app, user.accessToken, 'edu');
    expect((await usage(user.accessToken)).limit).toBe(20);
  });

  it('completed run is persisted, charged, and readable by its owner', async () => {
    const user = await createAuthenticatedUser(app, { email: `dr-ok-${Date.now()}@test.com` });
    await updateSubscriptionPlan(app, user.accessToken, 'edu');
    nextRag = completed;

    const res = await runOnce(user.accessToken);
    expect(res.status).toBe(200);
    const runId = runIdFrom(res.body as string);
    expect((await usage(user.accessToken)).used).toBe(1);

    const got = await request(app.getHttpServer())
      .get(`/api/v1/deep-research/${runId}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(got.body.data.status).toBe('completed');
    expect(got.body.data.subQueriesJson).toEqual(['a', 'b', 'c']);

    const list = await request(app.getHttpServer())
      .get('/api/v1/deep-research?limit=5')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(runId);
  });

  it('abstained run refunds the unit', async () => {
    const user = await createAuthenticatedUser(app, { email: `dr-abs-${Date.now()}@test.com` });
    await updateSubscriptionPlan(app, user.accessToken, 'edu');
    nextRag = abstained;

    const res = await runOnce(user.accessToken);
    expect(res.status).toBe(200);
    const runId = runIdFrom(res.body as string);
    expect((await usage(user.accessToken)).used).toBe(0);

    const got = await request(app.getHttpServer())
      .get(`/api/v1/deep-research/${runId}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(got.body.data.status).toBe('abstained');
  });

  it('cross-tenant GET / DELETE of another org’s run → 404, and it is not listed', async () => {
    const owner = await createAuthenticatedUser(app, { email: `dr-a-${Date.now()}@test.com` });
    const other = await createAuthenticatedUser(app, { email: `dr-b-${Date.now()}@test.com` });
    await updateSubscriptionPlan(app, owner.accessToken, 'edu');
    nextRag = completed;
    const runId = runIdFrom((await runOnce(owner.accessToken)).body as string);

    await request(app.getHttpServer())
      .get(`/api/v1/deep-research/${runId}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/deep-research/${runId}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
    const list = await request(app.getHttpServer())
      .get('/api/v1/deep-research')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(runId);

    // Still there for its owner, who can delete it.
    await request(app.getHttpServer())
      .delete(`/api/v1/deep-research/${runId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
  });

  it('rejects a malformed id and unknown body fields', async () => {
    const user = await createAuthenticatedUser(app, { email: `dr-v-${Date.now()}@test.com` });
    await request(app.getHttpServer())
      .get('/api/v1/deep-research/not-a-uuid')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(400);
    await updateSubscriptionPlan(app, user.accessToken, 'edu');
    await request(app.getHttpServer())
      .post('/api/v1/deep-research/stream')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ question: 'What is res judicata?', organizationId: 'x' })
      .expect(400);
  });
});

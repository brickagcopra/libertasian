import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { PrismaService } from '../src/prisma/prisma.service';
import { SocialTokenService } from '../src/modules/auth/social-token.service';
import { createTestApp, registerTestUser } from './helpers';

/**
 * Every sign-in response must carry `organizationId` / `organizationRole`.
 *
 * Mobile seeds its auth context from the sign-in response, and
 * `usePurchaseOptions` returns early when `organizationId` is undefined —
 * which means `configurePurchases()` never runs and the RevenueCat SDK is
 * never initialized for the session ("Plans are not available right now",
 * Restore Purchases throwing into an unconfigured SDK). The fields were
 * present on `GET /users/me` and absent from all five auth paths.
 */
describe('Auth responses carry org fields (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Deterministic identities keyed by the fake token string the test sends.
  const googleId = `g-sub-${Date.now()}`;
  const appleId = `a-sub-${Date.now()}`;
  const googleEmail = `orgfields-google-${Date.now()}@libertasian-test.com`;
  const appleEmail = `orgfields-apple-${Date.now()}@libertasian-test.com`;

  beforeAll(async () => {
    // The real SocialTokenService verifies against live Google/Apple JWKS.
    // Swap it for a stub that returns fixed profiles — this suite is about the
    // response shape after verification, not about verification itself.
    app = await createTestApp((builder) =>
      builder.overrideProvider(SocialTokenService).useValue({
        googleConfigured: true,
        verifyGoogleIdToken: jest.fn().mockResolvedValue({
          googleId,
          email: googleEmail,
          fullName: 'Org Fields Google',
        }),
        verifyAppleIdentityToken: jest.fn().mockResolvedValue({
          appleId,
          email: appleEmail,
        }),
      }),
    );
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** The active membership the JWT for this user was minted from. */
  async function activeMembership(userId: string) {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
    expect(membership).not.toBeNull();
    return membership!;
  }

  it('POST /auth/login returns organizationId and organizationRole matching the active membership', async () => {
    const { email, password, userId } = await registerTestUser(app);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);

    const membership = await activeMembership(userId);
    expect(res.body.data.user.organizationId).toBe(membership.organizationId);
    expect(res.body.data.user.organizationRole).toBe(membership.role);
  });

  it('POST /auth/register returns organizationId and organizationRole for the provisioned workspace', async () => {
    const email = `orgfields-reg-${Date.now()}@libertasian-test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'TestPass123!secure', fullName: 'Org Fields Reg' })
      .expect(201);

    const membership = await activeMembership(res.body.data.user.id as string);
    expect(res.body.data.user.organizationId).toBe(membership.organizationId);
    expect(res.body.data.user.organizationRole).toBe('owner');
  });

  it('POST /auth/google/mobile returns organizationId and organizationRole', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/google/mobile')
      .set('X-Client', 'mobile')
      .send({ idToken: 'stubbed-google-id-token' })
      .expect(201);

    const membership = await activeMembership(res.body.data.user.id as string);
    expect(res.body.data.user.organizationId).toBe(membership.organizationId);
    expect(res.body.data.user.organizationRole).toBe(membership.role);
  });

  it('POST /auth/apple/mobile returns organizationId and organizationRole', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/apple/mobile')
      .set('X-Client', 'mobile')
      .send({ identityToken: 'stubbed-apple-identity-token' })
      .expect(201);

    const membership = await activeMembership(res.body.data.user.id as string);
    expect(res.body.data.user.organizationId).toBe(membership.organizationId);
    expect(res.body.data.user.organizationRole).toBe(membership.role);
  });

  /**
   * Wire-level companion to `auth-user-contract.spec.ts`: that one pins the
   * two builders' shapes in isolation, this one pins the actual HTTP bodies,
   * so a serialization layer (interceptor, DTO, envelope) can't drop a field
   * the builders agree on.
   */
  it('the sign-in body is a superset of the GET /users/me body', async () => {
    const { email, password } = await registerTestUser(app);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);

    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${login.body.data.tokens.accessToken}`)
      .expect(200);

    const signInUser = login.body.data.user as Record<string, unknown>;
    const meUser = me.body.data as Record<string, unknown>;

    const missing = Object.keys(meUser).filter((k) => !(k in signInUser));
    expect(missing).toEqual([]);

    for (const field of ['organizationId', 'organizationRole', 'isPlatformAdmin']) {
      expect(signInUser[field]).toEqual(meUser[field]);
    }
    // Both sides regressing to undefined would satisfy the equality above.
    expect(signInUser['organizationId']).toEqual(expect.any(String));
    expect(signInUser['organizationRole']).toEqual(expect.any(String));
  });
});

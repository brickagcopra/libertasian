import { INestApplication } from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { PrismaService } from '../src/prisma/prisma.service';
import {
  createAuthenticatedUser,
  createTestApp,
  registerTestUser,
} from './helpers';

/**
 * POST /auth/reset-password must decide whose password changes from the TOKEN
 * ALONE, never from whoever happens to be signed in.
 *
 * This matters because of how the link is actually opened: the reset email goes
 * to one account, but people click it in whatever browser is to hand — often
 * one already signed in as somebody else (a shared laptop, an admin's own
 * session). The web middleware used to redirect those requests away from the
 * page entirely; now that the page opens with a session present, the request
 * really will carry another user's JWT and cookies, so "the endpoint ignores
 * them" has to be asserted rather than assumed.
 *
 * The guard is structural — `resetPassword` has no JwtAuthGuard and no
 * @CurrentUser, and the service resolves the user from `resetRecord.userId` —
 * but nothing stopped a future edit from wiring a session in.
 */
describe('POST /auth/reset-password ignores the caller session (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Mint a valid reset token for `userId`, the way forgot-password does. */
  async function issueResetToken(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordReset.create({
      data: {
        userId,
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return token;
  }

  it('changes only the token owner, even when another user JWT is attached', async () => {
    const stamp = Date.now();
    const ownerPassword = 'OwnerPass123!secure';
    const bystanderPassword = 'BystanderPass123!secure';

    // The account the reset email was sent to.
    const owner = await registerTestUser(app, {
      email: `reset-owner-${stamp}@test.com`,
      password: ownerPassword,
      fullName: 'Token Owner',
    });
    // A DIFFERENT account, signed in on this browser (the superadmin case).
    const bystander = await createAuthenticatedUser(app, {
      email: `reset-bystander-${stamp}@test.com`,
      password: bystanderPassword,
      fullName: 'Signed In Bystander',
    });

    const before = await prisma.user.findMany({
      where: { id: { in: [owner.userId, bystander.userId] } },
      select: { id: true, passwordHash: true },
    });
    const bystanderHashBefore = before.find(
      (u) => u.id === bystander.userId,
    )?.passwordHash;

    const token = await issueResetToken(owner.userId);
    const newPassword = 'BrandNewOwnerPass123!secure';

    // Reset while authenticated as the bystander — bearer token AND cookie.
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Authorization', `Bearer ${bystander.accessToken}`)
      .set('Cookie', ['libertasian-session=1'])
      .send({ token, newPassword })
      .expect(201);

    const after = await prisma.user.findMany({
      where: { id: { in: [owner.userId, bystander.userId] } },
      select: { id: true, passwordHash: true },
    });
    const ownerHashAfter = after.find((u) => u.id === owner.userId)
      ?.passwordHash as string;
    const bystanderHashAfter = after.find((u) => u.id === bystander.userId)
      ?.passwordHash;

    // The TOKEN's owner got the new password...
    expect(await bcrypt.compare(newPassword, ownerHashAfter)).toBe(true);
    // ...and the signed-in account was not touched at all.
    expect(bystanderHashAfter).toBe(bystanderHashBefore);

    // Proven end to end rather than by hash comparison alone: the bystander
    // still signs in with their ORIGINAL password, and not with the new one.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: bystander.email, password: bystanderPassword })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: bystander.email, password: newPassword })
      .expect(401);

    // ...and the owner's OLD password no longer works.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: ownerPassword })
      .expect(401);
  });

  it('produces the same result with no session at all', async () => {
    const stamp = Date.now();
    const owner = await registerTestUser(app, {
      email: `reset-nosession-${stamp}@test.com`,
      password: 'OwnerPass123!secure',
      fullName: 'Token Owner',
    });

    const token = await issueResetToken(owner.userId);
    const newPassword = 'AnotherNewPass123!secure';

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword })
      .expect(201);

    const updated = await prisma.user.findUnique({
      where: { id: owner.userId },
      select: { passwordHash: true },
    });
    expect(await bcrypt.compare(newPassword, updated?.passwordHash ?? '')).toBe(
      true,
    );
  });

  it('rejects a request that carries a session but no token', async () => {
    const bystander = await createAuthenticatedUser(app, {
      email: `reset-notoken-${Date.now()}@test.com`,
      password: 'BystanderPass123!secure',
      fullName: 'Signed In Bystander',
    });

    // A session is not a substitute for the token: with no token there is
    // nothing to identify an account, and the DTO whitelist rejects the body.
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Authorization', `Bearer ${bystander.accessToken}`)
      .send({ newPassword: 'NoTokenPass123!secure' })
      .expect(400);

    // And an invalid token is refused regardless of who is signed in.
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Authorization', `Bearer ${bystander.accessToken}`)
      .send({ token: 'not-a-real-token', newPassword: 'NoTokenPass123!secure' })
      .expect(400);
  });
});

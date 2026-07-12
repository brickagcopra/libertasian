import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { AppModule } from '../src/app.module';
import { AppThrottlerGuard } from '../src/common/guards/app-throttler.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { EntitlementService } from '../src/modules/subscriptions/entitlement.service';

/**
 * Disable rate limiting by mocking canActivate on the throttler guard prototype.
 * Call this in beforeAll AND beforeEach if the suite uses jest.restoreAllMocks()
 * in afterEach, since restoreAllMocks clears prototype spies.
 */
export function disableRateLimiting(): void {
  jest
    .spyOn(AppThrottlerGuard.prototype, 'canActivate')
    .mockResolvedValue(true);
}

/**
 * Bootstrap the NestJS application for E2E testing.
 * Requires a running PostgreSQL and Redis instance.
 * Rate limiting is disabled to prevent 429 errors during test runs.
 */
export async function createTestApp(): Promise<INestApplication> {
  // Disable rate limiting by mocking canActivate on the throttler guard prototype.
  // This is more reliable than overrideProvider(APP_GUARD) which doesn't work
  // with NestJS multi-provider tokens.
  disableRateLimiting();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();

  // Cookie parsing for the httpOnly `libertasian-refresh` cookie used
  // by /auth/refresh and /auth/logout. Must match main.ts:18 — without
  // this, `req.cookies` is undefined and every refresh returns 401
  // regardless of what the test sets on the Cookie header.
  // See commit af823bd (RS256 + httpOnly cookie migration).
  app.use(cookieParser());

  // Match production configuration from main.ts
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.setGlobalPrefix('api/v1');

  await app.init();
  return app;
}

/** Register a test user and return credentials */
export async function registerTestUser(
  app: INestApplication,
  overrides?: Partial<{ email: string; password: string; fullName: string }>,
) {
  const email = overrides?.email ?? `test-${Date.now()}@libertasian-test.com`;
  const password = overrides?.password ?? 'TestPass123!secure';
  const fullName = overrides?.fullName ?? 'Test User';

  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password, fullName })
    .expect(201);

  return { email, password, fullName, userId: res.body.data.user.id };
}

/**
 * Login a test user and return tokens.
 *
 * Since commit af823bd, the refresh token is issued as an httpOnly
 * `libertasian-refresh` cookie and is no longer returned in the
 * response body. We extract it from the Set-Cookie header here so
 * callers can either (a) pass `refreshCookie` to `supertest.set('Cookie', ...)`
 * for subsequent /auth/refresh and /auth/logout calls, or (b) inspect
 * `refreshToken` directly for rotation / reuse-detection assertions.
 */
export async function loginTestUser(
  app: INestApplication,
  email: string,
  password: string,
) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(201);

  return {
    accessToken: res.body.data.tokens.accessToken as string,
    ...extractRefreshCookie(res.headers['set-cookie']),
    user: res.body.data.user,
  };
}

/** Cookie name matching `REFRESH_COOKIE` in auth.controller.ts */
export const REFRESH_COOKIE_NAME = 'libertasian-refresh';

/**
 * Parse the `libertasian-refresh` entry out of a Set-Cookie header and
 * return both the raw `name=value` cookie pair (for `.set('Cookie', ...)`)
 * and the decoded token value (for rotation / equality assertions).
 *
 * Returns empty strings if the cookie is absent — callers can detect
 * a missing cookie via `refreshCookie === ''`.
 */
export function extractRefreshCookie(setCookieHeader: string | string[] | undefined): {
  refreshToken: string;
  refreshCookie: string;
} {
  const cookies: string[] = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  const match = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!match) {
    return { refreshToken: '', refreshCookie: '' };
  }
  const pair = match.split(';')[0]; // "libertasian-refresh=VALUE"
  const value = decodeURIComponent(pair.split('=').slice(1).join('='));
  return { refreshToken: value, refreshCookie: pair };
}

/**
 * Change a user's organization to a different subscription plan (direct
 * Prisma update) and invalidate the Redis entitlement cache so quota
 * checks immediately reflect the new plan.
 */
export async function updateSubscriptionPlan(
  app: INestApplication,
  accessToken: string,
  planCode: string,
): Promise<void> {
  const orgRes = await request(app.getHttpServer())
    .get('/api/v1/organizations/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);
  const orgId = orgRes.body.data[0].id as string;

  const prisma = app.get(PrismaService);
  const sub = await prisma.subscription.findFirst({
    where: { organizationId: orgId, status: 'active' },
  });
  if (sub) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { planCode },
    });
  }

  // Entitlements are cached in Redis for 2 minutes — invalidate so the
  // plan change takes effect for the next quota/entitlement check.
  await app.get(EntitlementService).invalidateEntitlementCache(orgId);
}

/** Create a test user and login — returns everything needed for authenticated requests */
export async function createAuthenticatedUser(
  app: INestApplication,
  overrides?: Partial<{ email: string; password: string; fullName: string }>,
) {
  const registration = await registerTestUser(app, overrides);
  const login = await loginTestUser(app, registration.email, registration.password);
  return { ...registration, ...login };
}

/**
 * Create an authenticated user whose org is on the 'team' plan (unlimited
 * maxMatters). Use for suites that create matters as setup — the default
 * free plan has maxMatters = 0 and matter creation is entitlement-gated.
 */
export async function createTeamUser(
  app: INestApplication,
  overrides?: Partial<{ email: string; password: string; fullName: string }>,
) {
  const user = await createAuthenticatedUser(app, overrides);
  await updateSubscriptionPlan(app, user.accessToken, 'team');
  return user;
}

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { AppModule } from '../src/app.module';
import { AppThrottlerGuard } from '../src/common/guards/app-throttler.guard';

/**
 * Bootstrap the NestJS application for E2E testing.
 * Requires a running PostgreSQL and Redis instance.
 * Rate limiting is disabled to prevent 429 errors during test runs.
 */
export async function createTestApp(): Promise<INestApplication> {
  // Disable rate limiting by mocking canActivate on the throttler guard prototype.
  // This is more reliable than overrideProvider(APP_GUARD) which doesn't work
  // with NestJS multi-provider tokens.
  jest
    .spyOn(AppThrottlerGuard.prototype, 'canActivate')
    .mockResolvedValue(true);

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();

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

/** Login a test user and return tokens */
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
    refreshToken: res.body.data.tokens.refreshToken as string,
    user: res.body.data.user,
  };
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

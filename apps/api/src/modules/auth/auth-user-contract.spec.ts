import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { UserRole, type JwtPayload } from '@libertasian/types';

import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PermissionsService } from '../rbac/permissions.service';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { AuthService, type AuthUser } from './auth.service';
import type { LoginEventService } from './login-event.service';
import type { LoginThrottleService } from './login-throttle.service';

/**
 * Contract test: the user object a SIGN-IN returns must be a superset of the
 * one `GET /users/me` returns.
 *
 * These two shapes are built in different files from different sources —
 * `/users/me` reads the org fields off the JWT payload, the sign-in paths read
 * them off the membership row they just resolved — and they drifted once
 * already: the sign-in responses shipped without `organizationId` /
 * `organizationRole` at all. Mobile seeds its auth context from whichever call
 * lands first, so the drift left `organizationId === undefined` for the entire
 * session and the purchase screen never configured RevenueCat.
 *
 * No DB or Nest container here on purpose: both units are constructed directly
 * with the real `UsersService.sanitize`, so the assertion is about the SHAPES
 * the two code paths produce, and it fails the moment either side grows or
 * drops a field the other does not have.
 */
describe('auth user shape contract (sign-in vs GET /users/me)', () => {
  const user = {
    id: 'user-123',
    email: 'contract@example.com',
    fullName: 'Contract User',
    phone: null,
    status: 'active',
    emailVerified: true,
    mfaEnabled: false,
    passwordHash: '$2b$12$hash',
    onboardingCompletedAt: null,
    userRole: 'lawyer',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  const membership = { organizationId: 'org-123', role: 'owner' };

  const usersService = new UsersService({} as PrismaService);

  /**
   * `buildAuthUser` is private and touches nothing but `usersService`, so the
   * service is constructed directly rather than through the Nest container.
   * The ConfigService stub only has to satisfy the constructor's key
   * resolution (falls through to the HS256 dev fallback).
   */
  function buildSignInUser(isPlatformAdmin: boolean): AuthUser {
    const authService = new AuthService(
      {} as PrismaService,
      usersService,
      {} as JwtService,
      {
        get: <T>(_key: string, defaultValue?: T) => defaultValue,
      } as unknown as ConfigService,
      {} as NotificationsService,
      {} as LoginEventService,
      {} as PermissionsService,
      {} as LoginThrottleService,
    );
    return (
      authService as unknown as {
        buildAuthUser: (
          u: typeof user,
          m: typeof membership | null,
          a: boolean,
        ) => AuthUser;
      }
    ).buildAuthUser(user, membership, isPlatformAdmin);
  }

  async function buildMeUser(isPlatformAdmin: boolean) {
    const controller = new UsersController(
      {
        findById: jest.fn().mockResolvedValue(user),
        sanitize: usersService.sanitize.bind(usersService),
      } as unknown as UsersService,
      {} as AuditService,
      {} as PrismaService,
    );
    const payload = {
      sub: user.id,
      email: user.email,
      role: membership.role as UserRole,
      organizationId: membership.organizationId,
      mfaVerified: true,
      isPlatformAdmin,
      iat: 0,
      exp: 0,
    } satisfies JwtPayload;
    const res = await controller.getMe(payload);
    return res.data;
  }

  it('sign-in returns every field GET /users/me returns', async () => {
    const signIn = buildSignInUser(false);
    const me = await buildMeUser(false);

    const missing = Object.keys(me).filter((k) => !(k in signIn));
    expect(missing).toEqual([]);
  });

  it('carries the same organizationId / organizationRole / isPlatformAdmin values', async () => {
    const signIn = buildSignInUser(true);
    const me = await buildMeUser(true);

    for (const field of ['organizationId', 'organizationRole', 'isPlatformAdmin'] as const) {
      expect(signIn[field]).toEqual(me[field]);
    }

    // Pin the values themselves too — an assertion that only compares the two
    // objects would still pass if BOTH sides regressed to undefined.
    expect(signIn.organizationId).toBe(membership.organizationId);
    expect(signIn.organizationRole).toBe(membership.role);
    expect(signIn.isPlatformAdmin).toBe(true);
  });

  it('produces identical shapes in both directions (no field on either side alone)', async () => {
    const signIn = buildSignInUser(false);
    const me = await buildMeUser(false);

    expect(Object.keys(signIn).sort()).toEqual(Object.keys(me).sort());
  });

  it('emits explicit nulls, not absent keys, when no membership is resolved', () => {
    const authService = new AuthService(
      {} as PrismaService,
      usersService,
      {} as JwtService,
      {
        get: <T>(_key: string, defaultValue?: T) => defaultValue,
      } as unknown as ConfigService,
      {} as NotificationsService,
      {} as LoginEventService,
      {} as PermissionsService,
      {} as LoginThrottleService,
    );
    const built = (
      authService as unknown as {
        buildAuthUser: (u: typeof user, m: null, a: boolean) => AuthUser;
      }
    ).buildAuthUser(user, null, false);

    expect('organizationId' in built).toBe(true);
    expect('organizationRole' in built).toBe(true);
    expect(built.organizationId).toBeNull();
    expect(built.organizationRole).toBeNull();
  });
});

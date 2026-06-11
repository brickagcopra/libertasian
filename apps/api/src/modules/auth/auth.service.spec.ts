import { BadRequestException, ConflictException, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../common/services/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../rbac/permissions.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { LoginEventService } from './login-event.service';
import { LoginThrottleService } from './login-throttle.service';
import type { RegisterDto, LoginDto } from './dto';

// Mock uuid (ESM-only package, cannot be transformed by ts-jest)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

// Mock global fetch (used by HaveIBeenPwned breach check)
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  text: jest.fn().mockResolvedValue(''), // Empty response = no breached passwords
}) as jest.Mock;

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

// Mock crypto for deterministic tests
const mockRandomBytes = jest.fn();
const mockCreateHash = jest.fn();
const originalCrypto = jest.requireActual('crypto');

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: (size: number) => mockRandomBytes(size),
  createHash: (algorithm: string) => mockCreateHash(algorithm),
}));

/** Explicit mock type matching the PrismaService mock shape defined in beforeEach.
 *  Prisma's complex generic method signatures are incompatible with jest.Mocked<>,
 *  so we define the mock shape manually with jest.Mock for each method. */
type MockPrismaService = {
  user: {
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
  };
  organization: {
    create: jest.Mock;
  };
  organizationMember: {
    create: jest.Mock;
    findFirst: jest.Mock;
  };
  subscription: {
    create: jest.Mock;
  };
  refreshToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

/** Explicit mock type for UsersService. The real sanitize() has strict parameter types
 *  that conflict with the test's simplified mock data, so we use jest.Mock directly. */
type MockUsersService = {
  findByEmail: jest.Mock;
  findById: jest.Mock;
  findByGoogleId: jest.Mock;
  create: jest.Mock;
  createFromGoogle: jest.Mock;
  linkGoogleAccount: jest.Mock;
  sanitize: jest.Mock;
};

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: MockPrismaService;
  let usersService: MockUsersService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let loginEventService: { record: jest.Mock };
  let loginThrottle: {
    assertNotLocked: jest.Mock;
    recordFailure: jest.Mock;
    recordSuccess: jest.Mock;
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    passwordHash: '$2b$12$hashedpassword',
    fullName: 'Test User',
    status: 'active',
    emailVerified: false,
    mfaEnabled: false,
    mfaSecret: null,
    googleId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    emailVerifyToken: null,
  } as const;

  const mockOrganization = {
    id: 'org-123',
    name: "Test User's Workspace",
    slug: 'test-user-abc123',
    type: 'individual',
    billingOwnerUserId: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMembership = {
    id: 'member-123',
    organizationId: 'org-123',
    userId: 'user-123',
    role: 'owner',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Reset mocks
    mockRandomBytes.mockImplementation((size: number) => {
      return originalCrypto.randomBytes(size);
    });

    mockCreateHash.mockImplementation((algorithm: string) => {
      return originalCrypto.createHash(algorithm);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              create: jest.fn(),
              update: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
            },
            organization: {
              create: jest.fn(),
            },
            organizationMember: {
              create: jest.fn(),
              findFirst: jest.fn(),
            },
            subscription: {
              create: jest.fn(),
            },
            emailPreference: {
              create: jest.fn(),
            },
            refreshToken: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            findByGoogleId: jest.fn(),
            create: jest.fn(),
            createFromGoogle: jest.fn(),
            linkGoogleAccount: jest.fn(),
            sanitize: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            signAsync: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string | number) => {
              const config: Record<string, string | number> = {
                JWT_ACCESS_TTL: 900,
                JWT_REFRESH_TTL: 604800,
                JWT_SECRET: 'test-secret',
                JWT_PRIVATE_KEY_PATH: '',
                JWT_PRIVATE_KEY: '',
                ENCRYPTION_KEY: '',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            sendVerificationEmail: jest.fn(),
            sendPasswordResetEmail: jest.fn(),
          },
        },
        {
          provide: LoginEventService,
          useValue: {
            record: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: LoginThrottleService,
          useValue: {
            assertNotLocked: jest.fn().mockResolvedValue(undefined),
            recordFailure: jest.fn().mockResolvedValue(undefined),
            recordSuccess: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            // Default: no admin:* permissions — non-admin user. Individual
            // tests that exercise the admin-bypass response can override
            // getEffectivePermissions to return ['admin:billing', ...].
            getEffectivePermissions: jest.fn().mockResolvedValue([]),
            resolveMemberId: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get(PrismaService) as unknown as MockPrismaService;
    usersService = module.get(UsersService) as unknown as MockUsersService;
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;
    notificationsService = module.get(NotificationsService) as jest.Mocked<NotificationsService>;
    loginEventService = module.get(LoginEventService) as unknown as { record: jest.Mock };
    loginThrottle = module.get(LoginThrottleService) as unknown as {
      assertNotLocked: jest.Mock;
      recordFailure: jest.Mock;
      recordSuccess: jest.Mock;
    };

    // Default mock implementations
    (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$12$hashedpassword');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const registerDto: RegisterDto = {
      email: 'newuser@example.com',
      password: 'SecurePassword123!',
      fullName: 'New User',
    };

    it('should throw ConflictException if email already exists', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findByEmail']>);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
      await expect(service.register(registerDto)).rejects.toThrow('Email already registered');

      expect(usersService.findByEmail).toHaveBeenCalledWith(registerDto.email);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should create user with hashed password and default organization', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['create']>);
      usersService.sanitize.mockReturnValue({
        id: mockUser.id,
        email: mockUser.email,
        fullName: mockUser.fullName,
        status: mockUser.status,
        emailVerified: mockUser.emailVerified,
        mfaEnabled: mockUser.mfaEnabled,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      });

      prismaService.organization.create.mockResolvedValue(mockOrganization as unknown as ReturnType<typeof prismaService.organization.create>);
      prismaService.organizationMember.create.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.create>);
      prismaService.subscription.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.subscription.create>);
      prismaService.user.update.mockResolvedValue(mockUser as unknown as ReturnType<typeof prismaService.user.update>);

      const result = await service.register(registerDto);

      // Verify password hashing
      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 12);

      // Verify user creation
      expect(usersService.create).toHaveBeenCalledWith({
        email: registerDto.email,
        passwordHash: '$2b$12$hashedpassword',
        fullName: registerDto.fullName,
      });

      // Verify organization creation
      expect(prismaService.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "New User's Workspace",
            type: 'individual',
            billingOwnerUserId: mockUser.id,
          }),
        }),
      );

      // Verify membership creation
      expect(prismaService.organizationMember.create).toHaveBeenCalledWith({
        data: {
          organizationId: mockOrganization.id,
          userId: mockUser.id,
          role: 'owner',
          status: 'active',
        },
      });

      // Verify subscription creation — entitlementsJson must be empty so
      // future plan-default changes (e.g. free.aiAnswers) flow through
      // instead of being frozen at registration time.
      expect(prismaService.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: mockOrganization.id,
          planCode: 'free',
          status: 'active',
          seats: 1,
          entitlementsJson: {},
        }),
      });

      // Verify email verification token generation
      expect(prismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: expect.objectContaining({
            emailVerifyToken: expect.any(String),
          }),
        }),
      );

      // Verify verification email sent
      expect(notificationsService.sendVerificationEmail).toHaveBeenCalledWith(
        registerDto.email,
        registerDto.fullName,
        expect.any(String),
      );

      // Verify result — register attaches isPlatformAdmin=false for a fresh
      // user (no admin:* permissions on the just-created membership).
      expect(result.user).toEqual({
        ...usersService.sanitize(mockUser),
        isPlatformAdmin: false,
      });
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'correctpassword',
    };

    const deviceFingerprint = 'device-fingerprint-123';

    it('should throw UnauthorizedException for invalid email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(service.login(loginDto, deviceFingerprint)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto, deviceFingerprint)).rejects.toThrow('Invalid email or password');

      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findByEmail']>);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto, deviceFingerprint)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto, deviceFingerprint)).rejects.toThrow('Invalid email or password');

      expect(bcrypt.compare).toHaveBeenCalledWith(loginDto.password, mockUser.passwordHash);
    });

    it('should throw UnauthorizedException for inactive account', async () => {
      const inactiveUser = { ...mockUser, status: 'suspended' };
      usersService.findByEmail.mockResolvedValue(inactiveUser as unknown as ReturnType<UsersService['findByEmail']>);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(loginDto, deviceFingerprint)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto, deviceFingerprint)).rejects.toThrow('Account is suspended or deactivated');
    });

    it('should return mfaRequired: true when MFA is enabled but no code provided', async () => {
      const mfaUser = { ...mockUser, mfaEnabled: true, mfaSecret: 'encrypted-secret' };
      usersService.findByEmail.mockResolvedValue(mfaUser as unknown as ReturnType<UsersService['findByEmail']>);
      usersService.sanitize.mockReturnValue({
        id: mfaUser.id,
        email: mfaUser.email,
        fullName: mfaUser.fullName,
        status: mfaUser.status,
        emailVerified: mfaUser.emailVerified,
        mfaEnabled: mfaUser.mfaEnabled,
        createdAt: mfaUser.createdAt,
        updatedAt: mfaUser.updatedAt,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(loginDto, deviceFingerprint);

      expect(result.mfaRequired).toBe(true);
      expect(result.tokens.accessToken).toBe('');
      expect(result.tokens.refreshToken).toBe('');
      // MFA challenge response omits the admin flag (no membership resolved
      // yet) — always false until the second login call with mfaCode.
      expect(result.user).toEqual({
        ...usersService.sanitize(mfaUser),
        isPlatformAdmin: false,
      });
    });

    it('should successfully login with valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findByEmail']>);
      usersService.sanitize.mockReturnValue({
        id: mockUser.id,
        email: mockUser.email,
        fullName: mockUser.fullName,
        status: mockUser.status,
        emailVerified: mockUser.emailVerified,
        mfaEnabled: mockUser.mfaEnabled,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      prismaService.organizationMember.findFirst.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>);

      jwtService.sign.mockReturnValue('access-token-jwt');
      prismaService.refreshToken.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.refreshToken.create>);

      const result = await service.login(loginDto, deviceFingerprint);

      expect(result.mfaRequired).toBe(false);
      expect(result.tokens.accessToken).toBe('access-token-jwt');
      expect(result.tokens.refreshToken).toEqual(expect.any(String));
      expect(result.user).toEqual({
        ...usersService.sanitize(mockUser),
        isPlatformAdmin: false,
      });

      // Verify JWT payload
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: mockUser.id,
          email: mockUser.email,
          role: mockMembership.role,
          organizationId: mockMembership.organizationId,
          mfaVerified: true,
        }),
        expect.any(Object),
      );

      // Verify refresh token creation
      expect(prismaService.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: mockUser.id,
            deviceFingerprint,
            tokenHash: expect.any(String),
            familyId: expect.any(String),
            expiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should set isPlatformAdmin=true on login response when member has admin:* permissions', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findByEmail']>);
      usersService.sanitize.mockReturnValue({
        id: mockUser.id,
        email: mockUser.email,
        fullName: mockUser.fullName,
        status: mockUser.status,
        emailVerified: mockUser.emailVerified,
        mfaEnabled: mockUser.mfaEnabled,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      prismaService.organizationMember.findFirst.mockResolvedValue(
        mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>,
      );
      jwtService.sign.mockReturnValue('access-token-jwt');
      prismaService.refreshToken.create.mockResolvedValue(
        {} as unknown as ReturnType<typeof prismaService.refreshToken.create>,
      );

      const permissions = (await import('../rbac/permissions.service'))
        .PermissionsService.prototype;
      // Re-resolve the PermissionsService instance from the testing module so
      // we can override getEffectivePermissions for this single test.
      const permsInstance = (service as unknown as { permissions: typeof permissions })
        .permissions as unknown as { getEffectivePermissions: jest.Mock };
      permsInstance.getEffectivePermissions.mockResolvedValueOnce([
        'documents:read',
        'admin:billing',
      ]);

      const result = await service.login(loginDto, deviceFingerprint);

      expect(result.user.isPlatformAdmin).toBe(true);
      expect(permsInstance.getEffectivePermissions).toHaveBeenCalledWith(
        mockMembership.id,
      );
    });

    // ─── brute-force throttle wiring (LoginThrottleService) ───────────
    it('calls assertNotLocked BEFORE comparing credentials', async () => {
      const order: string[] = [];
      loginThrottle.assertNotLocked.mockImplementation(async () => {
        order.push('assertNotLocked');
      });
      usersService.findByEmail.mockImplementation(async () => {
        order.push('findByEmail');
        return mockUser as unknown as ReturnType<UsersService['findByEmail']>;
      });
      usersService.sanitize.mockReturnValue({} as never);
      (bcrypt.compare as jest.Mock).mockImplementation(async () => {
        order.push('bcrypt.compare');
        return true;
      });
      prismaService.organizationMember.findFirst.mockResolvedValue(
        mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>,
      );
      jwtService.sign.mockReturnValue('jwt');
      prismaService.refreshToken.create.mockResolvedValue({} as never);

      await service.login(loginDto, deviceFingerprint);

      expect(order[0]).toBe('assertNotLocked');
      expect(order.indexOf('assertNotLocked')).toBeLessThan(order.indexOf('bcrypt.compare'));
    });

    it('propagates the 429 from assertNotLocked and never reaches bcrypt.compare', async () => {
      const locked = new HttpException(
        { statusCode: 429, message: 'locked', retryAfter: 120 },
        HttpStatus.TOO_MANY_REQUESTS,
      );
      loginThrottle.assertNotLocked.mockRejectedValueOnce(locked);

      await expect(service.login(loginDto, deviceFingerprint)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      expect(usersService.findByEmail).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(loginThrottle.recordFailure).not.toHaveBeenCalled();
    });

    it('records a failure (both layers) and emits login_failed on a bad password', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findByEmail']>);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto, deviceFingerprint)).rejects.toThrow(UnauthorizedException);

      expect(loginThrottle.recordFailure).toHaveBeenCalledTimes(1);
      expect(loginThrottle.recordFailure).toHaveBeenCalledWith(loginDto.email, 'unknown');
      expect(loginThrottle.recordSuccess).not.toHaveBeenCalled();
      expect(loginEventService.record).toHaveBeenCalledWith(
        'login_failed',
        mockUser.id,
        null,
        { failureReason: 'invalid_password', deviceFingerprint },
      );
    });

    it('records a failure and emits login_failed on a bad MFA code', async () => {
      const mfaUser = { ...mockUser, mfaEnabled: true, mfaSecret: 'encrypted-secret' };
      usersService.findByEmail.mockResolvedValue(mfaUser as unknown as ReturnType<UsersService['findByEmail']>);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jest.spyOn(service, 'verifyTotp').mockReturnValue(false);

      await expect(
        service.login({ ...loginDto, mfaCode: '000000' }, deviceFingerprint),
      ).rejects.toThrow('Invalid MFA code');

      expect(loginThrottle.recordFailure).toHaveBeenCalledTimes(1);
      expect(loginEventService.record).toHaveBeenCalledWith(
        'login_failed',
        mfaUser.id,
        null,
        { failureReason: 'invalid_mfa', deviceFingerprint },
      );
    });

    it('clears the per-account counter via recordSuccess after a successful login', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findByEmail']>);
      usersService.sanitize.mockReturnValue({} as never);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prismaService.organizationMember.findFirst.mockResolvedValue(
        mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>,
      );
      jwtService.sign.mockReturnValue('jwt');
      prismaService.refreshToken.create.mockResolvedValue({} as never);

      await service.login(loginDto, deviceFingerprint);

      expect(loginThrottle.recordSuccess).toHaveBeenCalledTimes(1);
      expect(loginThrottle.recordSuccess).toHaveBeenCalledWith(loginDto.email, 'unknown');
      expect(loginThrottle.recordFailure).not.toHaveBeenCalled();
    });

    // ---- Layer-2 gap: failures must count on the early-return paths too ----

    it('records a failure (per-IP velocity) but emits NO login_failed for an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(service.login(loginDto, deviceFingerprint)).rejects.toThrow(
        'Invalid email or password',
      );

      // Per-IP counter must still increment so credential-stuffing across
      // unknown addresses is caught by Layer 2.
      expect(loginThrottle.recordFailure).toHaveBeenCalledTimes(1);
      expect(loginThrottle.recordFailure).toHaveBeenCalledWith(loginDto.email, 'unknown');
      // No user.id to attach; emitting here would also leak an enumeration oracle.
      expect(loginEventService.record).not.toHaveBeenCalled();
      expect(loginThrottle.recordSuccess).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('records a failure and emits login_failed (account_inactive) for a suspended account', async () => {
      const inactiveUser = { ...mockUser, status: 'suspended' };
      usersService.findByEmail.mockResolvedValue(
        inactiveUser as unknown as ReturnType<UsersService['findByEmail']>,
      );

      await expect(service.login(loginDto, deviceFingerprint)).rejects.toThrow(
        'Account is suspended or deactivated',
      );

      expect(loginThrottle.recordFailure).toHaveBeenCalledTimes(1);
      expect(loginThrottle.recordFailure).toHaveBeenCalledWith(loginDto.email, 'unknown');
      // Here we DO have user.id, so the failure is attributable.
      expect(loginEventService.record).toHaveBeenCalledWith(
        'login_failed',
        inactiveUser.id,
        null,
        { failureReason: 'account_inactive', deviceFingerprint },
      );
      // Gate is before the credential check.
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });

  describe('refreshTokens', () => {
    const deviceFingerprint = 'device-fp-abc';
    const rawRefreshToken = 'raw-refresh-token-hex';
    // Use originalCrypto directly since the jest.mock for crypto hasn't been
    // configured with mockImplementation yet at describe-block parse time.
    const tokenHash = (originalCrypto as typeof import('crypto')).createHash('sha256').update(rawRefreshToken).digest('hex');

    const mockStoredToken = {
      id: 'token-1',
      userId: 'user-123',
      tokenHash,
      familyId: 'family-abc',
      deviceFingerprint,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 86400_000), // 1 day from now
      createdAt: new Date(),
      user: mockUser,
    };

    it('should revoke entire family when token is already revoked (reuse detection)', async () => {
      // Atomic-claim flow: the guarded UPDATE matches zero rows (token
      // was already revoked by the legitimate rotator), service falls
      // through to reuse-detection lookup, then revokes the family.
      prismaService.refreshToken.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      prismaService.refreshToken.findFirst.mockResolvedValueOnce({
        ...mockStoredToken,
        isRevoked: true,
      });

      await expect(
        service.refreshTokens(rawRefreshToken, deviceFingerprint),
      ).rejects.toThrow(UnauthorizedException);

      expect(prismaService.refreshToken.updateMany).toHaveBeenNthCalledWith(1, {
        where: { tokenHash, isRevoked: false },
        data: { isRevoked: true },
      });
      expect(prismaService.refreshToken.updateMany).toHaveBeenNthCalledWith(2, {
        where: { familyId: 'family-abc' },
        data: { isRevoked: true },
      });
    });

    it('should reject with Invalid when no row exists for the hash', async () => {
      prismaService.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
      prismaService.refreshToken.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.refreshTokens(rawRefreshToken, deviceFingerprint),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should successfully rotate a non-revoked token', async () => {
      prismaService.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaService.refreshToken.findFirst
        .mockResolvedValueOnce(mockStoredToken) // post-claim load with user
        .mockResolvedValueOnce(null);           // replacedByTokenId lookup

      prismaService.organizationMember.findFirst.mockResolvedValue(mockMembership);
      prismaService.refreshToken.update.mockResolvedValue({});
      prismaService.refreshToken.create.mockResolvedValue({});
      jwtService.sign.mockReturnValue('fresh-access-token');

      const result = await service.refreshTokens(rawRefreshToken, deviceFingerprint);

      expect(result.accessToken).toBe('fresh-access-token');
      expect(result.refreshToken).toEqual(expect.any(String));
      // The atomic-claim UPDATE is the row revocation; the legacy
      // separate update() is no longer issued.
      expect(prismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash, isRevoked: false },
        data: { isRevoked: true },
      });
    });
  });

  describe('loginWithGoogle', () => {
    const googleProfile = {
      googleId: 'google-123',
      email: 'google@example.com',
      fullName: 'Google User',
    };

    const deviceFingerprint = 'device-fingerprint-456';

    it('should create new user when Google ID not found', async () => {
      const newUser = { ...mockUser, id: 'new-user-123', email: googleProfile.email, fullName: googleProfile.fullName, googleId: googleProfile.googleId, emailVerified: true };

      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createFromGoogle.mockResolvedValue(newUser as unknown as ReturnType<UsersService['createFromGoogle']>);
      usersService.sanitize.mockReturnValue({
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName,
        status: newUser.status,
        emailVerified: newUser.emailVerified,
        mfaEnabled: newUser.mfaEnabled,
        createdAt: newUser.createdAt,
        updatedAt: newUser.updatedAt,
      });

      prismaService.organization.create.mockResolvedValue(mockOrganization as unknown as ReturnType<typeof prismaService.organization.create>);
      prismaService.organizationMember.create.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.create>);
      prismaService.organizationMember.findFirst.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>);
      prismaService.subscription.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.subscription.create>);

      jwtService.sign.mockReturnValue('access-token-jwt');
      prismaService.refreshToken.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.refreshToken.create>);

      const result = await service.loginWithGoogle(googleProfile, deviceFingerprint);

      expect(result.isNewUser).toBe(true);
      expect(result.user.email).toBe(googleProfile.email);
      expect(result.tokens.accessToken).toBe('access-token-jwt');

      // Verify user creation
      expect(usersService.createFromGoogle).toHaveBeenCalledWith(googleProfile);

      // Verify organization creation
      expect(prismaService.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Google User's Workspace",
            type: 'individual',
          }),
        }),
      );

      // Verify membership and subscription
      expect(prismaService.organizationMember.create).toHaveBeenCalled();
      expect(prismaService.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: mockOrganization.id,
          planCode: 'free',
          status: 'active',
          seats: 1,
          entitlementsJson: {},
        }),
      });
    });

    it('should link Google account to existing user when found by email', async () => {
      const existingUser = { ...mockUser, googleId: null };
      const updatedUser = { ...existingUser, googleId: googleProfile.googleId, emailVerified: true };

      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(existingUser as unknown as ReturnType<UsersService['findByEmail']>);
      usersService.linkGoogleAccount.mockResolvedValue(undefined);
      usersService.sanitize.mockReturnValue({
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        status: updatedUser.status,
        emailVerified: updatedUser.emailVerified,
        mfaEnabled: updatedUser.mfaEnabled,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      });

      prismaService.user.update.mockResolvedValue(updatedUser as unknown as ReturnType<typeof prismaService.user.update>);
      prismaService.organizationMember.findFirst.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>);

      jwtService.sign.mockReturnValue('access-token-jwt');
      prismaService.refreshToken.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.refreshToken.create>);

      const result = await service.loginWithGoogle(googleProfile, deviceFingerprint);

      expect(result.isNewUser).toBe(false);
      expect(result.user.email).toBe(existingUser.email);
      expect(result.tokens.accessToken).toBe('access-token-jwt');

      // Verify Google account linking
      expect(usersService.linkGoogleAccount).toHaveBeenCalledWith(existingUser.id, googleProfile.googleId);

      // Verify email verified update
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: existingUser.id },
        data: { emailVerified: true, emailVerifyToken: null },
      });

      // Verify no new organization created
      expect(prismaService.organization.create).not.toHaveBeenCalled();
    });

    it('should login existing Google user directly', async () => {
      const googleUser = { ...mockUser, googleId: googleProfile.googleId, emailVerified: true };

      usersService.findByGoogleId.mockResolvedValue(googleUser as unknown as ReturnType<UsersService['findByGoogleId']>);
      usersService.sanitize.mockReturnValue({
        id: googleUser.id,
        email: googleUser.email,
        fullName: googleUser.fullName,
        status: googleUser.status,
        emailVerified: googleUser.emailVerified,
        mfaEnabled: googleUser.mfaEnabled,
        createdAt: googleUser.createdAt,
        updatedAt: googleUser.updatedAt,
      });

      prismaService.organizationMember.findFirst.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>);

      jwtService.sign.mockReturnValue('access-token-jwt');
      prismaService.refreshToken.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.refreshToken.create>);

      const result = await service.loginWithGoogle(googleProfile, deviceFingerprint);

      expect(result.isNewUser).toBe(false);
      expect(result.user.email).toBe(googleUser.email);
      expect(result.tokens.accessToken).toBe('access-token-jwt');

      // Verify no new user created
      expect(usersService.createFromGoogle).not.toHaveBeenCalled();
      expect(usersService.linkGoogleAccount).not.toHaveBeenCalled();

      // Verify JWT includes mfaVerified: true (Google OAuth skips MFA challenge)
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          mfaVerified: true,
        }),
        expect.any(Object),
      );
    });

    it('should throw UnauthorizedException for inactive Google account', async () => {
      const inactiveGoogleUser = { ...mockUser, googleId: googleProfile.googleId, status: 'deactivated' };

      usersService.findByGoogleId.mockResolvedValue(inactiveGoogleUser as unknown as ReturnType<UsersService['findByGoogleId']>);

      await expect(service.loginWithGoogle(googleProfile, deviceFingerprint)).rejects.toThrow(UnauthorizedException);
      await expect(service.loginWithGoogle(googleProfile, deviceFingerprint)).rejects.toThrow('Account is suspended or deactivated');
    });
  });

  describe('changePassword', () => {
    const userId = mockUser.id;

    beforeEach(() => {
      // Fresh transaction stub: resolves with array of update results.
      prismaService.$transaction.mockImplementation(async (ops: unknown[]) => {
        return ops.map(() => ({}));
      });
    });

    it('throws UnauthorizedException when current password is wrong', async () => {
      usersService.findById.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findById']>);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword(userId, 'wrong-current', 'BrandNewStrongPass!'),
      ).rejects.toThrow(UnauthorizedException);

      expect(prismaService.$transaction).not.toHaveBeenCalled();
      expect(prismaService.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when newPassword equals currentPassword', async () => {
      usersService.findById.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findById']>);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.changePassword(userId, 'SamePassword12', 'SamePassword12'),
      ).rejects.toThrow(BadRequestException);

      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user has no passwordHash (Google-only)', async () => {
      const googleOnly = { ...mockUser, passwordHash: null };
      usersService.findById.mockResolvedValue(googleOnly as unknown as ReturnType<UsersService['findById']>);

      await expect(
        service.changePassword(userId, 'anything', 'BrandNewStrongPass!'),
      ).rejects.toThrow(BadRequestException);

      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('hashes the new password and revokes all active refresh tokens on success', async () => {
      usersService.findById.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findById']>);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$12$newhashedpassword');
      prismaService.user.update.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.user.update>);
      prismaService.refreshToken.updateMany.mockResolvedValue({ count: 3 } as unknown as ReturnType<typeof prismaService.refreshToken.updateMany>);

      await service.changePassword(userId, 'OldPasswordOk!', 'BrandNewStrongPass!');

      expect(bcrypt.hash).toHaveBeenCalledWith('BrandNewStrongPass!', 12);
      expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
      // Inspect the operations passed to $transaction by re-invoking the
      // captured mocks — they are jest.fn() instances on the Prisma mock,
      // so prismaService.user.update and refreshToken.updateMany record
      // the calls the service builds inside the transaction array.
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { passwordHash: '$2b$12$newhashedpassword' },
      });
      expect(prismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      });
    });
  });

  // ─── login event hook coverage (Phase 2) ─────────────────
  describe('login event capture', () => {
    /** Helper: wait one macrotask so the fire-and-forget `void record(...)` runs */
    const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

    const sanitized = {
      id: mockUser.id,
      email: mockUser.email,
      fullName: mockUser.fullName,
      status: mockUser.status,
      emailVerified: mockUser.emailVerified,
      mfaEnabled: mockUser.mfaEnabled,
      createdAt: mockUser.createdAt,
      updatedAt: mockUser.updatedAt,
    };

    it('register records exactly one login_success event', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['create']>);
      usersService.sanitize.mockReturnValue(sanitized);
      prismaService.organization.create.mockResolvedValue(mockOrganization as unknown as ReturnType<typeof prismaService.organization.create>);
      prismaService.organizationMember.create.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.create>);
      prismaService.subscription.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.subscription.create>);
      prismaService.user.update.mockResolvedValue(mockUser as unknown as ReturnType<typeof prismaService.user.update>);

      await service.register({
        email: 'new@example.com',
        password: 'StrongPassword123!',
        fullName: 'New User',
      } as RegisterDto);
      await flushMicrotasks();

      expect(loginEventService.record).toHaveBeenCalledTimes(1);
      expect(loginEventService.record).toHaveBeenCalledWith(
        'login_success',
        mockUser.id,
        null,
        {},
      );
    });

    it('login records exactly one login_success event with deviceFingerprint', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findByEmail']>);
      usersService.sanitize.mockReturnValue(sanitized);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prismaService.organizationMember.findFirst.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>);
      jwtService.sign.mockReturnValue('jwt');
      prismaService.refreshToken.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.refreshToken.create>);

      await service.login(
        { email: mockUser.email, password: 'correct' } as LoginDto,
        'fp-1',
      );
      await flushMicrotasks();

      expect(loginEventService.record).toHaveBeenCalledTimes(1);
      expect(loginEventService.record).toHaveBeenCalledWith(
        'login_success',
        mockUser.id,
        null,
        { deviceFingerprint: 'fp-1' },
      );
    });

    it('loginWithGoogle records exactly one google_login event', async () => {
      const googleUser = { ...mockUser, googleId: 'g-1', emailVerified: true };
      usersService.findByGoogleId.mockResolvedValue(googleUser as unknown as ReturnType<UsersService['findByGoogleId']>);
      usersService.sanitize.mockReturnValue(sanitized);
      prismaService.organizationMember.findFirst.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>);
      jwtService.sign.mockReturnValue('jwt');
      prismaService.refreshToken.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.refreshToken.create>);

      await service.loginWithGoogle(
        { googleId: 'g-1', email: googleUser.email, fullName: googleUser.fullName },
        'fp-2',
      );
      await flushMicrotasks();

      expect(loginEventService.record).toHaveBeenCalledTimes(1);
      expect(loginEventService.record).toHaveBeenCalledWith(
        'google_login',
        mockUser.id,
        null,
        { deviceFingerprint: 'fp-2' },
      );
    });

    it('refreshTokens records exactly one token_refresh event', async () => {
      const rawRefreshToken = 'raw-token';
      const tokenHash = (originalCrypto as typeof import('crypto')).createHash('sha256').update(rawRefreshToken).digest('hex');
      const storedToken = {
        id: 'token-1',
        userId: mockUser.id,
        tokenHash,
        familyId: 'family-1',
        deviceFingerprint: 'fp-3',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        user: mockUser,
      };

      prismaService.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaService.refreshToken.findFirst
        .mockResolvedValueOnce(storedToken)
        .mockResolvedValueOnce(null);
      prismaService.organizationMember.findFirst.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>);
      prismaService.refreshToken.update.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.refreshToken.update>);
      prismaService.refreshToken.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.refreshToken.create>);
      jwtService.sign.mockReturnValue('jwt');

      await service.refreshTokens(rawRefreshToken, 'fp-3');
      await flushMicrotasks();

      expect(loginEventService.record).toHaveBeenCalledTimes(1);
      expect(loginEventService.record).toHaveBeenCalledWith(
        'token_refresh',
        mockUser.id,
        null,
        { deviceFingerprint: 'fp-3' },
      );
    });

    it('logout records exactly one logout event when the token is found', async () => {
      const storedToken = {
        id: 'token-2',
        userId: mockUser.id,
        tokenHash: 'hash',
        familyId: 'family-2',
        deviceFingerprint: 'fp-4',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
      };
      prismaService.refreshToken.findFirst.mockResolvedValueOnce(storedToken);
      prismaService.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.logout('some-refresh-token');
      await flushMicrotasks();

      expect(loginEventService.record).toHaveBeenCalledTimes(1);
      expect(loginEventService.record).toHaveBeenCalledWith(
        'logout',
        mockUser.id,
        null,
        {},
      );
    });

    it('logout records no event when refresh token does not match a row', async () => {
      prismaService.refreshToken.findFirst.mockResolvedValueOnce(null);

      await service.logout('unknown-token');
      await flushMicrotasks();

      expect(loginEventService.record).not.toHaveBeenCalled();
    });

    it('does not throw when login event recording rejects (fire-and-forget)', async () => {
      loginEventService.record.mockRejectedValueOnce(new Error('db down'));
      usersService.findByEmail.mockResolvedValue(mockUser as unknown as ReturnType<UsersService['findByEmail']>);
      usersService.sanitize.mockReturnValue(sanitized);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prismaService.organizationMember.findFirst.mockResolvedValue(mockMembership as unknown as ReturnType<typeof prismaService.organizationMember.findFirst>);
      jwtService.sign.mockReturnValue('jwt');
      prismaService.refreshToken.create.mockResolvedValue({} as unknown as ReturnType<typeof prismaService.refreshToken.create>);

      const result = await service.login(
        { email: mockUser.email, password: 'correct' } as LoginDto,
        'fp-err',
      );
      await flushMicrotasks();

      expect(result.mfaRequired).toBe(false);
      expect(result.tokens.accessToken).toBe('jwt');
    });
  });
});

/**
 * Integration: drive the REAL LoginThrottleService (backed by an in-memory
 * Redis) through AuthService.login to prove the Layer-2 gap is closed — failed
 * logins against UNKNOWN emails from one IP now feed the per-IP velocity counter
 * and trip the lock, exactly as a credential-stuffing run would be caught.
 */
describe('AuthService — Layer-2 per-IP velocity on unknown-email failures', () => {
  /** Minimal in-memory RedisService stand-in (counter + TTL per key). */
  class FakeRedis {
    readonly store = new Map<string, { value: number; ttl: number }>();
    async incr(key: string): Promise<number> {
      const existing = this.store.get(key);
      const value = (existing ? existing.value : 0) + 1;
      this.store.set(key, { value, ttl: existing ? existing.ttl : -1 });
      return value;
    }
    async expire(key: string, ttlSeconds: number): Promise<number> {
      const existing = this.store.get(key);
      if (!existing) return 0;
      existing.ttl = ttlSeconds;
      return 1;
    }
    async set(key: string, _value: string, ttlSeconds?: number): Promise<void> {
      this.store.set(key, { value: 1, ttl: ttlSeconds ?? -1 });
    }
    async del(key: string): Promise<number> {
      return this.store.delete(key) ? 1 : 0;
    }
    async ttl(key: string): Promise<number> {
      const existing = this.store.get(key);
      return existing ? existing.ttl : -2;
    }
  }

  const IP_THRESHOLD = 100;
  const configStub = {
    get: <T>(_key: string, def?: T): T => def as T,
  } as unknown as ConfigService;

  let svc: AuthService;
  let usersStub: { findByEmail: jest.Mock };

  beforeEach(() => {
    // Use real sha256 hashing for the per-account layer so distinct unknown
    // emails are correctly isolated (each hits its own account counter once,
    // never locking Layer 1 — only the shared per-IP counter accumulates).
    mockCreateHash.mockImplementation((algorithm: string) =>
      originalCrypto.createHash(algorithm),
    );

    const throttle = new LoginThrottleService(
      new FakeRedis() as unknown as RedisService,
      configStub,
    );
    usersStub = { findByEmail: jest.fn().mockResolvedValue(null) };

    svc = new AuthService(
      {} as unknown as PrismaService,
      usersStub as unknown as UsersService,
      {} as unknown as JwtService,
      configStub,
      {} as unknown as NotificationsService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as LoginEventService,
      {} as unknown as PermissionsService,
      throttle,
    );
  });

  afterEach(() => {
    mockCreateHash.mockReset();
  });

  it('trips the per-IP lock after AUTH_LOCK_IP_THRESHOLD unknown-email failures; a fresh attempt is 429', async () => {
    // Credential-stuffing simulation: distinct unknown addresses, one shared IP
    // (req=null → clientIp resolves to "unknown"). Each is an invalid-credential
    // rejection that must still bump the per-IP velocity counter.
    for (let i = 0; i < IP_THRESHOLD; i++) {
      await expect(
        svc.login({ email: `nobody${i}@example.com`, password: 'x' } as LoginDto, 'fp'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    // The IP is now locked: a brand-new attempt is rejected at the gate with 429,
    // before any credential check.
    let thrown: unknown;
    try {
      await svc.login({ email: 'fresh@example.com', password: 'x' } as LoginDto, 'fp');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    const body = (thrown as HttpException).getResponse() as { retryAfter: number };
    expect(body.retryAfter).toBe(900); // 15-min per-IP lock
  });
});

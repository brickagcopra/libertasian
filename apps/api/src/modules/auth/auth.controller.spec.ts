import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { AuditService } from '../audit/audit.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import type { LoginDto } from './dto';

// uuid is ESM-only; jest cannot transform it. The auth.service module loads
// it transitively, so mock it before importing the spec subjects.
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

// SocialTokenService is replaced with a stub below; mock its provider SDKs so
// importing the class never loads google-auth-library / jose.
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn(() => ({})) }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

import { SocialTokenService } from './social-token.service';

interface MockResponseShape {
  cookie: jest.Mock;
}

function buildResponse(): Response & MockResponseShape {
  const res: Partial<Response> & MockResponseShape = {
    cookie: jest.fn(),
  };
  return res as Response & MockResponseShape;
}

function buildRequest(opts: {
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  body?: Record<string, unknown>;
} = {}): Request {
  return {
    headers: opts.headers ?? {},
    cookies: opts.cookies ?? {},
    body: opts.body ?? {},
  } as unknown as Request;
}

describe('AuthController — mobile transport branch', () => {
  let controller: AuthController;
  let authService: {
    login: jest.Mock;
    refreshTokens: jest.Mock;
    logout: jest.Mock;
    loginWithGoogle: jest.Mock;
    loginWithApple: jest.Mock;
  };
  let auditService: { log: jest.Mock };
  let configService: { get: jest.Mock };
  let organizationsService: { acceptInvite: jest.Mock };
  let socialTokens: {
    googleConfigured: boolean;
    verifyGoogleIdToken: jest.Mock;
    verifyAppleIdentityToken: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refreshTokens: jest.fn(),
      logout: jest.fn(),
      loginWithGoogle: jest.fn(),
      loginWithApple: jest.fn(),
    };
    socialTokens = {
      googleConfigured: true,
      verifyGoogleIdToken: jest.fn(),
      verifyAppleIdentityToken: jest.fn(),
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    configService = {
      get: jest.fn((key: string, def?: unknown) => {
        const map: Record<string, unknown> = {
          NODE_ENV: 'test',
          APP_URL: 'http://localhost:3000',
          JWT_REFRESH_TTL: 604800,
        };
        return key in map ? map[key] : def;
      }),
    };
    organizationsService = { acceptInvite: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        Reflector,
        { provide: AuthService, useValue: authService },
        { provide: AuditService, useValue: auditService },
        { provide: ConfigService, useValue: configService },
        { provide: OrganizationsService, useValue: organizationsService },
        { provide: SocialTokenService, useValue: socialTokens },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('login', () => {
    const loginDto: LoginDto = { email: 'a@b.com', password: 'p' } as LoginDto;
    const tokens = { accessToken: 'AT', refreshToken: 'RT' };
    const user = { id: 'user-1', email: 'a@b.com' } as never;

    beforeEach(() => {
      authService.login.mockResolvedValue({ tokens, user, mfaRequired: false });
    });

    it('web client (no X-Client header): sets httpOnly cookie and omits refreshToken from body', async () => {
      const req = buildRequest({ headers: {} });
      const res = buildResponse();

      const result = await controller.login(loginDto, req, '1.2.3.4', 'ua', res);

      // Refresh cookie + companion persist cookie are both set
      expect(res.cookie).toHaveBeenCalledTimes(2);
      const refreshCall = res.cookie.mock.calls.find((c) => c[0] === 'libertasian-refresh');
      expect(refreshCall).toBeDefined();
      const [, cookieValue, cookieOpts] = refreshCall!;
      expect(cookieValue).toBe('RT');
      expect(cookieOpts).toMatchObject({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/v1/auth',
      });

      // Body must NOT contain refreshToken
      expect(result.success).toBe(true);
      expect(result.data.tokens).toEqual({ accessToken: 'AT' });
      expect((result.data.tokens as Record<string, unknown>)['refreshToken']).toBeUndefined();
      expect(result.data.mfaRequired).toBe(false);
    });

    // ---- "Keep me signed in" — persistent vs session cookie ----

    function findCookie(res: ReturnType<typeof buildResponse>, name: string) {
      const call = res.cookie.mock.calls.find((c) => c[0] === name);
      expect(call).toBeDefined();
      return { value: call![1], opts: call![2] as Record<string, unknown> };
    }

    it('(a) rememberMe:true → persistent refresh cookie with maxAge + persist=1', async () => {
      const req = buildRequest({ headers: {} });
      const res = buildResponse();

      await controller.login({ ...loginDto, rememberMe: true }, req, '1.2.3.4', 'ua', res);

      const refresh = findCookie(res, 'libertasian-refresh');
      expect(refresh.value).toBe('RT');
      expect(refresh.opts['maxAge']).toBe(604800 * 1000);

      const persist = findCookie(res, 'libertasian-persist');
      expect(persist.value).toBe('1');
      expect(persist.opts['maxAge']).toBe(604800 * 1000);
    });

    it('(b) rememberMe:false → session refresh cookie with no maxAge/expires + persist=0', async () => {
      const req = buildRequest({ headers: {} });
      const res = buildResponse();

      await controller.login({ ...loginDto, rememberMe: false }, req, '1.2.3.4', 'ua', res);

      const refresh = findCookie(res, 'libertasian-refresh');
      expect(refresh.value).toBe('RT');
      expect(refresh.opts).not.toHaveProperty('maxAge');
      expect(refresh.opts).not.toHaveProperty('expires');

      const persist = findCookie(res, 'libertasian-persist');
      expect(persist.value).toBe('0');
      expect(persist.opts).not.toHaveProperty('maxAge');
      expect(persist.opts).not.toHaveProperty('expires');
    });

    it('(c) rememberMe omitted → persistent (backward-compat)', async () => {
      const req = buildRequest({ headers: {} });
      const res = buildResponse();

      await controller.login(loginDto, req, '1.2.3.4', 'ua', res);

      const refresh = findCookie(res, 'libertasian-refresh');
      expect(refresh.opts['maxAge']).toBe(604800 * 1000);
      const persist = findCookie(res, 'libertasian-persist');
      expect(persist.value).toBe('1');
    });

    it('mobile client (X-Client: mobile): no Set-Cookie, refreshToken returned in body', async () => {
      const req = buildRequest({ headers: { 'x-client': 'mobile' } });
      const res = buildResponse();

      const result = await controller.login(loginDto, req, '1.2.3.4', 'ua', res);

      // No Set-Cookie issued for mobile
      expect(res.cookie).not.toHaveBeenCalled();

      // Body MUST contain both tokens
      expect(result.success).toBe(true);
      expect(result.data.tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT' });
      expect(result.data.mfaRequired).toBe(false);
    });

    it('mobile client header is case-insensitive', async () => {
      const req = buildRequest({ headers: { 'x-client': 'MoBiLe' } });
      const res = buildResponse();

      const result = await controller.login(loginDto, req, '1.2.3.4', 'ua', res);

      expect(res.cookie).not.toHaveBeenCalled();
      expect(result.data.tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT' });
    });

    it('mfaRequired login: never sets cookie or returns refreshToken', async () => {
      authService.login.mockResolvedValue({
        tokens: { accessToken: '', refreshToken: '' },
        user,
        mfaRequired: true,
      });

      const req = buildRequest({ headers: { 'x-client': 'mobile' } });
      const res = buildResponse();
      const result = await controller.login(loginDto, req, '1.2.3.4', 'ua', res);

      expect(res.cookie).not.toHaveBeenCalled();
      expect(result.data.mfaRequired).toBe(true);
      // Even on mobile, MFA-pending response excludes refreshToken (login not yet complete)
      expect((result.data.tokens as Record<string, unknown>)['refreshToken']).toBeUndefined();
    });
  });

  describe('refresh', () => {
    const tokens = { accessToken: 'AT2', refreshToken: 'RT2' };

    beforeEach(() => {
      authService.refreshTokens.mockResolvedValue(tokens);
    });

    it('web client: reads refresh token from cookie, rotates cookie, body has only accessToken', async () => {
      const req = buildRequest({ cookies: { 'libertasian-refresh': 'old-RT' } });
      const res = buildResponse();

      const result = await controller.refresh(req, '1.2.3.4', 'ua', res);

      expect(authService.refreshTokens).toHaveBeenCalledWith(
        'old-RT',
        expect.any(String),
        req,
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'libertasian-refresh',
        'RT2',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result.data).toEqual({ accessToken: 'AT2' });
    });

    function refreshCookieOpts(res: ReturnType<typeof buildResponse>, name: string) {
      const call = res.cookie.mock.calls.find((c) => c[0] === name);
      expect(call).toBeDefined();
      return call![2] as Record<string, unknown>;
    }

    it('(d) refresh with libertasian-persist="0" rotates as session cookie (no maxAge)', async () => {
      const req = buildRequest({
        cookies: { 'libertasian-refresh': 'old-RT', 'libertasian-persist': '0' },
      });
      const res = buildResponse();

      await controller.refresh(req, '1.2.3.4', 'ua', res);

      expect(refreshCookieOpts(res, 'libertasian-refresh')).not.toHaveProperty('maxAge');
      const persist = res.cookie.mock.calls.find((c) => c[0] === 'libertasian-persist');
      expect(persist![1]).toBe('0');
      expect(persist![2]).not.toHaveProperty('maxAge');
    });

    it('(e) refresh with libertasian-persist="1" rotates as persistent cookie (maxAge present)', async () => {
      const req = buildRequest({
        cookies: { 'libertasian-refresh': 'old-RT', 'libertasian-persist': '1' },
      });
      const res = buildResponse();

      await controller.refresh(req, '1.2.3.4', 'ua', res);

      expect(refreshCookieOpts(res, 'libertasian-refresh')['maxAge']).toBe(604800 * 1000);
      const persist = res.cookie.mock.calls.find((c) => c[0] === 'libertasian-persist');
      expect(persist![1]).toBe('1');
      expect(persist![2]).toMatchObject({ maxAge: 604800 * 1000 });
    });

    it('refresh with persist cookie absent → persistent (backward-compat)', async () => {
      const req = buildRequest({ cookies: { 'libertasian-refresh': 'old-RT' } });
      const res = buildResponse();

      await controller.refresh(req, '1.2.3.4', 'ua', res);

      expect(refreshCookieOpts(res, 'libertasian-refresh')['maxAge']).toBe(604800 * 1000);
    });

    it('mobile client: reads refresh token from request body, returns both tokens in body, no cookie', async () => {
      const req = buildRequest({
        headers: { 'x-client': 'mobile' },
        body: { refreshToken: 'old-RT' },
      });
      const res = buildResponse();

      const result = await controller.refresh(req, '1.2.3.4', 'ua', res);

      expect(authService.refreshTokens).toHaveBeenCalledWith(
        'old-RT',
        expect.any(String),
        req,
      );
      expect(res.cookie).not.toHaveBeenCalled();
      expect(result.data).toEqual({ accessToken: 'AT2', refreshToken: 'RT2' });
    });

    it('mobile client without refreshToken in body: 401 No refresh token', async () => {
      const req = buildRequest({ headers: { 'x-client': 'mobile' }, body: {} });
      const res = buildResponse();

      await expect(controller.refresh(req, '1.2.3.4', 'ua', res)).rejects.toMatchObject({
        message: 'No refresh token',
      });
      expect(authService.refreshTokens).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    const user = { sub: 'user-1' } as never;

    it('(f) web client: revokes from cookie + clears both refresh and persist cookies', async () => {
      const req = buildRequest({ cookies: { 'libertasian-refresh': 'RT' } });
      const res = buildResponse();

      await controller.logout(req, user, '1.2.3.4', res);

      expect(authService.logout).toHaveBeenCalledWith('RT', req);
      // clearRefreshCookie clears both cookies (empty value, maxAge: 0)
      expect(res.cookie).toHaveBeenCalledTimes(2);

      const refresh = res.cookie.mock.calls.find((c) => c[0] === 'libertasian-refresh');
      expect(refresh![1]).toBe('');
      expect(refresh![2]).toMatchObject({ maxAge: 0 });

      const persist = res.cookie.mock.calls.find((c) => c[0] === 'libertasian-persist');
      expect(persist![1]).toBe('');
      expect(persist![2]).toMatchObject({ maxAge: 0 });
    });

    it('mobile client: revokes from body + does not clear cookie', async () => {
      const req = buildRequest({
        headers: { 'x-client': 'mobile' },
        body: { refreshToken: 'RT' },
      });
      const res = buildResponse();

      await controller.logout(req, user, '1.2.3.4', res);

      expect(authService.logout).toHaveBeenCalledWith('RT', req);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('mobile client without refreshToken in body: still succeeds (no-op revoke)', async () => {
      const req = buildRequest({ headers: { 'x-client': 'mobile' }, body: {} });
      const res = buildResponse();

      await controller.logout(req, user, '1.2.3.4', res);

      expect(authService.logout).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  // ---- Mobile social login (ID-token exchange) ----

  describe('googleMobileLogin', () => {
    const tokens = { accessToken: 'AT', refreshToken: 'RT' };
    const user = { id: 'user-1', email: 'a@b.com', isPlatformAdmin: false } as never;
    const profile = { googleId: 'g-sub', email: 'a@b.com', fullName: 'A B' };

    beforeEach(() => {
      socialTokens.verifyGoogleIdToken.mockResolvedValue(profile);
      authService.loginWithGoogle.mockResolvedValue({ tokens, user, isNewUser: false });
    });

    it('mobile client: verifies token, returns both tokens in body, no cookie', async () => {
      const req = buildRequest({ headers: { 'x-client': 'mobile' } });
      const res = buildResponse();

      const result = await controller.googleMobileLogin(
        { idToken: 'google-id-token' },
        req,
        '1.2.3.4',
        'ua',
        res,
      );

      expect(socialTokens.verifyGoogleIdToken).toHaveBeenCalledWith('google-id-token');
      expect(authService.loginWithGoogle).toHaveBeenCalledWith(
        profile,
        expect.any(String),
        req,
      );
      expect(res.cookie).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data.tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT' });
      expect(result.data.user).toBe(user);
      expect(result.data.mfaRequired).toBe(false);
    });

    it('without X-Client header: sets httpOnly cookie, omits refreshToken from body', async () => {
      const req = buildRequest({ headers: {} });
      const res = buildResponse();

      const result = await controller.googleMobileLogin(
        { idToken: 't' },
        req,
        '1.2.3.4',
        'ua',
        res,
      );

      const refreshCall = res.cookie.mock.calls.find((c) => c[0] === 'libertasian-refresh');
      expect(refreshCall).toBeDefined();
      expect(refreshCall![1]).toBe('RT');
      expect(result.data.tokens).toEqual({ accessToken: 'AT' });
    });

    it('audit-logs auth.google_login for an existing user', async () => {
      const req = buildRequest({ headers: { 'x-client': 'mobile' } });

      await controller.googleMobileLogin({ idToken: 't' }, req, '1.2.3.4', 'ua', buildResponse());

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.google_login',
          metadata: expect.objectContaining({ provider: 'google' }),
        }),
      );
    });

    it('audit-logs auth.google_register for a new user', async () => {
      authService.loginWithGoogle.mockResolvedValue({ tokens, user, isNewUser: true });
      const req = buildRequest({ headers: { 'x-client': 'mobile' } });

      await controller.googleMobileLogin({ idToken: 't' }, req, '1.2.3.4', 'ua', buildResponse());

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.google_register' }),
      );
    });

    it('returns 503 when no Google client IDs are configured', async () => {
      socialTokens.googleConfigured = false;
      const req = buildRequest({ headers: { 'x-client': 'mobile' } });

      await expect(
        controller.googleMobileLogin({ idToken: 't' }, req, '1.2.3.4', 'ua', buildResponse()),
      ).rejects.toMatchObject({ status: 503 });
      expect(socialTokens.verifyGoogleIdToken).not.toHaveBeenCalled();
    });

    it('propagates the generic 401 from the verifier without calling AuthService', async () => {
      socialTokens.verifyGoogleIdToken.mockRejectedValue(
        Object.assign(new Error('Invalid Google credential'), { status: 401 }),
      );
      const req = buildRequest({ headers: { 'x-client': 'mobile' } });

      await expect(
        controller.googleMobileLogin({ idToken: 'bad' }, req, '1.2.3.4', 'ua', buildResponse()),
      ).rejects.toMatchObject({ message: 'Invalid Google credential' });
      expect(authService.loginWithGoogle).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('appleMobileLogin', () => {
    const tokens = { accessToken: 'AT', refreshToken: 'RT' };
    const user = { id: 'user-1', email: 'a@b.com', isPlatformAdmin: false } as never;
    const profile = { appleId: 'apple-sub', email: 'relay@privaterelay.appleid.com' };

    beforeEach(() => {
      socialTokens.verifyAppleIdentityToken.mockResolvedValue(profile);
      authService.loginWithApple.mockResolvedValue({ tokens, user, isNewUser: false });
    });

    it('mobile client: verifies token, forwards optional fullName, returns tokens in body', async () => {
      const req = buildRequest({ headers: { 'x-client': 'mobile' } });
      const res = buildResponse();

      const result = await controller.appleMobileLogin(
        { identityToken: 'apple-jwt', fullName: 'Juan Dela Cruz' },
        req,
        '1.2.3.4',
        'ua',
        res,
      );

      expect(socialTokens.verifyAppleIdentityToken).toHaveBeenCalledWith('apple-jwt');
      expect(authService.loginWithApple).toHaveBeenCalledWith(
        { ...profile, fullName: 'Juan Dela Cruz' },
        expect.any(String),
        req,
      );
      expect(res.cookie).not.toHaveBeenCalled();
      expect(result.data.tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT' });
      expect(result.data.mfaRequired).toBe(false);
    });

    it('omitted fullName is forwarded as undefined (server falls back to email local-part)', async () => {
      const req = buildRequest({ headers: { 'x-client': 'mobile' } });

      await controller.appleMobileLogin(
        { identityToken: 'apple-jwt' },
        req,
        '1.2.3.4',
        'ua',
        buildResponse(),
      );

      expect(authService.loginWithApple).toHaveBeenCalledWith(
        { ...profile, fullName: undefined },
        expect.any(String),
        req,
      );
    });

    it('audit-logs auth.apple_login / auth.apple_register by isNewUser', async () => {
      const req = buildRequest({ headers: { 'x-client': 'mobile' } });

      await controller.appleMobileLogin({ identityToken: 't' }, req, '1.2.3.4', 'ua', buildResponse());
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.apple_login',
          metadata: expect.objectContaining({ provider: 'apple' }),
        }),
      );

      auditService.log.mockClear();
      authService.loginWithApple.mockResolvedValue({ tokens, user, isNewUser: true });
      await controller.appleMobileLogin({ identityToken: 't' }, req, '1.2.3.4', 'ua', buildResponse());
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.apple_register' }),
      );
    });

    it('propagates the generic 401 from the verifier without calling AuthService', async () => {
      socialTokens.verifyAppleIdentityToken.mockRejectedValue(
        Object.assign(new Error('Invalid Apple credential'), { status: 401 }),
      );
      const req = buildRequest({ headers: { 'x-client': 'mobile' } });

      await expect(
        controller.appleMobileLogin({ identityToken: 'bad' }, req, '1.2.3.4', 'ua', buildResponse()),
      ).rejects.toMatchObject({ message: 'Invalid Apple credential' });
      expect(authService.loginWithApple).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });
});

// @nestjs/throttler stores decorator config as reflect-metadata keyed by
// `<CONSTANT><throttler-name>` (the default throttler's name is 'default').
// These keys are part of the package's stable metadata contract.
const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL_DEFAULT = 'THROTTLER:TTLdefault';
const THROTTLER_SKIP_DEFAULT = 'THROTTLER:SKIPdefault';

describe('AuthController — rate-limit configuration', () => {
  it('class-level @Throttle is the coarse per-IP backstop: 60 requests / 15 min', () => {
    expect(Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, AuthController)).toBe(60);
    expect(Reflect.getMetadata(THROTTLER_TTL_DEFAULT, AuthController)).toBe(900000);
  });

  it('refresh handler opts out of the auth bucket via @SkipThrottle', () => {
    expect(
      Reflect.getMetadata(THROTTLER_SKIP_DEFAULT, AuthController.prototype.refresh),
    ).toBe(true);
  });

  it('login handler is NOT skipped (still subject to the coarse backstop)', () => {
    expect(
      Reflect.getMetadata(THROTTLER_SKIP_DEFAULT, AuthController.prototype.login),
    ).toBeUndefined();
  });
});

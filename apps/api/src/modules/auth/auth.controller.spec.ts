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
  let authService: { login: jest.Mock; refreshTokens: jest.Mock; logout: jest.Mock };
  let auditService: { log: jest.Mock };
  let configService: { get: jest.Mock };
  let organizationsService: { acceptInvite: jest.Mock };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refreshTokens: jest.fn(),
      logout: jest.fn(),
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

      // Cookie set with the refresh token
      expect(res.cookie).toHaveBeenCalledTimes(1);
      const [cookieName, cookieValue, cookieOpts] = res.cookie.mock.calls[0];
      expect(cookieName).toBe('libertasian-refresh');
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

    it('web client: revokes from cookie + clears cookie', async () => {
      const req = buildRequest({ cookies: { 'libertasian-refresh': 'RT' } });
      const res = buildResponse();

      await controller.logout(req, user, '1.2.3.4', res);

      expect(authService.logout).toHaveBeenCalledWith('RT', req);
      // clearRefreshCookie also calls res.cookie (with empty value, maxAge: 0)
      expect(res.cookie).toHaveBeenCalledTimes(1);
      const [, value, opts] = res.cookie.mock.calls[0];
      expect(value).toBe('');
      expect(opts).toMatchObject({ maxAge: 0 });
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
});

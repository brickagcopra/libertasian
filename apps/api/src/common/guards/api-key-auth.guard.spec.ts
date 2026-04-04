import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

function createMockContext(
  headers: Record<string, string | undefined>,
): { context: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = { headers };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('ApiKeyAuthGuard', () => {
  let guard: ApiKeyAuthGuard;
  let prisma: jest.Mocked<PrismaService>;
  let reflector: Reflector;

  const rawKey = 'test-api-key-12345';
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const mockApiKey = {
    id: 'key-123',
    userId: 'user-456',
    organizationId: 'org-789',
    keyHash,
    name: 'Test Key',
    permissions: ['search', 'documents:read'],
    isActive: true,
    expiresAt: new Date(Date.now() + 86400000), // tomorrow
    lastUsedAt: null,
    organization: { id: 'org-789', slug: 'test-org' },
    user: { id: 'user-456', email: 'test@example.com', fullName: 'Test User' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      apiKey: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as jest.Mocked<PrismaService>;

    reflector = new Reflector();
    guard = new ApiKeyAuthGuard(prisma, reflector);
  });

  describe('missing header', () => {
    it('should throw UnauthorizedException when X-API-Key header is missing', async () => {
      const { context } = createMockContext({});
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when X-API-Key is undefined', async () => {
      const { context } = createMockContext({ 'x-api-key': undefined });
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should include message about missing header', async () => {
      const { context } = createMockContext({});
      try {
        await guard.canActivate(context);
        fail('Expected UnauthorizedException');
      } catch (err) {
        expect((err as UnauthorizedException).message).toContain(
          'Missing X-API-Key',
        );
      }
    });
  });

  describe('invalid key', () => {
    it('should throw UnauthorizedException when key is not found in DB', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
      const { context } = createMockContext({
        'x-api-key': 'nonexistent-key',
      });
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw when key is deactivated', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
        ...mockApiKey,
        isActive: false,
      });
      const { context } = createMockContext({ 'x-api-key': rawKey });
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw when key is expired', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
        ...mockApiKey,
        expiresAt: new Date(Date.now() - 86400000), // yesterday
      });
      const { context } = createMockContext({ 'x-api-key': rawKey });
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('valid key', () => {
    it('should allow valid active non-expired key', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(mockApiKey);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext({ 'x-api-key': rawKey });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('should allow key with no expiry date (never expires)', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
        ...mockApiKey,
        expiresAt: null,
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext({ 'x-api-key': rawKey });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('should attach synthetic user object to request', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(mockApiKey);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, request } = createMockContext({
        'x-api-key': rawKey,
      });
      await guard.canActivate(context);
      expect(request['user']).toEqual(
        expect.objectContaining({
          sub: 'user-456',
          email: 'test@example.com',
          organizationId: 'org-789',
          isApiKey: true,
          apiKeyId: 'key-123',
        }),
      );
    });

    it('should update lastUsedAt (fire-and-forget)', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(mockApiKey);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext({ 'x-api-key': rawKey });
      await guard.canActivate(context);
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-123' },
        data: { lastUsedAt: expect.any(Date) },
      });
    });
  });

  describe('permission checks', () => {
    it('should allow when key has all required permissions', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(mockApiKey);
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['search']);
      const { context } = createMockContext({ 'x-api-key': rawKey });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('should throw ForbiddenException when key lacks required permissions', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(mockApiKey);
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['admin:write']);
      const { context } = createMockContext({ 'x-api-key': rawKey });
      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should include missing permissions in error message', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(mockApiKey);
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['admin:write', 'admin:delete']);
      const { context } = createMockContext({ 'x-api-key': rawKey });
      try {
        await guard.canActivate(context);
        fail('Expected ForbiddenException');
      } catch (err) {
        const msg = (err as ForbiddenException).message;
        expect(msg).toContain('admin:write');
        expect(msg).toContain('admin:delete');
      }
    });

    it('should allow when no permissions are required', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(mockApiKey);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext({ 'x-api-key': rawKey });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('should allow when permissions array is empty', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(mockApiKey);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
      const { context } = createMockContext({ 'x-api-key': rawKey });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('SHA256 key hashing', () => {
    it('should look up key by SHA256 hash, not raw value', async () => {
      (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext({ 'x-api-key': rawKey });
      try {
        await guard.canActivate(context);
      } catch {
        /* expected */
      }
      expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
        where: { keyHash },
        include: expect.any(Object),
      });
    });
  });
});

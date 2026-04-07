import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ApiKeysService } from './api-keys.service';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let prisma: {
    apiKey: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock; delete: jest.Mock; count: jest.Mock };
  };
  let subscriptions: { getEntitlements: jest.Mock };

  const organizationId = 'org-1';
  const userId = 'user-1';
  const now = new Date();

  const mockApiKey = {
    id: 'key-1',
    organizationId,
    userId,
    name: 'Test Key',
    keyHash: 'hashed-value',
    keyPrefix: 'lib_abc1234',
    permissions: ['search', 'documents:read'],
    rateLimitPerMinute: 60,
    isActive: true,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(async () => {
    prisma = {
      apiKey: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    subscriptions = { getEntitlements: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: prisma },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();

    service = module.get(ApiKeysService);
  });

  describe('create', () => {
    const dto = {
      name: 'Test Key',
      permissions: ['search', 'documents:read'],
    };

    it('should create API key and return raw key', async () => {
      subscriptions.getEntitlements.mockResolvedValue({ maxApiKeys: 10 });
      prisma.apiKey.count.mockResolvedValue(2);
      prisma.apiKey.create.mockResolvedValue(mockApiKey);

      const result = await service.create(organizationId, userId, dto as never);

      expect(result.id).toBe('key-1');
      expect(result.key).toMatch(/^lib_[0-9a-f]{64}$/);
      expect(result.keyPrefix).toBe(mockApiKey.keyPrefix);
      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId,
            userId,
            name: 'Test Key',
            permissions: ['search', 'documents:read'],
          }),
        }),
      );
    });

    it('should throw BadRequestException for invalid permissions', async () => {
      await expect(
        service.create(organizationId, userId, {
          name: 'Bad Key',
          permissions: ['search', 'invalid_perm'],
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when key limit reached', async () => {
      subscriptions.getEntitlements.mockResolvedValue({ maxApiKeys: 3 });
      prisma.apiKey.count.mockResolvedValue(3);

      await expect(
        service.create(organizationId, userId, dto as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow creation when maxApiKeys is null (unlimited)', async () => {
      subscriptions.getEntitlements.mockResolvedValue({ maxApiKeys: null });
      prisma.apiKey.create.mockResolvedValue(mockApiKey);

      const result = await service.create(organizationId, userId, dto as never);

      expect(result.id).toBe('key-1');
      expect(prisma.apiKey.count).not.toHaveBeenCalled();
    });

    it('should use default rate limit of 60', async () => {
      subscriptions.getEntitlements.mockResolvedValue({ maxApiKeys: null });
      prisma.apiKey.create.mockResolvedValue(mockApiKey);

      await service.create(organizationId, userId, dto as never);

      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rateLimitPerMinute: 60 }),
        }),
      );
    });

    it('should set expiresAt when provided', async () => {
      subscriptions.getEntitlements.mockResolvedValue({ maxApiKeys: null });
      prisma.apiKey.create.mockResolvedValue(mockApiKey);

      await service.create(organizationId, userId, {
        ...dto,
        expiresAt: '2027-01-01T00:00:00Z',
      } as never);

      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expiresAt: new Date('2027-01-01T00:00:00Z'),
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated keys', async () => {
      prisma.apiKey.findMany.mockResolvedValue([{
        ...mockApiKey,
        lastUsedAt: null,
        expiresAt: null,
      }]);

      const result = await service.findAll(organizationId, {} as never);

      expect(result.data).toHaveLength(1);
      expect(result.hasNext).toBe(false);
      expect(result.data[0]!.permissions).toEqual(['search', 'documents:read']);
    });

    it('should detect hasNext and pop extra item', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        ...mockApiKey,
        id: `key-${i}`,
        lastUsedAt: null,
        expiresAt: null,
      }));
      prisma.apiKey.findMany.mockResolvedValue(items);

      const result = await service.findAll(organizationId, {} as never);

      expect(result.data).toHaveLength(20);
      expect(result.hasNext).toBe(true);
    });

    it('should serialize dates to ISO strings', async () => {
      prisma.apiKey.findMany.mockResolvedValue([{
        ...mockApiKey,
        lastUsedAt: new Date('2026-01-15T10:00:00Z'),
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      }]);

      const result = await service.findAll(organizationId, {} as never);

      expect(result.data[0]!.lastUsedAt).toBe('2026-01-15T10:00:00.000Z');
      expect(result.data[0]!.expiresAt).toBe('2027-01-01T00:00:00.000Z');
    });
  });

  describe('findOne', () => {
    it('should return API key', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        ...mockApiKey,
        lastUsedAt: null,
        expiresAt: null,
      });

      const result = await service.findOne(organizationId, 'key-1');

      expect(result.id).toBe('key-1');
      expect(result.permissions).toEqual(['search', 'documents:read']);
    });

    it('should throw NotFoundException', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(organizationId, 'key-999'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update API key properties', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(mockApiKey);
      prisma.apiKey.update.mockResolvedValue({
        ...mockApiKey,
        name: 'Updated Key',
        lastUsedAt: null,
        expiresAt: null,
      });

      const result = await service.update(organizationId, 'key-1', {
        name: 'Updated Key',
      } as never);

      expect(result.name).toBe('Updated Key');
    });

    it('should throw NotFoundException', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(
        service.update(organizationId, 'key-999', { name: 'X' } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('should validate permissions on update', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(mockApiKey);

      await expect(
        service.update(organizationId, 'key-1', {
          permissions: ['invalid_perm'],
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow deactivation', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(mockApiKey);
      prisma.apiKey.update.mockResolvedValue({
        ...mockApiKey,
        isActive: false,
        lastUsedAt: null,
        expiresAt: null,
      });

      const result = await service.update(organizationId, 'key-1', {
        isActive: false,
      } as never);

      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('should hard delete API key', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(mockApiKey);
      prisma.apiKey.delete.mockResolvedValue(mockApiKey);

      await service.remove(organizationId, 'key-1');

      expect(prisma.apiKey.delete).toHaveBeenCalledWith({ where: { id: 'key-1' } });
    });

    it('should throw NotFoundException', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(
        service.remove(organizationId, 'key-999'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

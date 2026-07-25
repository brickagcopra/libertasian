import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { PonenteDirectoryService } from './ponente-directory.service';

describe('PonenteDirectoryService', () => {
  let service: PonenteDirectoryService;
  let prisma: { legalDocument: { findMany: jest.Mock } };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    prisma = { legalDocument: { findMany: jest.fn().mockResolvedValue([]) } };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PonenteDirectoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(PonenteDirectoryService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.clearAllMocks());

  it('reduces free-text ponente values to searchable surname tokens', async () => {
    prisma.legalDocument.findMany.mockResolvedValue([
      { ponente: 'HERNANDO, J.' },
      { ponente: 'Lopez, M., J.' },
      { ponente: 'Gaerlan' },
      { ponente: 'CAGUIOA, J.' },
    ]);

    const names = await service.getPonenteNames();

    expect(names.has('HERNANDO')).toBe(true);
    expect(names.has('LOPEZ')).toBe(true);
    expect(names.has('GAERLAN')).toBe(true);
    expect(names.has('CAGUIOA')).toBe(true);
  });

  it.each(['J', 'JR', 'SR', 'CJ', 'M'])(
    'drops the honorific/initial token %s',
    async (token) => {
      prisma.legalDocument.findMany.mockResolvedValue([
        { ponente: `HERNANDO, ${token}.` },
      ]);

      const names = await service.getPonenteNames();
      expect(names.has(token)).toBe(false);
      expect(names.has('HERNANDO')).toBe(true);
    },
  );

  it('serves from the Redis cache without touching PostgreSQL', async () => {
    redis.get.mockResolvedValue(JSON.stringify(['HERNANDO', 'LOPEZ']));

    const names = await service.getPonenteNames();

    expect(names.has('HERNANDO')).toBe(true);
    expect(prisma.legalDocument.findMany).not.toHaveBeenCalled();
  });

  it('writes the loaded set back to Redis with a TTL', async () => {
    prisma.legalDocument.findMany.mockResolvedValue([{ ponente: 'HERNANDO, J.' }]);

    await service.getPonenteNames();

    expect(redis.set).toHaveBeenCalledWith(
      'cache:search:ponente_directory',
      JSON.stringify(['HERNANDO']),
      3600,
    );
  });

  it('memoizes so repeated searches do not hit Redis on every query', async () => {
    prisma.legalDocument.findMany.mockResolvedValue([{ ponente: 'HERNANDO, J.' }]);

    await service.getPonenteNames();
    await service.getPonenteNames();
    await service.getPonenteNames();

    expect(redis.get).toHaveBeenCalledTimes(1);
  });

  // Fail-open is the whole contract: a degraded directory costs relevance,
  // never availability.
  it('fails open to an empty set when Redis is down', async () => {
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    prisma.legalDocument.findMany.mockResolvedValue([{ ponente: 'HERNANDO, J.' }]);

    const names = await service.getPonenteNames();
    expect(names.has('HERNANDO')).toBe(true);
  });

  it('fails open to an empty set when PostgreSQL errors', async () => {
    prisma.legalDocument.findMany.mockRejectedValue(new Error('connection lost'));

    await expect(service.getPonenteNames()).resolves.toEqual(new Set());
  });

  it('ignores a corrupt cache entry rather than throwing', async () => {
    redis.get.mockResolvedValue('not json');
    prisma.legalDocument.findMany.mockResolvedValue([{ ponente: 'LOPEZ, J.' }]);

    const names = await service.getPonenteNames();
    expect(names.has('LOPEZ')).toBe(true);
  });

  it('invalidate() clears both cache layers', async () => {
    prisma.legalDocument.findMany.mockResolvedValue([{ ponente: 'HERNANDO, J.' }]);
    await service.getPonenteNames();

    await service.invalidate();
    await service.getPonenteNames();

    expect(redis.del).toHaveBeenCalledWith('cache:search:ponente_directory');
    expect(redis.get).toHaveBeenCalledTimes(2);
  });
});

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { ContentDisclaimersService } from './content-disclaimers.service';

interface FakeRow {
  id: string;
  contentClass: string;
  bodyHtml: string;
  bodyPlain: string;
  version: number;
  isActive: boolean;
  authorNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const makeRow = (contentClass: string, overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: `id-${contentClass}`,
  contentClass,
  bodyHtml: `<p>${contentClass} html</p>`,
  bodyPlain: `${contentClass} plain`,
  version: 1,
  isActive: true,
  authorNote: 'seed note',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const CANONICAL_CLASSES = [
  'ai_digest',
  'ai_mcq',
  'ai_suggested_bar_answer',
  'sample_pleading',
  'sample_contract',
];

describe('ContentDisclaimersService', () => {
  let service: ContentDisclaimersService;
  let prisma: { contentDisclaimer: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      contentDisclaimer: {
        findMany: jest.fn().mockResolvedValue(CANONICAL_CLASSES.map((c) => makeRow(c))),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentDisclaimersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ContentDisclaimersService);
  });

  describe('onModuleInit + loadCache', () => {
    it('loads all active rows into the in-memory cache', async () => {
      await service.onModuleInit();

      expect(prisma.contentDisclaimer.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
      });

      const all = await service.getAll();
      expect(all).toHaveLength(5);
      expect(all.map((r) => r.contentClass).sort()).toEqual(
        [...CANONICAL_CLASSES].sort(),
      );
    });

    it('logs a warning but does not throw when the table is empty', async () => {
      prisma.contentDisclaimer.findMany.mockResolvedValueOnce([]);
      await expect(service.onModuleInit()).resolves.not.toThrow();
      // getByContentClass should still fail closed for an empty cache.
      await expect(service.getByContentClass('ai_digest')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getByContentClass', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it.each(CANONICAL_CLASSES)(
      'returns the seeded row for contentClass=%s',
      async (contentClass) => {
        const row = await service.getByContentClass(contentClass);
        expect(row.contentClass).toBe(contentClass);
        expect(row.bodyHtml).toContain(contentClass);
        expect(row.bodyPlain).toContain(contentClass);
        expect(row.version).toBe(1);
      },
    );

    it('throws NotFoundException for an unknown contentClass', async () => {
      await expect(
        service.getByContentClass('not_a_real_class'),
      ).rejects.toThrow(NotFoundException);
    });

    it('hits the in-memory cache on repeat lookups (no extra DB calls)', async () => {
      // onModuleInit was called in beforeEach, so findMany should be at 1.
      expect(prisma.contentDisclaimer.findMany).toHaveBeenCalledTimes(1);

      for (let i = 0; i < 10; i++) {
        await service.getByContentClass('ai_digest');
      }

      // Still 1 — the cache absorbed every call after init.
      expect(prisma.contentDisclaimer.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEnvelope', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('returns only the envelope-safe projection (no id/timestamps)', async () => {
      const envelope = await service.getEnvelope('ai_mcq');
      expect(Object.keys(envelope).sort()).toEqual(
        ['bodyHtml', 'bodyPlain', 'contentClass', 'version'].sort(),
      );
      expect(envelope.contentClass).toBe('ai_mcq');
      expect(envelope.bodyHtml).toContain('ai_mcq');
    });

    it('propagates NotFoundException from getByContentClass', async () => {
      await expect(service.getEnvelope('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('invalidateCache', () => {
    it('forces a reload from the database on next access', async () => {
      await service.onModuleInit();
      expect(prisma.contentDisclaimer.findMany).toHaveBeenCalledTimes(1);

      await service.invalidateCache();
      // invalidateCache calls loadCache internally.
      expect(prisma.contentDisclaimer.findMany).toHaveBeenCalledTimes(2);
    });
  });
});

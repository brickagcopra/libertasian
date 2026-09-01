import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { JwtPayload } from '@libertasian/types';

import type { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { BarExamsController } from './bar-exams.controller';
import { BarExamsService } from './bar-exams.service';

const passingGuard = {
  canActivate: jest.fn((_ctx: ExecutionContext) => true),
};

/** A signed-in, non-admin caller on a paying org. */
const USER = {
  sub: 'user-1',
  organizationId: 'org-1',
  isPlatformAdmin: false,
} as unknown as JwtPayload;

/** Same caller, but with any `admin:*` permission resolved by JwtStrategy. */
const ADMIN = { ...USER, isPlatformAdmin: true } as unknown as JwtPayload;

const REQ = { method: 'GET', path: '/bar-exams' } as unknown as Request;

describe('BarExamsController (authenticated)', () => {
  let controller: BarExamsController;
  let resolveEffectiveEntitlements: jest.Mock;
  let recordBypass: jest.Mock;
  let prisma: {
    barExamSitting: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      barExamSitting: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    // Default: an entitled org, so the pre-existing content assertions below
    // exercise the same paths they always did.
    resolveEffectiveEntitlements = jest.fn().mockResolvedValue({
      previewOnly: false,
    });
    recordBypass = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BarExamsController],
      providers: [
        BarExamsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EntitlementService,
          useValue: { resolveEffectiveEntitlements },
        },
        { provide: AdminBypassAuditService, useValue: { record: recordBypass } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(passingGuard)
      .compile();

    controller = module.get<BarExamsController>(BarExamsController);
  });

  describe('GET /bar-exams', () => {
    it('returns sittings grouped by year DESC, only those with a source document', async () => {
      prisma.barExamSitting.findMany.mockResolvedValue([
        {
          id: 's1',
          year: 2022,
          part: 'I',
          subjectStudyCode: 'civil_law',
          subjectBarAdminCode: 'civil_land_titles',
          chairperson: 'Caguioa',
          sourceUrl: 'https://lawphil.net/.../civil-I_Q.html',
          _count: { questions: 15 },
        },
        {
          id: 's2',
          year: 2018,
          part: null,
          subjectStudyCode: 'criminal_law',
          subjectBarAdminCode: 'criminal',
          chairperson: 'Del Castillo',
          sourceUrl: 'https://lawphil.net/.../criminalQ.html',
          _count: { questions: 19 },
        },
      ]);

      const result = await controller.list(USER, REQ, 'ios');

      // Public sittings query must filter on sourceDocumentId not null
      const callArgs = prisma.barExamSitting.findMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({ sourceDocumentId: { not: null } });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.year).toBe(2022);
      expect(result.data[1]!.year).toBe(2018);
      expect(result.data[0]!.subjects[0]!.questionCount).toBe(15);
    });

    it('returns an empty array when no sittings exist', async () => {
      prisma.barExamSitting.findMany.mockResolvedValue([]);
      const result = await controller.list(USER, REQ, 'ios');
      expect(result.data).toEqual([]);
    });
  });

  describe('GET /bar-exams/:year', () => {
    it('returns subjects for the year', async () => {
      prisma.barExamSitting.findMany.mockResolvedValue([
        {
          id: 's1',
          year: 2018,
          part: null,
          subjectStudyCode: 'civil_law',
          subjectBarAdminCode: 'civil_land_titles',
          chairperson: null,
          sourceUrl: 'https://lawphil.net/.../civilQ.html',
          _count: { questions: 16 },
        },
      ]);

      const result = await controller.listByYear(2018, USER, REQ, 'ios');
      expect(result.success).toBe(true);
      expect(result.data.year).toBe(2018);
      expect(result.data.subjects).toHaveLength(1);
      expect(result.data.subjects[0]!.code).toBe('civil_law');
    });

    it('throws 404 when no sittings exist for the year', async () => {
      prisma.barExamSitting.findMany.mockResolvedValue([]);
      await expect(controller.listByYear(2020, USER, REQ, 'ios')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('GET /bar-exams/:year/:subjectCode', () => {
    it('returns the sitting with all questions ordered ASC', async () => {
      prisma.barExamSitting.findFirst.mockResolvedValue({
        id: 'sitting-id',
        year: 2018,
        part: null,
        subjectStudyCode: 'criminal_law',
        subjectBarAdminCode: 'criminal',
        chairperson: 'Del Castillo',
        sourceUrl: 'https://lawphil.net/.../criminalQ.html',
        sourceDocumentId: 'doc-id',
        questions: [
          {
            id: 'q1',
            questionNumber: 1,
            questionText: 'Question I body...',
            subPartsCount: 0,
            sourceSectionAnchor: null,
          },
          {
            id: 'q2',
            questionNumber: 2,
            questionText: 'Question II body...',
            subPartsCount: 2,
            sourceSectionAnchor: null,
          },
        ],
      });

      const result = await controller.getSitting(2018, 'criminal_law', USER, REQ);

      expect(result.success).toBe(true);
      expect(result.data.sitting.year).toBe(2018);
      expect(result.data.sitting.subjectStudyCode).toBe('criminal_law');
      expect(result.data.questions).toHaveLength(2);
      expect(result.data.questions[0]!.number).toBe(1);
      expect(result.data.questions[1]!.subPartsCount).toBe(2);
    });

    it('disambiguates 2022 split papers by ?part query parameter', async () => {
      prisma.barExamSitting.findFirst.mockResolvedValue({
        id: 'sitting-id',
        year: 2022,
        part: 'I',
        subjectStudyCode: 'civil_law',
        subjectBarAdminCode: 'civil_land_titles',
        chairperson: 'Caguioa',
        sourceUrl: 'https://lawphil.net/.../civil-I_Q.html',
        sourceDocumentId: 'doc-id',
        questions: [],
      });

      await controller.getSitting(2022, 'civil_law', USER, REQ, 'I');

      const callArgs = prisma.barExamSitting.findFirst.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        year: 2022,
        subjectStudyCode: 'civil_law',
        part: 'I',
      });
    });

    it('throws 404 for an unknown year/subject combination', async () => {
      prisma.barExamSitting.findFirst.mockResolvedValue(null);
      await expect(
        controller.getSitting(2018, 'unknown_subject', USER, REQ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 for a malformed part query parameter', async () => {
      await expect(
        controller.getSitting(2022, 'civil_law', USER, REQ, '<><><>'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
  /**
   * Past bar exams are a PAID surface. Before this gate the controller was
   * `@UseGuards(JwtAuthGuard)` only, so any signed-in free account could read
   * the full content of every sitting straight from the API — the paywall
   * existed only in the mobile client's decision not to render the tab.
   */
  describe('entitlement gate', () => {
    const SITTINGS = [
      {
        id: 's1',
        year: 2018,
        part: null,
        subjectStudyCode: 'criminal_law',
        subjectBarAdminCode: 'criminal',
        chairperson: null,
        sourceUrl: 'https://lawphil.net/.../criminalQ.html',
        _count: { questions: 19 },
      },
    ];

    it('serves content to an entitled caller', async () => {
      prisma.barExamSitting.findMany.mockResolvedValue(SITTINGS);

      const result = await controller.list(USER, REQ, 'ios');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(resolveEffectiveEntitlements).toHaveBeenCalledWith('org-1', 'ios');
    });

    it('refuses a previewOnly caller on all three routes, and never queries', async () => {
      resolveEffectiveEntitlements.mockResolvedValue({ previewOnly: true });

      await expect(controller.list(USER, REQ, 'ios')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        controller.listByYear(2018, USER, REQ, 'ios'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.getSitting(2018, 'criminal_law', USER, REQ, undefined, 'ios'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // The refusal happens before any read, so no paid content is loaded.
      expect(prisma.barExamSitting.findMany).not.toHaveBeenCalled();
      expect(prisma.barExamSitting.findFirst).not.toHaveBeenCalled();
    });

    it('refuses with 403, NOT 402', async () => {
      // 402 `subscription_required` is the status App Review reads as a
      // paywall. The free client hides this surface entirely, so this refusal
      // is unreachable by tapping — but if Review does reach it, it must not
      // look like a demand for payment.
      resolveEffectiveEntitlements.mockResolvedValue({ previewOnly: true });

      await expect(controller.list(USER, REQ, 'ios')).rejects.toMatchObject({
        status: 403,
        response: { code: 'not_available_on_this_account' },
      });
    });

    it('serves a platform admin on a free org, and audits the bypass', async () => {
      resolveEffectiveEntitlements.mockResolvedValue({ previewOnly: true });
      prisma.barExamSitting.findMany.mockResolvedValue(SITTINGS);

      const result = await controller.list(ADMIN, REQ, 'ios');

      expect(result.data).toHaveLength(1);
      // Short-circuits: the org's entitlements are never consulted.
      expect(resolveEffectiveEntitlements).not.toHaveBeenCalled();
      expect(recordBypass).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', organizationId: 'org-1' }),
      );
    });

    it('stays unenforced with no x-platform header (web, and builds before 26)', async () => {
      // `parseClientPlatform(undefined)` is null, and a null platform cannot
      // buy, so `resolveEffectiveEntitlements` answers unenforced — the same
      // rule as `isPaywallEnforcedForRequest`. Gating a shipped binary with no
      // purchase surface is what got build 23 rejected.
      resolveEffectiveEntitlements.mockResolvedValue({ previewOnly: false });
      prisma.barExamSitting.findMany.mockResolvedValue(SITTINGS);

      const result = await controller.list(USER, REQ);

      expect(result.data).toHaveLength(1);
      expect(resolveEffectiveEntitlements).toHaveBeenCalledWith('org-1', null);
    });
  });
});

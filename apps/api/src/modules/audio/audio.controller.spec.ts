import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole, type JwtPayload } from '@libertasian/types';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DigestsService } from '../digests/digests.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { AudioController } from './audio.controller';
import { AudioRenditionService } from './audio-rendition.service';

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'user-1',
    email: 'u@example.com',
    role: UserRole.STUDENT,
    organizationId: 'org-1',
    mfaVerified: true,
    iat: 0,
    exp: 0,
    ...overrides,
  };
}

function makeRes(): { res: Response; status: jest.Mock } {
  const status = jest.fn();
  return { res: { status } as unknown as Response, status };
}

function build() {
  const renditions = {
    getRendition: jest.fn(),
    requestGeneration: jest.fn(),
    buildReadModel: jest.fn(),
    resolveText: jest.fn(),
    voiceId: 'Matthew',
  };
  const digests = { findById: jest.fn() };
  const entitlements = { resolveEffectiveEntitlements: jest.fn() };
  const audit = { log: jest.fn() };
  const prisma = { barExamAnswer: { findFirst: jest.fn() } };

  const controller = new AudioController(
    renditions as unknown as AudioRenditionService,
    digests as unknown as DigestsService,
    entitlements as unknown as EntitlementService,
    audit as unknown as AuditService,
    prisma as unknown as PrismaService,
  );
  return { controller, renditions, digests, entitlements, audit, prisma };
}

describe('AudioController', () => {
  describe('getRendition', () => {
    it('rejects an unsupported contentType', async () => {
      const { controller } = build();
      const { res } = makeRes();
      await expect(
        controller.getRendition('memo', 'c1', undefined, makeUser(), res),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('serves signed URLs for a ready digest rendition (free plan)', async () => {
      const { controller, renditions, digests } = build();
      const { res } = makeRes();
      digests.findById.mockResolvedValue({ id: 'd1' });
      renditions.getRendition.mockResolvedValue({ status: 'ready' });
      renditions.buildReadModel.mockResolvedValue({
        status: 'ready',
        audioUrl: 'https://signed/a.mp3',
        marksUrl: 'https://signed/a.marks.json',
        readalongUrl: 'https://signed/a.readalong.json',
        durationMs: 4200,
        language: 'en',
        voiceId: 'Matthew',
      });

      const out = await controller.getRendition('digest', 'd1', 'en', makeUser(), res);
      expect(out.data.status).toBe('ready');
      expect(out.data.audioUrl).toBe('https://signed/a.mp3');
      expect(out.data.readalongUrl).toBe('https://signed/a.readalong.json');
      expect(renditions.requestGeneration).not.toHaveBeenCalled();
    });

    it('enqueues and responds 202 when the digest rendition is missing', async () => {
      const { controller, renditions, digests } = build();
      const { res, status } = makeRes();
      digests.findById.mockResolvedValue({ id: 'd1' });
      renditions.getRendition.mockResolvedValue(null);

      const out = await controller.getRendition('digest', 'd1', 'en', makeUser(), res);
      expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
      expect(out.data.status).toBe('pending');
      expect(out.data.audioUrl).toBeNull();
      expect(renditions.requestGeneration).toHaveBeenCalledWith(
        'digest',
        'd1',
        'en',
        false,
      );
    });

    it('denies bar-exam-answer audio for a preview-only (free) plan', async () => {
      const { controller, renditions, entitlements, prisma } = build();
      const { res } = makeRes();
      prisma.barExamAnswer.findFirst.mockResolvedValue({ id: 'a1' });
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: true,
      });

      await expect(
        controller.getRendition('bar_exam_answer', 'a1', 'en', makeUser(), res),
      ).rejects.toMatchObject({
        constructor: HttpException,
      });
      try {
        await controller.getRendition('bar_exam_answer', 'a1', 'en', makeUser(), res);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
      }
      expect(renditions.getRendition).not.toHaveBeenCalled();
    });

    it('allows bar-exam-answer audio for an entitled (non-preview) plan', async () => {
      const { controller, renditions, entitlements, prisma } = build();
      const { res } = makeRes();
      prisma.barExamAnswer.findFirst.mockResolvedValue({ id: 'a1' });
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: false,
      });
      renditions.getRendition.mockResolvedValue(null);

      await controller.getRendition('bar_exam_answer', 'a1', 'en', makeUser(), res);
      expect(renditions.requestGeneration).toHaveBeenCalled();
    });

    it('404s when the bar-exam answer is not approved/public', async () => {
      const { controller, prisma } = build();
      const { res } = makeRes();
      prisma.barExamAnswer.findFirst.mockResolvedValue(null);
      await expect(
        controller.getRendition('bar_exam_answer', 'a1', 'en', makeUser(), res),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('bypasses the entitlement gate for a platform admin', async () => {
      const { controller, renditions, entitlements, prisma } = build();
      const { res } = makeRes();
      prisma.barExamAnswer.findFirst.mockResolvedValue({ id: 'a1' });
      renditions.getRendition.mockResolvedValue(null);

      await controller.getRendition(
        'bar_exam_answer',
        'a1',
        'en',
        makeUser({ isPlatformAdmin: true }),
        res,
      );
      expect(entitlements.resolveEffectiveEntitlements).not.toHaveBeenCalled();
      expect(renditions.requestGeneration).toHaveBeenCalled();
    });
  });

  describe('forceRender', () => {
    it('forbids non-admins', async () => {
      const { controller } = build();
      const { res } = makeRes();
      await expect(
        controller.forceRender('digest', 'd1', 'en', makeUser(), '127.0.0.1', res),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forces regen and audits for a platform admin', async () => {
      const { controller, renditions, audit } = build();
      const { res, status } = makeRes();
      renditions.resolveText.mockResolvedValue({ text: 'x', visibility: 'public_editorial' });

      const out = await controller.forceRender(
        'digest',
        'd1',
        'en',
        makeUser({ isPlatformAdmin: true }),
        '127.0.0.1',
        res,
      );

      expect(renditions.requestGeneration).toHaveBeenCalledWith('digest', 'd1', 'en', true);
      expect(audit.log).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
      expect(out.data.status).toBe('pending');
    });
  });
});

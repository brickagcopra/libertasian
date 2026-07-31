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
import { DocumentsService } from '../documents/documents.service';
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
    isPermanentlyFailed: jest.fn().mockReturnValue(false),
    hasCompleteSectionAudio: jest.fn().mockResolvedValue(false),
    voiceId: 'Matthew',
  };
  const digests = { findById: jest.fn() };
  // The REAL gate for statutory text, mocked at the service boundary: the audio
  // path must delegate to these rather than restate who may hear what.
  const documents = { findById: jest.fn(), getSection: jest.fn() };
  const entitlements = { resolveEffectiveEntitlements: jest.fn() };
  const audit = { log: jest.fn() };
  const prisma = {
    barExamAnswer: { findFirst: jest.fn() },
    legalDocumentSection: { findUnique: jest.fn() },
  };

  const controller = new AudioController(
    renditions as unknown as AudioRenditionService,
    digests as unknown as DigestsService,
    documents as unknown as DocumentsService,
    entitlements as unknown as EntitlementService,
    audit as unknown as AuditService,
    prisma as unknown as PrismaService,
  );
  return {
    controller,
    renditions,
    digests,
    documents,
    entitlements,
    audit,
    prisma,
  };
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

  /**
   * The four statutory documents are narrated one section at a time. Hearing a
   * section must be allowed exactly where READING it is — the gate lives in
   * DocumentsService and is reused, not restated.
   */
  describe('getRendition — legal_document_section', () => {
    const SECTION = 'sec-1';

    it('gates on the parent document via DocumentsService.getSection', async () => {
      const { controller, renditions, documents, entitlements, prisma } = build();
      const { res } = makeRes();
      prisma.legalDocumentSection.findUnique.mockResolvedValue({
        legalDocumentId: 'doc-1',
      });
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: false,
      });
      documents.getSection.mockResolvedValue({ id: SECTION });
      renditions.getRendition.mockResolvedValue({ status: 'ready' });
      renditions.buildReadModel.mockResolvedValue({ status: 'ready' });

      await controller.getRendition(
        'legal_document_section',
        SECTION,
        'en',
        makeUser(),
        res,
      );

      // documentId, sectionId, previewOnly — the same call the reader makes.
      expect(documents.getSection).toHaveBeenCalledWith('doc-1', SECTION, false);
    });

    it('passes previewOnly through, so the free-plan paywall still applies', async () => {
      const { controller, documents, entitlements, prisma } = build();
      const { res } = makeRes();
      prisma.legalDocumentSection.findUnique.mockResolvedValue({
        legalDocumentId: 'doc-1',
      });
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: true,
      });
      // What DocumentsService.assertPreviewAllowed throws outside the free set.
      documents.getSection.mockRejectedValue(new ForbiddenException('paywall'));

      await expect(
        controller.getRendition(
          'legal_document_section',
          SECTION,
          'en',
          makeUser(),
          res,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(documents.getSection).toHaveBeenCalledWith('doc-1', SECTION, true);
    });

    it('treats a platform admin as never preview-only', async () => {
      const { controller, renditions, documents, entitlements, prisma } = build();
      const { res } = makeRes();
      prisma.legalDocumentSection.findUnique.mockResolvedValue({
        legalDocumentId: 'doc-1',
      });
      documents.getSection.mockResolvedValue({ id: SECTION });
      renditions.getRendition.mockResolvedValue({ status: 'ready' });
      renditions.buildReadModel.mockResolvedValue({ status: 'ready' });

      await controller.getRendition(
        'legal_document_section',
        SECTION,
        'en',
        makeUser({ isPlatformAdmin: true }),
        res,
      );

      expect(documents.getSection).toHaveBeenCalledWith('doc-1', SECTION, false);
      // Matches DocumentsController.resolvePreviewOnly: admins short-circuit
      // before entitlements are consulted at all.
      expect(entitlements.resolveEffectiveEntitlements).not.toHaveBeenCalled();
    });

    it('404s an unknown section without consulting the documents gate', async () => {
      const { controller, documents, prisma } = build();
      const { res } = makeRes();
      prisma.legalDocumentSection.findUnique.mockResolvedValue(null);

      await expect(
        controller.getRendition(
          'legal_document_section',
          'missing',
          'en',
          makeUser(),
          res,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(documents.getSection).not.toHaveBeenCalled();
    });

    it('enqueues and 202s when the section rendition is missing', async () => {
      const { controller, renditions, documents, entitlements, prisma } = build();
      const { res, status } = makeRes();
      prisma.legalDocumentSection.findUnique.mockResolvedValue({
        legalDocumentId: 'doc-1',
      });
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: false,
      });
      documents.getSection.mockResolvedValue({ id: SECTION });
      renditions.getRendition.mockResolvedValue(null);

      const out = await controller.getRendition(
        'legal_document_section',
        SECTION,
        'en',
        makeUser(),
        res,
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
      expect(out.data.status).toBe('pending');
      expect(renditions.requestGeneration).toHaveBeenCalledWith(
        'legal_document_section',
        SECTION,
        'en',
        false,
      );
    });
  });

  /**
   * Pre-existing gap: `legal_document` was a valid AUDIO_CONTENT_TYPE with no
   * branch here, so it fell through to the bar-exam lookup and every codal
   * rendition the reconciler produced answered 404 `answer_not_available`.
   */
  describe('getRendition — legal_document', () => {
    it('gates on DocumentsService.findById instead of the bar-exam table', async () => {
      const { controller, renditions, documents, entitlements, prisma } = build();
      const { res } = makeRes();
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: false,
      });
      documents.findById.mockResolvedValue({ id: 'doc-1' });
      renditions.getRendition.mockResolvedValue({ status: 'ready' });
      renditions.buildReadModel.mockResolvedValue({ status: 'ready' });

      const out = await controller.getRendition(
        'legal_document',
        'doc-1',
        'en',
        makeUser(),
        res,
      );

      expect(out.data.status).toBe('ready');
      expect(documents.findById).toHaveBeenCalledWith('doc-1', false);
      expect(prisma.barExamAnswer.findFirst).not.toHaveBeenCalled();
    });
  });

  /**
   * Prod 2026-07-31: 21,094 ready renditions, 4 failed — the Civil Code,
   * Administrative Code, NIRC and Rules of Court, all `output_too_large`, all
   * fully narrated per section instead. Before this guard every client GET on
   * those four fell through to requestGeneration and burned 3 attempts
   * reproducing the identical failure.
   */
  describe('getRendition — terminal failures must not re-enqueue', () => {
    const FAILED = {
      status: 'failed',
      voiceId: 'af_heart',
      failureReason:
        'output_too_large: 810815 chars project to ~343MiB of mp3, above the 150MiB output ceiling',
    };

    /** Wire the real predicate, so the spec exercises the actual reason list. */
    function buildWithRealPredicate() {
      const ctx = build();
      ctx.renditions.isPermanentlyFailed.mockImplementation(
        (r: { status: string; failureReason?: string | null } | null) =>
          new AudioRenditionService(
            {} as never,
            {} as never,
            {} as never,
            { get: (_k: string, d?: string) => d } as never,
            {} as never,
          ).isPermanentlyFailed(r),
      );
      return ctx;
    }

    it('returns 200 unavailable and enqueues NOTHING', async () => {
      const { controller, renditions, documents, entitlements } =
        buildWithRealPredicate();
      const { res, status } = makeRes();
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: false,
      });
      documents.findById.mockResolvedValue({ id: 'doc-1' });
      renditions.getRendition.mockResolvedValue(FAILED);
      renditions.hasCompleteSectionAudio.mockResolvedValue(true);

      const out = await controller.getRendition(
        'legal_document',
        'doc-1',
        'en',
        makeUser(),
        res,
      );

      expect(renditions.requestGeneration).not.toHaveBeenCalled();
      // 200, not 202: there is nothing in flight to poll for.
      expect(status).not.toHaveBeenCalled();
      expect(out.data).toMatchObject({
        status: 'unavailable',
        audioUrl: null,
        failureReason: FAILED.failureReason,
        voiceId: 'af_heart',
        language: 'en',
      });
    });

    it('tells the client to use per-section audio when the sections are covered', async () => {
      const { controller, renditions, documents, entitlements } =
        buildWithRealPredicate();
      const { res } = makeRes();
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: false,
      });
      documents.findById.mockResolvedValue({ id: 'doc-1' });
      renditions.getRendition.mockResolvedValue(FAILED);
      renditions.hasCompleteSectionAudio.mockResolvedValue(true);

      const out = await controller.getRendition(
        'legal_document',
        'doc-1',
        'en',
        makeUser(),
        res,
      );

      expect(out.data.useSectionAudio).toBe(true);
      expect(renditions.hasCompleteSectionAudio).toHaveBeenCalledWith(
        'doc-1',
        'en',
      );
    });

    it('does not claim section audio when the sections are not covered', async () => {
      const { controller, renditions, documents, entitlements } =
        buildWithRealPredicate();
      const { res } = makeRes();
      entitlements.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: false,
      });
      documents.findById.mockResolvedValue({ id: 'doc-1' });
      renditions.getRendition.mockResolvedValue(FAILED);
      renditions.hasCompleteSectionAudio.mockResolvedValue(false);

      const out = await controller.getRendition(
        'legal_document',
        'doc-1',
        'en',
        makeUser(),
        res,
      );

      expect(out.data.useSectionAudio).toBe(false);
      expect(renditions.requestGeneration).not.toHaveBeenCalled();
    });

    it('never claims section audio for a digest', async () => {
      const { controller, renditions, digests } = buildWithRealPredicate();
      const { res } = makeRes();
      digests.findById.mockResolvedValue({ id: 'd1' });
      renditions.getRendition.mockResolvedValue(FAILED);

      const out = await controller.getRendition('digest', 'd1', 'en', makeUser(), res);

      expect(out.data.useSectionAudio).toBe(false);
      // A digest has no sections to fall back to, so nothing is even asked.
      expect(renditions.hasCompleteSectionAudio).not.toHaveBeenCalled();
      expect(renditions.requestGeneration).not.toHaveBeenCalled();
    });

    it.each(['timeout', 'transient', 'permanent', 'error', 'brand_new_reason'])(
      'still re-enqueues a row failed with the unrecognized reason %s',
      async (reason) => {
        const { controller, renditions, digests } = buildWithRealPredicate();
        const { res, status } = makeRes();
        digests.findById.mockResolvedValue({ id: 'd1' });
        renditions.getRendition.mockResolvedValue({
          status: 'failed',
          voiceId: 'Matthew',
          failureReason: `${reason}: tts-service returned 500`,
        });

        const out = await controller.getRendition(
          'digest',
          'd1',
          'en',
          makeUser(),
          res,
        );

        // Unknown means retryable: a network blip or a reason a future backend
        // adds must not be mistaken for a permanent refusal.
        expect(renditions.requestGeneration).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
        expect(out.data.status).toBe('pending');
      },
    );

    it('still re-enqueues a failed row with no reason recorded', async () => {
      const { controller, renditions, digests } = buildWithRealPredicate();
      const { res } = makeRes();
      digests.findById.mockResolvedValue({ id: 'd1' });
      renditions.getRendition.mockResolvedValue({
        status: 'failed',
        voiceId: 'Matthew',
        failureReason: null,
      });

      await controller.getRendition('digest', 'd1', 'en', makeUser(), res);

      expect(renditions.requestGeneration).toHaveBeenCalledTimes(1);
    });

    it('still re-enqueues a PENDING row (nothing terminal about it)', async () => {
      const { controller, renditions, digests } = buildWithRealPredicate();
      const { res } = makeRes();
      digests.findById.mockResolvedValue({ id: 'd1' });
      renditions.getRendition.mockResolvedValue({
        status: 'pending',
        voiceId: 'Matthew',
        failureReason: null,
      });

      await controller.getRendition('digest', 'd1', 'en', makeUser(), res);

      expect(renditions.requestGeneration).toHaveBeenCalledTimes(1);
    });

    it('still re-enqueues when there is no rendition row at all', async () => {
      const { controller, renditions, digests } = buildWithRealPredicate();
      const { res } = makeRes();
      digests.findById.mockResolvedValue({ id: 'd1' });
      renditions.getRendition.mockResolvedValue(null);

      await controller.getRendition('digest', 'd1', 'en', makeUser(), res);

      expect(renditions.requestGeneration).toHaveBeenCalledTimes(1);
    });

    it('lets an admin force render override a permanent failure', async () => {
      const { controller, renditions, audit } = buildWithRealPredicate();
      const { res, status } = makeRes();
      renditions.resolveText.mockResolvedValue({
        text: 'x',
        visibility: 'public_editorial',
      });

      await controller.forceRender(
        'legal_document',
        'doc-1',
        'en',
        makeUser({ isPlatformAdmin: true }),
        '127.0.0.1',
        res,
      );

      // The read path stops asking; a deliberate admin retry must not.
      expect(renditions.requestGeneration).toHaveBeenCalledWith(
        'legal_document',
        'doc-1',
        'en',
        true,
      );
      expect(renditions.getRendition).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
      expect(audit.log).toHaveBeenCalled();
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

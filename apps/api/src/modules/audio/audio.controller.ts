import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DigestsService } from '../digests/digests.service';
import { DocumentsService } from '../documents/documents.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { AudioRenditionService } from './audio-rendition.service';
import {
  AUDIO_CONTENT_TYPES,
  isAudioContentType,
  type AudioContentType,
  type AudioRenditionReadStatus,
} from './audio.types';

/** Validate + normalize the optional ?language query param. */
function normalizeLanguage(raw?: string): string {
  const value = (raw ?? 'en').toLowerCase();
  if (!/^[a-z]{2}(-[a-z]{2})?$/.test(value)) {
    throw new BadRequestException('Invalid language code');
  }
  return value;
}

@ApiTags('Audio')
@Controller('audio')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AudioController {
  constructor(
    private readonly renditions: AudioRenditionService,
    private readonly digests: DigestsService,
    private readonly documents: DocumentsService,
    private readonly entitlements: EntitlementService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':contentType/:contentId')
  @ApiOperation({
    summary: 'Get the audio rendition for a digest or bar-exam answer',
    description:
      'Returns signed (short-TTL) audio + speech-mark URLs when ready, ' +
      'otherwise enqueues synthesis and responds 202 with status "pending". ' +
      'Content whose synthesis failed terminally (e.g. output_too_large) ' +
      'answers 200 with status "unavailable" and is NOT re-enqueued; when its ' +
      'sections are individually narrated, `useSectionAudio` is true. ' +
      'Digest audio is free; bar-exam-answer audio is gated by entitlement.',
  })
  async getRendition(
    @Param('contentType') contentTypeRaw: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Query('language') languageRaw: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const contentType = this.parseContentType(contentTypeRaw);
    const language = normalizeLanguage(languageRaw);

    await this.assertAccessAndPaywall(contentType, contentId, user);

    const rendition = await this.renditions.getRendition(
      contentType,
      contentId,
      language,
    );

    if (rendition && rendition.status === 'ready') {
      return {
        success: true,
        data: await this.renditions.buildReadModel(rendition),
      };
    }

    // Terminal failure: answer 200 `unavailable` and enqueue NOTHING.
    //
    // Every other non-ready case falls through to requestGeneration below. For
    // a row that failed for a reason re-running cannot change, that turned each
    // client GET into a fresh job burning 3 attempts to reproduce the identical
    // failure — and `claimJobId` (50b5b30) removes the retained terminal BullMQ
    // record, so the deterministic job id no longer blocks the repeat either.
    // Prod has 4 such rows, all `output_too_large`, all fully narrated per
    // section instead.
    if (this.renditions.isPermanentlyFailed(rendition)) {
      return {
        success: true,
        data: {
          status: 'unavailable' satisfies AudioRenditionReadStatus,
          audioUrl: null,
          marksUrl: null,
          readalongUrl: null,
          durationMs: null,
          language,
          voiceId: rendition?.voiceId ?? this.renditions.voiceId,
          failureReason: rendition?.failureReason ?? null,
          // The whole document is refused, but its sections are narrated
          // individually — tell the client to switch rather than leaving it
          // with only "no".
          useSectionAudio:
            contentType === 'legal_document' &&
            (await this.renditions.hasCompleteSectionAudio(contentId, language)),
        },
      };
    }

    // Not yet available — enqueue synthesis and signal "processing".
    await this.renditions.requestGeneration(contentType, contentId, language, false);
    res.status(HttpStatus.ACCEPTED);
    return {
      success: true,
      data: {
        status: 'pending',
        audioUrl: null,
        marksUrl: null,
        readalongUrl: null,
        durationMs: null,
        language,
        voiceId: this.renditions.voiceId,
      },
    };
  }

  @Post(':contentType/:contentId/render')
  @ApiOperation({
    summary: 'Force (re)generation of an audio rendition (platform admin only)',
  })
  async forceRender(
    @Param('contentType') contentTypeRaw: string,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Query('language') languageRaw: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (user.isPlatformAdmin !== true) {
      throw new ForbiddenException('Platform admin role required');
    }
    const contentType = this.parseContentType(contentTypeRaw);
    const language = normalizeLanguage(languageRaw);

    // Validate the content exists (throws NotFound otherwise).
    await this.renditions.resolveText(contentType, contentId);

    await this.renditions.requestGeneration(contentType, contentId, language, true);

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'audio.force_render',
      entityType: 'audio_rendition',
      entityId: `${contentType}:${contentId}`,
      metadata: { ip, contentType, contentId, language },
    });

    res.status(HttpStatus.ACCEPTED);
    return { success: true, data: { status: 'pending', language } };
  }

  private parseContentType(raw: string): AudioContentType {
    if (!isAudioContentType(raw)) {
      throw new BadRequestException(
        `Unsupported contentType '${raw}' (expected one of ${AUDIO_CONTENT_TYPES.join(', ')})`,
      );
    }
    return raw;
  }

  /**
   * The caller's preview-only status, resolved exactly as
   * `DocumentsController.resolvePreviewOnly` does
   * (`documents.controller.ts:64`): a platform admin is never preview-only,
   * everyone else takes it from their organization's effective entitlements.
   *
   * Duplicating the RESOLUTION rather than the GATE is deliberate — the gate
   * itself stays in DocumentsService, so a change to what free users may read
   * moves audio with it.
   */
  private async isPreviewOnly(user: JwtPayload): Promise<boolean> {
    if (user.isPlatformAdmin === true) return false;
    const ent = await this.entitlements.resolveEffectiveEntitlements(
      user.organizationId,
    );
    return ent.previewOnly === true;
  }

  /**
   * Enforce content access + paywall before serving/triggering audio.
   *  - digest: reuse DigestsService access rules (owner/org/public_editorial),
   *    which blocks cross-org private content. Digest audio is free.
   *  - legal_document / legal_document_section: reuse the DOCUMENTS gate, so
   *    hearing text is allowed exactly where reading it is.
   *  - bar_exam_answer: only approved + public_editorial answers are eligible,
   *    and non-admins on a preview-only (free) plan are upsold.
   * Platform admins bypass the entitlement gate (not the content existence).
   */
  private async assertAccessAndPaywall(
    contentType: AudioContentType,
    contentId: string,
    user: JwtPayload,
  ): Promise<void> {
    if (contentType === 'digest') {
      // Throws Forbidden/NotFound per existing digest visibility rules.
      await this.digests.findById(contentId, user.sub, user.organizationId);
      return; // free plan may stream digest audio
    }

    if (contentType === 'legal_document_section') {
      // Audio for a section is gated EXACTLY like READING that section:
      // GET /documents/:id/sections/:sectionId → DocumentsService.getSection
      // (`documents.service.ts:301`), whose only gate is the free-plan preview
      // cap in assertPreviewAllowed — a preview-only caller may read one
      // document per document_type and 402s on the rest. No new gate is
      // invented here, and none is skipped: the parent lookup below only finds
      // WHICH document to gate on.
      const section = await this.prisma.legalDocumentSection.findUnique({
        where: { id: contentId },
        select: { legalDocumentId: true },
      });
      if (!section) {
        throw new NotFoundException(`Section ${contentId} not found`);
      }
      await this.documents.getSection(
        section.legalDocumentId,
        contentId,
        await this.isPreviewOnly(user),
      );
      return;
    }

    if (contentType === 'legal_document') {
      // Same gate one level up (`documents.service.ts:73`, findById). Before
      // this, `legal_document` had NO branch here and fell through to the
      // bar-exam lookup below, so every codal rendition the reconciler has
      // produced answered 404 `answer_not_available` on read.
      await this.documents.findById(contentId, await this.isPreviewOnly(user));
      return;
    }

    const answer = await this.prisma.barExamAnswer.findFirst({
      where: {
        id: contentId,
        reviewStatus: 'approved',
        visibility: 'public_editorial',
      },
      select: { id: true },
    });
    if (!answer) {
      throw new NotFoundException({ code: 'answer_not_available' });
    }

    if (user.isPlatformAdmin === true) {
      return; // established platform-admin bypass
    }

    const ent = await this.entitlements.resolveEffectiveEntitlements(
      user.organizationId,
    );
    if (ent.previewOnly === true) {
      throw new HttpException(
        {
          success: false,
          error: 'subscription_required',
          message: "This isn't available on this account.",
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }
}

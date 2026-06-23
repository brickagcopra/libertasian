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
import { EntitlementService } from '../subscriptions/entitlement.service';
import { AudioRenditionService } from './audio-rendition.service';
import { isAudioContentType, type AudioContentType } from './audio.types';

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

    // Not yet available — enqueue synthesis and signal "processing".
    await this.renditions.requestGeneration(contentType, contentId, language, false);
    res.status(HttpStatus.ACCEPTED);
    return {
      success: true,
      data: {
        status: 'pending',
        audioUrl: null,
        marksUrl: null,
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
        `Unsupported contentType '${raw}' (expected 'digest' or 'bar_exam_answer')`,
      );
    }
    return raw;
  }

  /**
   * Enforce content access + paywall before serving/triggering audio.
   *  - digest: reuse DigestsService access rules (owner/org/public_editorial),
   *    which blocks cross-org private content. Digest audio is free.
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
          upgradeUrl: '/pricing',
          message: 'An active subscription is required for bar-exam answer audio.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }
}

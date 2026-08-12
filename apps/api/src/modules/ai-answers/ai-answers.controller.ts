import {
  Body,
  Controller,
  ForbiddenException,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TrackEvent } from '../analytics';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { AiAnswersService } from './ai-answers.service';
import { AiAnswerQueryDto } from './dto';

@ApiTags('AI Answers')
@Controller('ai-answers')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AiAnswersController {
  private readonly logger = new Logger(AiAnswersController.name);

  constructor(
    private readonly aiAnswersService: AiAnswersService,
    private readonly auditService: AuditService,
    private readonly usageQuota: UsageQuotaService,
    private readonly documents: DocumentsService,
    private readonly entitlements: EntitlementService,
  ) {}

  /**
   * The caller's preview-only status, resolved exactly as
   * `DocumentsController.resolvePreviewOnly` and `AudioController.isPreviewOnly`
   * do: a platform admin is never preview-only, everyone else takes it from
   * their organization's effective entitlements.
   */
  private async isPreviewOnly(user: JwtPayload): Promise<boolean> {
    if (user.isPlatformAdmin === true) return false;
    const ent = await this.entitlements.resolveEffectiveEntitlements(
      user.organizationId,
    );
    return ent.previewOnly === true;
  }

  /**
   * Verify the caller may read `documentId` before it is forwarded as a
   * retrieval scope.
   *
   * `documentId` arrives in the request body, so it is attacker-controlled.
   * Forwarding it unchecked would let anyone aim the RAG pipeline at any
   * document in the corpus and read it back as generated prose with quoted
   * source passages — a read gate bypass dressed up as an answer.
   *
   * The gate itself is NOT restated here. It delegates to
   * `DocumentsService.findById` (`documents.service.ts:73`), the same call that
   * backs `GET /documents/:id`, mirroring how
   * `AudioController.assertAccessAndPaywall` (`audio.controller.ts:217`) reuses
   * the owning module's rule. So scoping an answer to a document is allowed
   * exactly where reading that document is, and a future change to who may read
   * what moves this with it.
   *
   * Note on the failure mode: `LegalDocument` has no `organizationId` — it is a
   * global corpus deliberately excluded from `PrismaService.forTenant`'s model
   * list — so there is no cross-tenant dimension to enforce and no 403 to
   * raise. The real exposure is the free-plan preview cap and unpublished
   * documents, which surface as 402 (`PaywallException`) and 404 respectively.
   */
  private async assertDocumentReadable(
    documentId: string,
    user: JwtPayload,
  ): Promise<void> {
    await this.documents.findById(documentId, await this.isPreviewOnly(user));
  }

  @Post()
  @ApiOperation({ summary: 'Generate an AI answer for a legal query' })
  @TrackEvent('ai_answer_requested', (req) => ({
    query_length: (req.body?.query as string)?.length ?? 0,
    mode: (req.body?.mode as string) ?? 'answer',
  }))
  async generateAnswer(
    @Body() dto: AiAnswerQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // Before the quota check on purpose: checkAndIncrement consumes a unit even
    // when the request goes on to fail, so authorizing first stops a caller
    // burning their own quota on documents they were never allowed to scope to.
    if (dto.documentId) {
      await this.assertDocumentReadable(dto.documentId, user);
    }

    const quota = await this.usageQuota.checkAndIncrement(
      user.organizationId,
      user.sub,
      'aiAnswers',
      { isPlatformAdmin: user.isPlatformAdmin === true },
    );
    if (!quota.allowed) {
      throw new ForbiddenException({
        message: 'AI answer quota exceeded',
        quota: { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt },
      });
    }

    const result = await this.aiAnswersService.generateAnswer(
      dto,
      user.sub,
      user.organizationId,
    );

    // Audit log (non-blocking)
    this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'ai.answer.generate',
      entityType: 'ai_answer',
      metadata: {
        query: dto.query,
        abstained: result.abstained,
        confidence: result.confidence,
        sourceCount: result.sources.length,
      },
    });

    return {
      success: true,
      data: result,
      meta: {
        quota: { used: quota.used, limit: quota.limit, remaining: quota.remaining },
      },
    };
  }

  @Post('stream')
  @ApiOperation({ summary: 'Stream an AI answer via SSE' })
  async streamAnswer(
    @Body() dto: AiAnswerQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    // Runs before the quota check for the same reason as the non-streaming
    // path, and before flushHeaders() so a thrown NotFound/Paywall is still a
    // normal JSON error response rather than an error frame mid-stream.
    if (dto.documentId) {
      await this.assertDocumentReadable(dto.documentId, user);
    }

    const quota = await this.usageQuota.checkAndIncrement(
      user.organizationId,
      user.sub,
      'aiAnswers',
      { isPlatformAdmin: user.isPlatformAdmin === true },
    );
    if (!quota.allowed) {
      res.status(403).json({
        message: 'AI answer quota exceeded',
        quota: { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt },
      });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const { url, init } = this.aiAnswersService.getStreamFetchArgs(dto);

    try {
      const upstream = await fetch(url, init);

      if (!upstream.ok) {
        const errorText = await upstream.text().catch(() => 'Unknown error');
        this.logger.error(`RAG stream error: ${upstream.status} ${errorText}`);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'RAG service error' })}\n\n`);
        res.end();
        return;
      }

      if (!upstream.body) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'No stream body' })}\n\n`);
        res.end();
        return;
      }

      // Pipe upstream SSE chunks to the client
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      };

      await pump();

      // Audit log (non-blocking)
      this.auditService.log({
        organizationId: user.organizationId,
        actorUserId: user.sub,
        actorType: 'user',
        action: 'ai.answer.stream',
        entityType: 'ai_answer',
        metadata: { query: dto.query },
      });
    } catch (err) {
      this.logger.error('SSE stream proxy error', (err as Error).message);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Stream interrupted' })}\n\n`);
    } finally {
      res.end();
    }
  }
}

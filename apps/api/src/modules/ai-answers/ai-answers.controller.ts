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
  ) {}

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

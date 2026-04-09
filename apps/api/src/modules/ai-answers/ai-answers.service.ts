import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { AiAnswerQueryDto } from './dto';

export interface AiAnswerSource {
  document_id: string;
  title: string;
  citation_text?: string;
  court?: string;
  gr_no?: string;
  section_id?: string;
  section_type?: string;
  relevance_score: number;
  passage_text: string;
}

export interface AiAnswerResponse {
  answer: string;
  sources: AiAnswerSource[];
  confidence: number;
  abstained: boolean;
  abstention_reason?: string;
  model_name?: string;
  model_version?: string;
  prompt_template_version?: string;
  tokens_in?: number;
  tokens_out?: number;
  latency_ms?: number;
}

@Injectable()
export class AiAnswersService {
  private readonly logger = new Logger(AiAnswersService.name);
  private readonly ragServiceUrl: string;
  private readonly internalApiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.ragServiceUrl = this.config.get<string>('RAG_SERVICE_URL', 'http://localhost:8000');
    this.internalApiKey = this.config.get<string>('INTERNAL_API_KEY', '');
  }

  /**
   * Generate an AI answer by calling the RAG service.
   * Records a model_runs entry per CLAUDE.md for auditing and rollback.
   */
  async generateAnswer(
    dto: AiAnswerQueryDto,
    userId: string,
    organizationId: string,
  ): Promise<AiAnswerResponse> {
    const startTime = Date.now();

    const response = await fetch(`${this.ragServiceUrl}/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.internalApiKey && { 'X-Internal-Api-Key': this.internalApiKey }),
      },
      body: JSON.stringify({
        query: dto.query,
        max_passages: dto.maxPassages ?? 8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      this.logger.error(`RAG service error: ${response.status} ${errorText}`);
      throw new Error(`RAG service returned ${response.status}`);
    }

    const result = (await response.json()) as AiAnswerResponse;
    const latencyMs = Date.now() - startTime;

    // Record model run for auditing (non-blocking)
    this.prisma.modelRun
      .create({
        data: {
          runType: 'ai_answer',
          modelName: result.model_name ?? 'unknown',
          modelVersion: result.model_version,
          promptTemplateVersion: result.prompt_template_version,
          inputRef: `user:${userId}:org:${organizationId}`,
          outputRef: result.abstained ? 'abstained' : 'answered',
          confidence: result.confidence,
          tokensIn: result.tokens_in,
          tokensOut: result.tokens_out,
          latencyMs: result.latency_ms ?? latencyMs,
        },
      })
      .catch((err) =>
        this.logger.warn('Failed to record model run', (err as Error).message),
      );

    return result;
  }

  /**
   * Build fetch arguments for proxying an SSE stream from the RAG service.
   * The controller handles the actual streaming and response piping.
   */
  getStreamFetchArgs(dto: AiAnswerQueryDto): { url: string; init: RequestInit } {
    return {
      url: `${this.ragServiceUrl}/answer/stream`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.internalApiKey && { 'X-Internal-Api-Key': this.internalApiKey }),
        },
        body: JSON.stringify({
          query: dto.query,
          max_passages: dto.maxPassages ?? 8,
        }),
      },
    };
  }
}

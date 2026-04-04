import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import type { MemoJobData } from './memos.service';

interface RagMemoResponse {
  title: string;
  summary: string;
  sections: {
    heading: string;
    content: string;
    citations: { sourceId: string; sectionId?: string; text: string }[];
  }[];
  conclusion: string;
  citations: { sourceId: string; sectionId?: string; text: string }[];
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

@Processor('memos')
export class MemosProcessor extends WorkerHost {
  private readonly logger = new Logger(MemosProcessor.name);
  private readonly ragServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
    this.ragServiceUrl = this.config.get<string>('RAG_SERVICE_URL', 'http://localhost:8000');
  }

  async process(job: Job<MemoJobData>): Promise<void> {
    const { memoId, query, memoType } = job.data;
    this.logger.log(`Processing memo generation: memoId=${memoId}, type=${memoType}`);

    try {
      // Mark as generating
      await this.prisma.legalMemo.update({
        where: { id: memoId },
        data: { status: 'generating' },
      });

      // Call RAG service for memo generation
      const ragResponse = await this.callRagService(query, memoType);

      // Record model run for audit per CLAUDE.md
      const modelRun = await this.prisma.modelRun.create({
        data: {
          runType: 'memo_draft',
          modelName: ragResponse.model_name,
          promptTemplateVersion: ragResponse.prompt_template_version,
          inputRef: `memo:${memoId}`,
          outputRef: `memo:${memoId}:output`,
          confidence: ragResponse.confidence_score,
        },
      });

      // Update memo with generated output
      await this.prisma.legalMemo.update({
        where: { id: memoId },
        data: {
          status: 'completed',
          structuredOutput: {
            title: ragResponse.title,
            summary: ragResponse.summary,
            sections: ragResponse.sections,
            conclusion: ragResponse.conclusion,
          },
          citationsJson: ragResponse.citations,
          confidenceScore: ragResponse.confidence_score,
          modelRunId: modelRun.id,
        },
      });

      this.logger.log(`Memo ${memoId} generated successfully`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown generation error';
      this.logger.error(`Memo ${memoId} generation failed: ${errorMessage}`);

      await this.prisma.legalMemo.update({
        where: { id: memoId },
        data: { status: 'failed' },
      });

      throw err; // Let BullMQ handle retries
    }
  }

  private async callRagService(query: string, memoType: string): Promise<RagMemoResponse> {
    const url = `${this.ragServiceUrl}/memos/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, memo_type: memoType }),
      signal: AbortSignal.timeout(120_000), // 2 minute timeout
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RAG service error ${response.status}: ${body}`);
    }

    return response.json() as Promise<RagMemoResponse>;
  }
}

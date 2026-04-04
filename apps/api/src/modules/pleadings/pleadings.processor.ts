import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import type { PleadingJobData } from './pleadings.service';

interface RagPleadingResponse {
  title: string;
  sections: {
    key: string;
    heading: string;
    content: string;
    citations: { sourceId: string; sectionId?: string; text: string }[];
  }[];
  citations: { sourceId: string; sectionId?: string; text: string }[];
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

@Processor('pleadings')
export class PleadingsProcessor extends WorkerHost {
  private readonly logger = new Logger(PleadingsProcessor.name);
  private readonly ragServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
    this.ragServiceUrl = this.config.get<string>(
      'RAG_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  async process(job: Job<PleadingJobData>): Promise<void> {
    const {
      pleadingId,
      templateName,
      templateCategory,
      templateJson,
      inputData,
      contextQuery,
    } = job.data;
    this.logger.log(
      `Processing pleading generation: id=${pleadingId}, template=${templateName}`,
    );

    try {
      // Mark as generating
      await this.prisma.pleading.update({
        where: { id: pleadingId },
        data: { status: 'generating' },
      });

      // Call RAG service
      const ragResponse = await this.callRagService(
        templateName,
        templateCategory,
        templateJson,
        inputData,
        contextQuery,
      );

      // Record model run for audit
      const modelRun = await this.prisma.modelRun.create({
        data: {
          runType: 'pleading_draft',
          modelName: ragResponse.model_name,
          promptTemplateVersion: ragResponse.prompt_template_version,
          inputRef: `pleading:${pleadingId}`,
          outputRef: `pleading:${pleadingId}:output`,
          confidence: ragResponse.confidence_score,
        },
      });

      // Update pleading with generated output
      await this.prisma.pleading.update({
        where: { id: pleadingId },
        data: {
          status: 'completed',
          generatedOutput: {
            title: ragResponse.title,
            sections: ragResponse.sections,
          },
          citationsJson: ragResponse.citations,
          modelRunId: modelRun.id,
        },
      });

      this.logger.log(`Pleading ${pleadingId} generated successfully`);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown generation error';
      this.logger.error(
        `Pleading ${pleadingId} generation failed: ${errorMessage}`,
      );

      await this.prisma.pleading.update({
        where: { id: pleadingId },
        data: { status: 'failed' },
      });

      throw err;
    }
  }

  private async callRagService(
    templateName: string,
    templateCategory: string,
    templateJson: unknown,
    inputData: Record<string, unknown>,
    contextQuery?: string,
  ): Promise<RagPleadingResponse> {
    const url = `${this.ragServiceUrl}/pleadings/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_name: templateName,
        template_category: templateCategory,
        template_json: templateJson,
        input_data: inputData,
        context_query: contextQuery,
      }),
      signal: AbortSignal.timeout(120_000), // 2 minute timeout
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RAG service error ${response.status}: ${body}`);
    }

    return response.json() as Promise<RagPleadingResponse>;
  }
}

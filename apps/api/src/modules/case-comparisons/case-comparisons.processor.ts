import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import type { CaseComparisonJobData } from './case-comparisons.service';

interface RagComparisonResponse {
  documents: {
    documentId: string;
    title: string;
    citationText: string;
    court: string;
    decisionDate: string;
  }[];
  dimensions: {
    dimension: string;
    entries: {
      documentId: string;
      content: string;
      citations: { sourceId: string; sectionId?: string; text: string }[];
    }[];
    analysis: string;
  }[];
  overall_analysis: string;
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

@Processor('case-comparisons')
export class CaseComparisonsProcessor extends WorkerHost {
  private readonly logger = new Logger(CaseComparisonsProcessor.name);
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

  async process(job: Job<CaseComparisonJobData>): Promise<void> {
    const { comparisonId, documentIds, comparisonType } = job.data;
    this.logger.log(
      `Processing case comparison: id=${comparisonId}, type=${comparisonType}, docs=${documentIds.length}`,
    );

    try {
      // Mark as generating
      await this.prisma.caseComparison.update({
        where: { id: comparisonId },
        data: { status: 'generating' },
      });

      // Call RAG service
      const ragResponse = await this.callRagService(
        documentIds,
        comparisonType,
      );

      // Record model run for audit per CLAUDE.md
      const modelRun = await this.prisma.modelRun.create({
        data: {
          runType: 'case_comparison',
          modelName: ragResponse.model_name,
          promptTemplateVersion: ragResponse.prompt_template_version,
          inputRef: `comparison:${comparisonId}`,
          outputRef: `comparison:${comparisonId}:output`,
          confidence: ragResponse.confidence_score,
        },
      });

      // Update comparison with generated result
      await this.prisma.caseComparison.update({
        where: { id: comparisonId },
        data: {
          status: 'completed',
          resultJson: {
            documents: ragResponse.documents,
            dimensions: ragResponse.dimensions,
            overallAnalysis: ragResponse.overall_analysis,
          },
          modelRunId: modelRun.id,
        },
      });

      this.logger.log(`Case comparison ${comparisonId} generated successfully`);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown generation error';
      this.logger.error(
        `Case comparison ${comparisonId} generation failed: ${errorMessage}`,
      );

      await this.prisma.caseComparison.update({
        where: { id: comparisonId },
        data: { status: 'failed' },
      });

      throw err; // Let BullMQ handle retries
    }
  }

  private async callRagService(
    documentIds: string[],
    comparisonType: string,
  ): Promise<RagComparisonResponse> {
    const url = `${this.ragServiceUrl}/comparisons/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_ids: documentIds,
        comparison_type: comparisonType,
      }),
      signal: AbortSignal.timeout(180_000), // 3 minute timeout for multi-doc comparison
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RAG service error ${response.status}: ${body}`);
    }

    return response.json() as Promise<RagComparisonResponse>;
  }
}

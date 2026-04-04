import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import type { ContradictionJobData } from './contradictions.service';

interface RagContradictionResponse {
  contradictions: {
    document_a_id: string;
    document_a_title: string;
    document_a_passage: string;
    document_b_id: string;
    document_b_title: string;
    document_b_passage: string;
    description: string;
    severity: string;
    doctrine_area: string | null;
  }[];
  summary: string;
  documents_analyzed: number;
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

@Processor('contradictions')
export class ContradictionsProcessor extends WorkerHost {
  private readonly logger = new Logger(ContradictionsProcessor.name);
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

  async process(job: Job<ContradictionJobData>): Promise<void> {
    const { reportId, documentIds, scope, topic } = job.data;
    this.logger.log(
      `Processing contradiction detection: id=${reportId}, scope=${scope}, docs=${documentIds.length}`,
    );

    try {
      // Mark as generating
      await this.prisma.contradictionReport.update({
        where: { id: reportId },
        data: { status: 'generating' },
      });

      // Call RAG service
      const ragResponse = await this.callRagService(
        documentIds,
        scope,
        topic,
      );

      // Record model run for audit per CLAUDE.md
      const modelRun = await this.prisma.modelRun.create({
        data: {
          runType: 'contradiction_detection',
          modelName: ragResponse.model_name,
          promptTemplateVersion: ragResponse.prompt_template_version,
          inputRef: `contradiction:${reportId}`,
          outputRef: `contradiction:${reportId}:output`,
          confidence: ragResponse.confidence_score,
        },
      });

      // Update report with generated result
      await this.prisma.contradictionReport.update({
        where: { id: reportId },
        data: {
          status: 'completed',
          resultJson: {
            contradictions: ragResponse.contradictions.map((c) => ({
              documentAId: c.document_a_id,
              documentATitle: c.document_a_title,
              documentAPassage: c.document_a_passage,
              documentBId: c.document_b_id,
              documentBTitle: c.document_b_title,
              documentBPassage: c.document_b_passage,
              description: c.description,
              severity: c.severity,
              doctrineArea: c.doctrine_area,
            })),
            summary: ragResponse.summary,
            documentsAnalyzed: ragResponse.documents_analyzed,
          },
          modelRunId: modelRun.id,
        },
      });

      this.logger.log(
        `Contradiction report ${reportId} generated: ${ragResponse.contradictions.length} contradictions found`,
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown generation error';
      this.logger.error(
        `Contradiction report ${reportId} generation failed: ${errorMessage}`,
      );

      await this.prisma.contradictionReport.update({
        where: { id: reportId },
        data: { status: 'failed' },
      });

      throw err; // Let BullMQ handle retries
    }
  }

  private async callRagService(
    documentIds: string[],
    scope: string,
    topic: string | null,
  ): Promise<RagContradictionResponse> {
    const url = `${this.ragServiceUrl}/contradictions/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_ids: documentIds,
        scope,
        topic,
      }),
      signal: AbortSignal.timeout(180_000), // 3 minute timeout
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RAG service error ${response.status}: ${body}`);
    }

    return response.json() as Promise<RagContradictionResponse>;
  }
}

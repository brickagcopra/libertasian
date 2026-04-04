import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import type { TimelineJobData } from './timelines.service';

interface RagTimelineResponse {
  events: {
    date: string;
    label: string;
    description: string;
    sourceDocumentId: string | null;
    sourceSectionId: string | null;
    eventType: string;
  }[];
  summary: string;
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

@Processor('timelines')
export class TimelinesProcessor extends WorkerHost {
  private readonly logger = new Logger(TimelinesProcessor.name);
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

  async process(job: Job<TimelineJobData>): Promise<void> {
    const { timelineId, documentIds, title } = job.data;
    this.logger.log(
      `Processing timeline generation: id=${timelineId}, title="${title}", docs=${documentIds.length}`,
    );

    try {
      // Mark as generating
      await this.prisma.caseTimeline.update({
        where: { id: timelineId },
        data: { status: 'generating' },
      });

      // Call RAG service
      const ragResponse = await this.callRagService(documentIds, title);

      // Record model run for audit per CLAUDE.md
      const modelRun = await this.prisma.modelRun.create({
        data: {
          runType: 'timeline_generation',
          modelName: ragResponse.model_name,
          promptTemplateVersion: ragResponse.prompt_template_version,
          inputRef: `timeline:${timelineId}`,
          outputRef: `timeline:${timelineId}:output`,
          confidence: ragResponse.confidence_score,
        },
      });

      // Update timeline with generated result
      await this.prisma.caseTimeline.update({
        where: { id: timelineId },
        data: {
          status: 'completed',
          timelineJson: {
            events: ragResponse.events,
            summary: ragResponse.summary,
          },
          modelRunId: modelRun.id,
        },
      });

      this.logger.log(`Timeline ${timelineId} generated successfully`);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown generation error';
      this.logger.error(
        `Timeline ${timelineId} generation failed: ${errorMessage}`,
      );

      await this.prisma.caseTimeline.update({
        where: { id: timelineId },
        data: { status: 'failed' },
      });

      throw err; // Let BullMQ handle retries
    }
  }

  private async callRagService(
    documentIds: string[],
    title: string,
  ): Promise<RagTimelineResponse> {
    const url = `${this.ragServiceUrl}/timelines/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_ids: documentIds,
        title,
      }),
      signal: AbortSignal.timeout(180_000), // 3 minute timeout
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RAG service error ${response.status}: ${body}`);
    }

    return response.json() as Promise<RagTimelineResponse>;
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import type { ResearchQueryJobData } from './research-workspaces.service';

interface RagResearchResponse {
  answer: string;
  citations: {
    source_id: string;
    section_id: string | null;
    text: string;
  }[];
  follow_up_suggestions: string[];
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

@Processor('research-workspaces')
export class ResearchWorkspacesProcessor extends WorkerHost {
  private readonly logger = new Logger(ResearchWorkspacesProcessor.name);
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

  async process(job: Job<ResearchQueryJobData>): Promise<void> {
    const { queryId, workspaceId, query, contextJson, previousQueries } =
      job.data;
    this.logger.log(
      `Processing research query: queryId=${queryId}, workspaceId=${workspaceId}`,
    );

    try {
      // Call RAG service with workspace context
      const ragResponse = await this.callRagService(
        query,
        contextJson,
        previousQueries,
      );

      // Record model run for audit per CLAUDE.md
      const modelRun = await this.prisma.modelRun.create({
        data: {
          runType: 'research_workspace_query',
          modelName: ragResponse.model_name,
          promptTemplateVersion: ragResponse.prompt_template_version,
          inputRef: `research_query:${queryId}`,
          outputRef: `research_query:${queryId}:output`,
          confidence: ragResponse.confidence_score,
        },
      });

      // Update query with response
      await this.prisma.researchQuery.update({
        where: { id: queryId },
        data: {
          responseJson: {
            answer: ragResponse.answer,
            followUpSuggestions: ragResponse.follow_up_suggestions,
          },
          citationsJson: ragResponse.citations.map((c) => ({
            sourceId: c.source_id,
            sectionId: c.section_id,
            text: c.text,
          })),
          modelRunId: modelRun.id,
        },
      });

      this.logger.log(`Research query ${queryId} answered successfully`);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown generation error';
      this.logger.error(
        `Research query ${queryId} failed: ${errorMessage}`,
      );

      // Store error as response so UI can show failure
      await this.prisma.researchQuery.update({
        where: { id: queryId },
        data: {
          responseJson: {
            answer: 'An error occurred while processing your query. Please try again.',
            followUpSuggestions: [],
            error: true,
          },
        },
      });

      throw err; // Let BullMQ handle retries
    }
  }

  private async callRagService(
    query: string,
    contextJson: Record<string, unknown>,
    previousQueries: { query: string; answer: string }[],
  ): Promise<RagResearchResponse> {
    const url = `${this.ragServiceUrl}/research_workspaces/query`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        pinned_document_ids: contextJson['pinnedDocumentIds'] ?? [],
        pinned_section_ids: contextJson['pinnedSectionIds'] ?? [],
        notes: contextJson['notes'] ?? '',
        previous_queries: previousQueries,
      }),
      signal: AbortSignal.timeout(120_000), // 2 minute timeout
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RAG service error ${response.status}: ${body}`);
    }

    return response.json() as Promise<RagResearchResponse>;
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import type { HearingPrepJobData } from './hearing-prep.service';

interface RagHearingPrepResponse {
  cases: {
    document_id: string;
    title: string;
    citation_text: string | null;
    relevance: string;
    key_holdings: string[];
  }[];
  provisions: {
    document_id: string;
    section_id: string | null;
    title: string;
    section_label: string | null;
    text: string;
    relevance: string;
  }[];
  arguments: {
    position: string;
    supporting_cases: string[];
    supporting_provisions: string[];
    strength: string;
  }[];
  counter_arguments: {
    position: string;
    supporting_cases: string[];
    supporting_provisions: string[];
    strength: string;
  }[];
  suggested_questions: string[];
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

@Processor('hearing-prep')
export class HearingPrepProcessor extends WorkerHost {
  private readonly logger = new Logger(HearingPrepProcessor.name);
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

  async process(job: Job<HearingPrepJobData>): Promise<void> {
    const { packId, topic, issue, documentIds, inputContext } = job.data;
    this.logger.log(
      `Processing hearing prep: id=${packId}, topic="${topic}", docs=${documentIds.length}`,
    );

    try {
      // Mark as generating
      await this.prisma.hearingPrepPack.update({
        where: { id: packId },
        data: { status: 'generating' },
      });

      // Call RAG service
      const ragResponse = await this.callRagService(
        topic,
        issue,
        documentIds,
        inputContext,
      );

      // Record model run for audit per CLAUDE.md
      const modelRun = await this.prisma.modelRun.create({
        data: {
          runType: 'hearing_prep',
          modelName: ragResponse.model_name,
          promptTemplateVersion: ragResponse.prompt_template_version,
          inputRef: `hearing_prep:${packId}`,
          outputRef: `hearing_prep:${packId}:output`,
          confidence: ragResponse.confidence_score,
        },
      });

      // Convert snake_case response to camelCase for storage
      const packJson = {
        cases: ragResponse.cases.map((c) => ({
          documentId: c.document_id,
          title: c.title,
          citationText: c.citation_text,
          relevance: c.relevance,
          keyHoldings: c.key_holdings,
        })),
        provisions: ragResponse.provisions.map((p) => ({
          documentId: p.document_id,
          sectionId: p.section_id,
          title: p.title,
          sectionLabel: p.section_label,
          text: p.text,
          relevance: p.relevance,
        })),
        arguments: ragResponse.arguments.map((a) => ({
          position: a.position,
          supportingCases: a.supporting_cases,
          supportingProvisions: a.supporting_provisions,
          strength: a.strength,
        })),
        counterArguments: ragResponse.counter_arguments.map((a) => ({
          position: a.position,
          supportingCases: a.supporting_cases,
          supportingProvisions: a.supporting_provisions,
          strength: a.strength,
        })),
        suggestedQuestions: ragResponse.suggested_questions,
      };

      // Update pack with generated result
      await this.prisma.hearingPrepPack.update({
        where: { id: packId },
        data: {
          status: 'completed',
          packJson,
          modelRunId: modelRun.id,
        },
      });

      this.logger.log(`Hearing prep ${packId} generated successfully`);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown generation error';
      this.logger.error(
        `Hearing prep ${packId} generation failed: ${errorMessage}`,
      );

      await this.prisma.hearingPrepPack.update({
        where: { id: packId },
        data: { status: 'failed' },
      });

      throw err; // Let BullMQ handle retries
    }
  }

  private async callRagService(
    topic: string,
    issue: string | undefined,
    documentIds: string[],
    inputContext: Record<string, unknown> | undefined,
  ): Promise<RagHearingPrepResponse> {
    const url = `${this.ragServiceUrl}/hearing-prep/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        issue: issue ?? null,
        document_ids: documentIds,
        input_context: inputContext ?? null,
      }),
      signal: AbortSignal.timeout(180_000), // 3 minute timeout
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RAG service error ${response.status}: ${body}`);
    }

    return response.json() as Promise<RagHearingPrepResponse>;
  }
}

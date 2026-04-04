import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';

export interface DigestJobData {
  digestId: string;
  documentId: string;
}

interface RagDigestResponse {
  summary: string | null;
  facts: string | null;
  petitioner_arguments: string | null;
  respondent_arguments: string | null;
  issues: string | null;
  ruling: string | null;
  doctrine: string | null;
  dispositive: string | null;
  provenance: {
    field: string;
    source_section_id: string;
    source_document_id: string;
  }[];
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

/** Confidence threshold: below this -> needs_human_review per CLAUDE.md */
const CONFIDENCE_THRESHOLD = 0.7;

@Processor('digests')
export class DigestsProcessor extends WorkerHost {
  private readonly logger = new Logger(DigestsProcessor.name);
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

  async process(job: Job<DigestJobData>): Promise<void> {
    const { digestId, documentId } = job.data;
    this.logger.log(
      `Processing digest generation: digestId=${digestId}, documentId=${documentId}`,
    );

    try {
      // Mark as generating
      await this.prisma.digest.update({
        where: { id: digestId },
        data: { reviewStatus: 'generating' },
      });

      // Fetch document sections to send to RAG service
      const sections = await this.prisma.legalDocumentSection.findMany({
        where: { legalDocumentId: documentId },
        orderBy: { ordering: 'asc' },
        select: {
          id: true,
          sectionType: true,
          sectionLabel: true,
          plainText: true,
          pageStart: true,
          pageEnd: true,
        },
      });

      // Call RAG service for digest generation
      const ragResponse = await this.callRagService(documentId, sections);

      // Record model run for audit per CLAUDE.md
      const modelRun = await this.prisma.modelRun.create({
        data: {
          runType: 'digest_generation',
          modelName: ragResponse.model_name,
          promptTemplateVersion: ragResponse.prompt_template_version,
          inputRef: `digest:${digestId}:doc:${documentId}`,
          outputRef: `digest:${digestId}:output`,
          confidence: ragResponse.confidence_score,
        },
      });

      // Determine review status based on confidence per CLAUDE.md
      const reviewStatus =
        ragResponse.confidence_score >= CONFIDENCE_THRESHOLD
          ? 'pending_review'
          : 'needs_human_review';

      // Update digest with generated content (DFIR+ gold standard)
      await this.prisma.digest.update({
        where: { id: digestId },
        data: {
          summary: ragResponse.summary,
          facts: ragResponse.facts,
          petitionerArguments: ragResponse.petitioner_arguments,
          respondentArguments: ragResponse.respondent_arguments,
          issues: ragResponse.issues,
          ruling: ragResponse.ruling,
          doctrine: ragResponse.doctrine,
          dispositive: ragResponse.dispositive,
          confidenceScore: ragResponse.confidence_score,
          reviewStatus,
        },
      });

      // Create provenance records per CLAUDE.md: every digest field must have source references
      if (ragResponse.provenance.length > 0) {
        await this.prisma.provenanceRecord.createMany({
          data: ragResponse.provenance.map((p) => ({
            entityType: 'digest',
            entityId: digestId,
            sourceDocumentId: p.source_document_id,
            sourceSectionId: p.source_section_id,
            provenanceType: p.field,
          })),
        });
      }

      this.logger.log(
        `Digest ${digestId} generated successfully (confidence: ${ragResponse.confidence_score}, status: ${reviewStatus})`,
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown generation error';
      this.logger.error(
        `Digest ${digestId} generation failed: ${errorMessage}`,
      );

      await this.prisma.digest.update({
        where: { id: digestId },
        data: { reviewStatus: 'failed' },
      });

      throw err; // Let BullMQ handle retries
    }
  }

  private async callRagService(
    documentId: string,
    sections: {
      id: string;
      sectionType: string;
      sectionLabel: string | null;
      plainText: string | null;
      pageStart: number | null;
      pageEnd: number | null;
    }[],
  ): Promise<RagDigestResponse> {
    const url = `${this.ragServiceUrl}/digests/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: documentId,
        sections: sections.map((s) => ({
          id: s.id,
          section_type: s.sectionType,
          section_label: s.sectionLabel,
          plain_text: s.plainText,
          page_start: s.pageStart,
          page_end: s.pageEnd,
        })),
      }),
      signal: AbortSignal.timeout(180_000), // 3 minute timeout for digest generation
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`RAG service error ${response.status}: ${body}`);
    }

    return response.json() as Promise<RagDigestResponse>;
  }
}
